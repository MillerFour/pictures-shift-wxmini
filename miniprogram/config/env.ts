/**
 * 运行环境配置。
 *
 * 项目已迁移到微信云开发（serverless）：接口走 wx.cloud.callFunction、
 * 文件走云存储，不再依赖自有域名 / 服务器，因此不再有 API_BASE。
 */

/**
 * 微信云开发环境 ID。
 * 由微信开发者工具「云开发」控制台分配；改环境只动这一处。
 */
export const CLOUD_ENV = 'piture-shift-d9gy1p5tnf310cf3f';

function envVersion(): 'develop' | 'trial' | 'release' {
  try {
    // getAccountInfoSync 在旧基础库上不存在，必须 try 兜底
    return wx.getAccountInfoSync().miniProgram.envVersion;
  } catch {
    return 'release';
  }
}

export const ENV = {
  ENV_VERSION: envVersion(),

  /** 单次 wx.request 超时。只覆盖「提交」和「单次轮询」，出图耗时靠轮询 */
  REQUEST_TIMEOUT: 15000,

  /** 上传原图超时。手机大图 + 弱网要给足 */
  UPLOAD_TIMEOUT: 60000,

  /** 轮询间隔（毫秒） */
  POLL_INTERVAL: 2000,

  /**
   * 轮询最大次数。2000ms × 120 ≈ 4 分钟。
   * 必须设上限：弱网下无上限轮询会让 loading 一直挂着，也会持续打后端。
   */
  POLL_MAX_ATTEMPTS: 120,

  /** 原图压缩后的长边像素，再大只会拖慢上传，对风格化结果无收益 */
  MAX_LONG_EDGE: 1280,

  /** 原图压缩质量 */
  COMPRESS_QUALITY: 82,
} as const;
