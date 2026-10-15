'use strict';

/**
 * 生图模型目录：前端「模型选择」的真源。
 *
 * 选风格页的模型列表从这里下发（listAvailableModels），生图请求带 modelId，
 * generate 按目录项路由到对应 provider 并覆盖 model/size 等参数。
 * 可用性以密钥配置为准：apiKey 缺失的模型不下发、也无法被选中；
 * 全部不可用时返回空列表，前端隐藏选择器，generate 回退到 STYLE_PROVIDER 默认引擎。
 */

const { config } = require('./config');

const MODEL_CATALOG = [
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

/** 下发给前端的可用模型列表（只带展示字段，参数细节留在服务端） */
function listAvailableModels() {
  return MODEL_CATALOG.filter((m) => providerReady(m.provider)).map(({ id, name, desc }) => ({ id, name, desc }));
}

/**
 * 按 modelId 找模型；缺省或不可用回退到目录默认项。
 * 返回 null 表示目录没有任何可用模型（调用方回退到 STYLE_PROVIDER 默认引擎）。
 */
function findModel(modelId) {
  if (modelId) {
    const found = MODEL_CATALOG.find((m) => m.id === modelId && providerReady(m.provider));
    if (found) return found;
  }
  const fallback = MODEL_CATALOG.find((m) => m.default && providerReady(m.provider));
  return fallback || null;
}

module.exports = { MODEL_CATALOG, listAvailableModels, findModel };
