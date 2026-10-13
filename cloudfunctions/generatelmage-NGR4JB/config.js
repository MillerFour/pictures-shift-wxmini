'use strict';

/**
 * 极简配置读取。
 *
 * 云函数里没有 .env 文件，密钥全部走「云函数环境变量」（在微信开发者工具 /
 * SCF 控制台配置），容器注入的优先级最高。
 */
function str(key, fallback = '') {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function num(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseIndexMap(raw) {
  const map = {};
  for (const pair of String(raw).split(',')) {
    const eq = pair.indexOf('=');
    if (eq < 0) continue;
    const id = pair.slice(0, eq).trim();
    const n = Number(pair.slice(eq + 1).trim());
    if (id && Number.isFinite(n)) map[id] = n;
  }
  return map;
}

const config = {
  /** 引擎选择。mock 不需要密钥，原样返回上传的图，用来先跑通小程序全流程 */
  provider: str('STYLE_PROVIDER', 'hunyuan'),

  maxFileSizeMB: num('MAX_FILE_SIZE_MB', 8),
  recommendedLongEdge: num('RECOMMENDED_LONG_EDGE', 1280),
  notice: str('NOTICE'),

  /** 任务在云数据库里的存活时长；过期由 worker 清脏数据 */
  taskTtlMs: num('TASK_TTL_MS', 30 * 60 * 1000),

  vendorPollIntervalMs: num('VENDOR_POLL_INTERVAL_MS', 3000),
  vendorPollTimeoutMs: num('VENDOR_POLL_TIMEOUT_MS', 5 * 60 * 1000),

  volcengine: {
    apiKey: str('VOLCENGINE_API_KEY'),
    baseUrl: str('VOLCENGINE_BASE_URL', 'https://ark.cn-beijing.volces.com').replace(/\/+$/, ''),
    model: str('VOLCENGINE_MODEL', 'doubao-seedream-4-0-20260415'),
    size: str('VOLCENGINE_SIZE', '1k'),
  },

  tokenhub: {
    apiKey: str('TOKENHUB_API_KEY'),
    baseUrl: str('TOKENHUB_BASE_URL', 'https://tokenhub.tencentmaas.com/v1').replace(/\/+$/, ''),
    model: str('TOKENHUB_IMAGE_MODEL', 'hy-image-v3.5-preview'),
    imageInput: str('TOKENHUB_IMAGE_INPUT', 'base64'),
  },

  dashscope: {
    apiKey: str('DASHSCOPE_API_KEY'),
    baseUrl: str('DASHSCOPE_BASE_URL', 'https://dashscope.aliyuncs.com').replace(/\/+$/, ''),
    model: str('DASHSCOPE_MODEL', 'wanx-style-repaint-v1'),
    styleIndex: parseIndexMap(str('DASHSCOPE_STYLE_INDEX_MAP')),
  },

  /** 腾讯云开发原生混元图生图（走 cloud.ai()，免 API Key） */
  hunyuan: {
    model: str('HUNYUAN_MODEL', 'HY-Image-v3.0-I2I-ToB-v1.0.1'),
  },
};

module.exports = { config };
