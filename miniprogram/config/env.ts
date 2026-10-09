/**
 * 运行环境配置。
 *
 * 三件事必须做对，否则真机会白屏：
 * 1. API_BASE 换成你自己备案的 HTTPS 域名；
 * 2. 小程序后台「开发管理 → 开发设置 → 服务器域名」把该域名加入
 *    request / uploadFile / downloadFile 三个合法域名；
 * 3. 开发者工具里勾「不校验合法域名」只能本地调试用，真机与审核一律失效。
 */

/** 开发态（真机预览 / 开发工具）使用的后端地址 */
const DEV_API_BASE = 'http://127.0.0.1:8787';

/** 体验版与正式版使用的后端地址 */
const PROD_API_BASE = 'https://api.pictures-shift.com';

function envVersion(): 'develop' | 'trial' | 'release' {
  try {
    // getAccountInfoSync 在旧基础库上不存在，必须 try 兜底
    return wx.getAccountInfoSync().miniProgram.envVersion;
  } catch {
    return 'release';
  }
}

function resolveApiBase(): string {
  // 真机预览时 develop 版本连不上 localhost，需要用局域网 IP 或内网穿透，
  // 这里只做默认选择；真机调试请改成自己的局域网地址。
  return envVersion() === 'develop' ? DEV_API_BASE : PROD_API_BASE;
}

export const ENV = {
  API_BASE: resolveApiBase(),
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
