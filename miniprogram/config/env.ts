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

/**
 * 图片处理参数（上传原图的本地压缩，与云函数/厂商无关）。
 * 旧直连后端架构的请求/轮询参数已随架构废弃删除。
 */
export const ENV = {
  /** 原图压缩后的长边像素，再大只会拖慢上传，对风格化结果无收益 */
  MAX_LONG_EDGE: 1280,

  /** 原图压缩质量 */
  COMPRESS_QUALITY: 82,
} as const;
