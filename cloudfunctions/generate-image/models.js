'use strict';
const cloud = require('wx-server-sdk');
const db = cloud.database();
const _ = db.command;

/**
 * 生图模型目录 —— 线上真源在云数据库 models 集合（控制台改文档即上线/下线，无需部署）。
 *
 * 本文件职责（与 app-config 的 styles 同构）：
 * 1. BUILT_IN_MODELS：首次播种数据 + 数据库不可用时的列表兜底；
 * 2. listAvailableModels：下发已上架且引擎密钥就绪的模型（只带展示字段）；
 * 3. findModel：生图时按 modelId 取模型参数，路由到对应 provider。
 *
 * 可用性双重门槛：models 集合 enabled ≠ false **且** 对应引擎密钥就绪
 * （apiKey 缺失的模型不下发、也无法被选中）；全部不可用时返回空列表，
 * 前端隐藏选择器，generate 回退到 STYLE_PROVIDER 默认引擎。
 *
 * 字段约定：
 * - provider：引擎路由（hunyuan / volcengine / tokenhub / dashscope）
 * - model / size：厂商模型名与出图尺寸，缺省取该引擎的环境变量默认值
 * - guidance：true = 该模型支持 guidance_scale（画风强度滑块生效）
 * - default：true = 未选模型时的缺省回退项（建议整个目录只有一个）
 */
const { config } = require('./config');

const MODELS_COLLECTION = 'models';

const BUILT_IN_MODELS = [
  {
    id: 'seedream-4',
    name: 'Seedream 4.0',
    provider: 'volcengine',
    model: 'doubao-seedream-4-0-20260415',
    size: '1K',
    desc: '出图快 · 性价比高',
    /** 4.0 支持 guidance_scale，画风强度滑块线性映射到 guidance 区间 */
    guidance: true,
    default: true,
  },
  {
    id: 'seedream-5',
    name: 'Seedream 5.0',
    provider: 'volcengine',
    model: 'doubao-seedream-5-0-260128',
    size: '2K',
    desc: '细节更细腻 · 2K 高清',
    /** 5.0 官方请求体不包含 guidance_scale，画风强度由 prompt 自身表达 */
    guidance: false,
  },
  {
    id: 'hunyuan',
    name: '混元生图',
    provider: 'hunyuan',
    model: config.hunyuan.model,
    desc: '腾讯云原生 · 免密钥',
  },
  {
    id: 'tokenhub',
    name: '混元 MaaS',
    provider: 'tokenhub',
    model: config.tokenhub.model,
    desc: 'TokenHub 通道',
  },
  {
    id: 'wanx-repaint',
    name: '通义万相',
    provider: 'dashscope',
    model: config.dashscope.model,
    desc: '阿里百炼风格重绘',
  },
];

/** provider 的密钥/环境是否就绪，决定该模型是否对外可见 */
function providerReady(provider) {
  switch (provider) {
    case 'volcengine':
      return Boolean(config.volcengine.apiKey);
    case 'tokenhub':
      return Boolean(config.tokenhub.apiKey);
    case 'dashscope':
      return Boolean(config.dashscope.apiKey);
    case 'hunyuan':
    case 'mock':
      return true;
    default:
      return false;
  }
}

/** 补齐引擎默认参数：厂商模型名/尺寸缺省取环境变量，能力开关缺省 false */
function withDefaults(doc) {
  const defaults = {
    volcengine: { model: config.volcengine.model, size: config.volcengine.size },
    tokenhub: { model: config.tokenhub.model },
    dashscope: { model: config.dashscope.model },
    hunyuan: { model: config.hunyuan.model },
  }[doc.provider] || {};
  return {
    ...doc,
    /** 归一化 id：DB 文档是 _id，内置兜底项是 id（任务档案 modelId 记录用） */
    id: doc._id || doc.id,
    model: doc.model || defaults.model || '',
    size: doc.size || defaults.size || '',
    guidance: doc.guidance === true,
  };
}

function sortKey(doc) {
  return Number.isFinite(doc.sort) ? doc.sort : Number.MAX_SAFE_INTEGER;
}

/** 播种标记：按实例只查一次 */
let seedChecked = false;

/** 集合为空时播种内置模型（add 带 _id，重复播种报错被吞掉，天然幂等） */
async function ensureSeed() {
  if (seedChecked) return;
  try {
    const res = await db.collection(MODELS_COLLECTION).count();
    if ((res && res.total) > 0) {
      seedChecked = true;
      return;
    }
    const now = Date.now();
    for (let i = 0; i < BUILT_IN_MODELS.length; i += 1) {
      const { id, ...rest } = BUILT_IN_MODELS[i];
      try {
        await db.collection(MODELS_COLLECTION).add({
          data: { _id: id, ...rest, enabled: true, sort: i + 1, createdAt: now, updatedAt: now },
        });
      } catch (e) {
        // _id 已存在（并发播种 / 手工建过）：忽略，保证幂等
      }
    }
    seedChecked = true;
    console.log('[models] models 集合已播种内置模型');
  } catch (e) {
    console.error('[models] models 播种检查失败', e);
  }
}

/** 下发给前端的可用模型列表（只带展示字段，参数细节留在服务端与数据库） */
async function listAvailableModels() {
  await ensureSeed();
  try {
    const res = await db.collection(MODELS_COLLECTION)
      .where({ enabled: _.neq(false) })
      .limit(50)
      .get();
    const docs = (res && res.data) || [];
    const source = docs.length ? docs : BUILT_IN_MODELS;
    return source
      .filter((m) => providerReady(m.provider))
      .sort((a, b) => sortKey(a) - sortKey(b))
      .map(({ _id, id, name, desc }) => ({ id: _id || id, name: name || '', desc: desc || '' }));
  } catch (e) {
    console.error('[models] models 读取失败，使用内置兜底', e);
    return BUILT_IN_MODELS.filter((m) => providerReady(m.provider)).map(({ id, name, desc }) => ({ id, name, desc }));
  }
}

/** 缺省模型：目录里 default: true 且已上架、密钥就绪的项；没有返回 null */
async function defaultModel() {
  try {
    const res = await db.collection(MODELS_COLLECTION)
      .where({ default: true, enabled: _.neq(false) })
      .orderBy('sort', 'asc')
      .limit(1)
      .get();
    const doc = res && res.data && res.data[0];
    if (doc && providerReady(doc.provider)) return withDefaults(doc);
  } catch (e) {
    // 数据库故障：走内置兜底
  }
  const fallback = BUILT_IN_MODELS.find((m) => m.default && providerReady(m.provider));
  return fallback ? withDefaults(fallback) : null;
}

/**
 * 按 modelId 取模型参数。
 * - modelId 为空：回退目录缺省项（default: true）；无可用缺省返回 null
 * - modelId 非空：必须真实存在、已上架且密钥就绪，否则返回 null
 *   （不静默回退默认项，防伪造 modelId 白扣次数 —— 调用方按 400 处理）
 */
async function findModel(modelId) {
  if (!modelId) return defaultModel();
  try {
    const res = await db.collection(MODELS_COLLECTION).doc(modelId).get();
    const doc = res && res.data;
    if (!doc || doc.enabled === false || !providerReady(doc.provider)) return null;
    return withDefaults(doc);
  } catch (e) {
    const msg = String((e && (e.message || e.errMsg)) || e);
    if (/not exist|-502005/i.test(msg)) return null; // 文档不存在
    throw e; // 数据库故障：上抛，生图链路本就强依赖数据库
  }
}

module.exports = { listAvailableModels, findModel };
