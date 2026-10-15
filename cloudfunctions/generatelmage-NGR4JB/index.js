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

/** 新用户免费次数（与 imageShift 云函数的 FREE_QUOTA 保持一致） */
const FREE_QUOTA = Number(process.env.FREE_QUOTA) || 1;

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
      // 上线云配额前的存量用户：补齐免费次数，与新人一致
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
    console.error(`[generatelmage] 返还次数失败 ${openid}`, e);
  }
}

/**
 * 同步生图入口。
 *
 * 入参：{ fileID, styleId, strength, modelId }
 *  - fileID：原图在云存储的 fileID（与前端 uploadSource 上传后拿到的一致）
 *  - styleId：沿用 catalog 中的风格 id（如 ghibli / anime / pixar / film）
 *  - strength：0-100 风格强度
 *  - modelId：选风格页选定的模型（models.js 目录）；缺省回退默认引擎
 * 出参（统一信封）：{ code:0, message:'ok', data:{ resultFileID, resultUrl, costMs } }
 *
 * 次数在此服务端扣减（前端本地计数仅作展示）：openid 为空、次数不足直接拒绝。
 * 另支持 action=models：下发可用模型列表（前端「模型选择」数据源）。
 */
exports.main = async (event) => {
  try {
    // 关键集合懒创建（creations 落库 / users 扣减次数依赖）
    await ensureCollections(['users', 'creations']);
    // 模型列表：与 generate 同函数下发，避免再部署一个纯查询云函数
    if (event && event.action === 'models') {
      return ok(listAvailableModels());
    }

    const { fileID, styleId, strength, modelId } = event;
    const openid = cloud.getWXContext().OPENID || '';
    if (!openid) return fail(40100, '请先登录');
    if (!fileID || typeof fileID !== 'string') return fail(400, '缺少原图 fileID');
    if (!styleId || typeof styleId !== 'string') return fail(400, '缺少风格 id');
    const style = findStyle(styleId);
    if (!style) return fail(404, `风格 ${styleId} 不存在`);
    // 传入的 modelId 必须真实可用（目录里存在且密钥就绪），防伪造参数白扣次数
    let model = null;
    if (modelId !== undefined && modelId !== null && modelId !== '') {
      model = findModel(modelId);
      if (!model) return fail(400, `模型 ${modelId} 不可用`);
    }

    // 参数校验通过后才扣次数；生成失败会返还，不让用户为失败买单
    const quotaErr = await consumeQuota(openid);
    if (quotaErr) return quotaErr;

    let result;
    try {
      result = await generate(fileID, styleId, strength, modelId);
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

    // 生成记录落库（「历史创作」数据源）：服务端写，用户中途退出也不丢。
    // 落库失败不阻断出图 —— 用户拿图优先，记录缺失比出图失败伤害小。
    try {
      await db.collection('creations').add({
        data: {
          openid,
          styleId,
          styleName: style.name || styleId,
          modelId: model ? model.id : '',
          modelName: model ? model.name : '',
          strength: Number(strength) || 60,
          sourceFileID: fileID,
          resultFileID: result.resultFileID,
          costMs: result.costMs || 0,
          createdAt: Date.now(),
        },
      });
    } catch (e) {
      console.error('[generatelmage] 生成记录落库失败', e);
    }

    return ok({ resultFileID: result.resultFileID, resultUrl, costMs: result.costMs });
  } catch (err) {
    console.error('[generatelmage] 出图失败', err);
    return fail(500, err instanceof Error ? err.message : '生图失败');
  }
};
