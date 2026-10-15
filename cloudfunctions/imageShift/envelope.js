'use strict';

/**
 * 业务错误码。HTTP 状态码只表达「传输层是否成功」，
 * 业务失败一律 200 + 非 0 code，小程序只需判断 code === 0 一次。
 */
const ErrorCode = {
  OK: 0,
  BAD_REQUEST: 40000,
  STYLE_NOT_FOUND: 40400,
  TASK_NOT_FOUND: 40401,
  PAYLOAD_TOO_LARGE: 41300,
  UNSUPPORTED_MEDIA: 41500,
  PROVIDER_ERROR: 50010,
  PROVIDER_NOT_CONFIGURED: 50011,
  INTERNAL: 50000,
  UNAUTHORIZED: 40100,
  /** 创作次数已用完（前端据此弹付费墙） */
  QUOTA_EXHAUSTED: 40200,
  /** 支付链路失败（下单签名 / 查单 / 发货） */
  PAY_ERROR: 40300,
  /** 虚拟支付未在服务端配置（缺 OfferID / AppKey 等环境变量） */
  PAY_NOT_CONFIGURED: 40301,
};

function ok(data, requestId) {
  return { code: ErrorCode.OK, message: 'ok', data, requestId };
}

function fail(code, message, requestId) {
  return { code, message, data: null, requestId };
}

module.exports = { ErrorCode, ok, fail };
