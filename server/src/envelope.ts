import type { ApiEnvelope } from './types.js';

/**
 * 业务错误码。
 *
 * HTTP 状态码只表达「传输层是否成功」，业务失败一律 200 + 非 0 code，
 * 这样小程序只需判断 code === 0 一次。
 */
export const ErrorCode = {
  OK: 0,
  BAD_REQUEST: 40000,
  STYLE_NOT_FOUND: 40400,
  TASK_NOT_FOUND: 40401,
  PAYLOAD_TOO_LARGE: 41300,
  UNSUPPORTED_MEDIA: 41500,
  PROVIDER_ERROR: 50010,
  PROVIDER_NOT_CONFIGURED: 50011,
  INTERNAL: 50000,
} as const;

export function ok<T>(data: T, requestId?: string): ApiEnvelope<T> {
  return { code: ErrorCode.OK, message: 'ok', data, requestId };
}

export function fail(code: number, message: string, requestId?: string): ApiEnvelope<null> {
  return { code, message, data: null, requestId };
}