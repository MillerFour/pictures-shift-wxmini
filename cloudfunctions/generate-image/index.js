'use strict';
const cloud = require('wx-server-sdk');

// 必须最先 init：providers/config 在模块顶层会用到云能力
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 150000 });

const { findStyle } = require('./catalog');
const { generate } = require('./convert');
const { listAvailableModels, findModel } = require('./models');
const { ensureCollections } = require('./db-init');

const db = cloud.database();
const _ = db.command;

/**
 * 免费次数的单次发放额度（注册赠送 / 平台活动派发；与 free-quota / pay 的 FREE_QUOTA 保持一致）。
 * 显式配置 0 = 不赠送也合法；其余非法值回落 1。
 */
const rawFreeQuota = Number(process.env.FREE_QUOTA);
const FREE_QUOTA = Number.isInteger(rawFreeQuota) && rawFreeQuota >= 0 ? rawFreeQuota : 1;

function ok(data) {
  return { code: 0, message: 'ok', data };
}
function fail(code, message) {
  return { code, message, data: null };
}

/**
 * 服务端配额：扣一次创作次数。
 * where 带 quota>0 条件 + inc(-1)，并发下只有剩余次数充足的扣减会生效，
 * 是「检查 + 扣减」的原子等价物。存量用户缺 quota 字段时先补齐。
 * 返回 null 表示扣减成功；返回错误信封表示无法扣减。
 */
async function consumeQuota(openid) {
  const users = db.collection('users');
  try {
    const userRes = await users.doc(openid).get();
    const user = userRes && userRes.data;
    if (!user) return fail(40100, '请先登录');
    if (typeof user.quota !== 'number') {
      // 存量用户缺 quota 字段：补齐免费次数，保证老账号也能继续体验
      await users.doc(openid).update({ data: { quota: FREE_QUOTA, updatedAt: Date.now() } });
    }
  } catch (e) {
    return fail(40100, '请先登录');
  }

  const take = await users.where({ _id: openid, quota: _.gt(0) }).update({
    data: { quota: _.inc(-1), updatedAt: Date.now() },
  });
  if (!take.stats || take.stats.updated === 0) {
    return fail(40200, '创作次数已用完，购买次数包后可继续生成');
  }
  return null;
}

/** 生成失败时返还次数（只返还真正扣掉的那次） */
async function refundQuota(openid) {
  try {
    await db.collection('users').doc(openid).update({ data: { quota: _.inc(1), updatedAt: Date.now() } });
  } catch (e) {
    console.error(`[generate-image] 返还次数失败 ${openid}`, e);
  }
}

/**
 * 任务档案命名：同一任务的原/成图共用时间戳前缀，落在 task/{openid}/ 下配对。
 * 格式 YYYY_MM_DD_HH_MM_SS_SSS（前端上传原图时生成，服务端校验格式防路径注入；
 * 缺失或非法时用服务端时间兜底，兼容旧客户端）。
 */
const TASK_STAMP_RE = /^\d{4}_\d{2}_\d{2}_\d{2}_\d{2}_\d{2}_\d{3}$/;

function normalizeTaskStamp(raw) {
  if (typeof raw === 'string' && TASK_STAMP_RE.test(raw)) return raw;
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getFullYear()}_${p(d.getMonth() + 1)}_${p(d.getDate())}_${p(d.getHours())}_${p(d.getMinutes())}_${p(d.getSeconds())}_${p(d.getMilliseconds(), 3)}`;
}

/**
 * 同步生图入口。
 *
 * 入参：{ fileID, styleId, strength, modelId, taskStamp }
 *  - fileID：原图在云存储的 fileID（task/{openid}/{taskStamp}_original.{ext}）
 *  - styleId：styles 集合中的画风 id（云数据库真源，控制台加文档即上新画风）
 *  - strength：0-100 风格强度
 *  - modelId：选风格页选定的模型（models 集合真源；缺省取目录默认项）
 *  - taskStamp：任务时间戳（与原图文件名配对；成图落 task/{openid}/{taskStamp}_result.{ext}）
 * 出参（统一信封）：{ code:0, message:'ok', data:{ resultFileID, resultUrl, costMs } }
 *
 * 次数在此服务端扣减（前端本地计数仅作展示）：openid 为空、次数不足直接拒绝。
 * 每次成功生成写一条 tasks 档案（含原/成图 fileID，「历史创作」数据源）。
 * 另支持 action=models：下发可用模型列表（前端「模型选择」数据源）。
 */
exports.main = async (event) => {
  try {
    // 关键集合懒创建（tasks 档案 / users 扣减次数 / styles 画风真源 / models 模型真源）
    await ensureCollections(['users', 'tasks', 'styles', 'models']);
    // 模型列表：与 generate 同函数下发，避免再部署一个纯查询云函数
    if (event && event.action === 'models') {
      return ok(await listAvailableModels());
    }

    const { fileID, styleId, strength, modelId, taskStamp } = event;
    const openid = cloud.getWXContext().OPENID || '';
    if (!openid) return fail(40100, '请先登录');
    if (!fileID || typeof fileID !== 'string') return fail(40000, '缺少原图 fileID');
    if (!styleId || typeof styleId !== 'string') return fail(40000, '缺少风格 id');
    const style = await findStyle(styleId);
    if (!style) return fail(40400, `风格 ${styleId} 不存在`);
    // modelId 校验 models 集合真源：传入的必须已上架且引擎密钥就绪（防伪造参数白扣次数）；
    // 缺省取目录默认项（default: true），解析结果传给 generate 复用，档案记录实际使用的模型
    const model = await findModel(modelId);
    if (modelId && !model) return fail(40000, `模型 ${modelId} 不可用`);

    // 参数校验通过后才扣次数；生成失败会返还，不让用户为失败买单
    const quotaErr = await consumeQuota(openid);
    if (quotaErr) return quotaErr;

    const stamp = normalizeTaskStamp(taskStamp);
    let result;
    try {
      // style 已在本入口解析，直接传入复用，convert 内不再重复查库
      result = await generate(fileID, style, strength, model, { openid, stamp });
    } catch (err) {
      // 生成失败返还次数，不让用户为失败买单
      await refundQuota(openid);
      throw err;
    }

    // 顺手换好临时直链，省去前端再调一次 getTempFileURL
    let resultUrl = '';
    try {
      const res = await cloud.getTempFileURL({ fileList: [result.resultFileID] });
      resultUrl = (res.fileList && res.fileList[0] && res.fileList[0].tempFileURL) || '';
    } catch (e) {
      resultUrl = '';
    }

    // 任务档案落库（「历史创作」数据源，含原/成图 fileID 可溯源到存储文件）：
    // 服务端写，用户中途退出也不丢。落库失败不阻断出图 —— 用户拿图优先。
    try {
      await db.collection('tasks').add({
        data: {
          openid,
          styleId,
          styleName: style.name || styleId,
          modelId: model ? model.id : '',
          modelName: model ? model.name : '',
          strength: Number(strength) || 60,
          originalFileID: fileID,
          resultFileID: result.resultFileID,
          costMs: result.costMs || 0,
          createdAt: Date.now(),
        },
      });
    } catch (e) {
      console.error('[generate-image] 任务档案落库失败', e);
    }

    return ok({ resultFileID: result.resultFileID, resultUrl, costMs: result.costMs });
  } catch (err) {
    console.error('[generate-image] 出图失败', err);
    return fail(50000, err instanceof Error ? err.message : '生图失败');
  }
};
