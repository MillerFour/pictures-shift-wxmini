import { ENV } from '../config/env';
import { ApiError, TRANSPORT_CODES } from './error';
import type { ApiEnvelope } from '../types';

interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST';
  data?: Record<string, unknown>;
  header?: Record<string, string>;
  timeout?: number;
}

interface RawResult<T> {
  statusCode: number;
  data: T;
}

/**
 * 统一走 BFF 信封：HTTP 2xx 且 code === 0 才算成功。
 *
 * 页面因此只需要 try/catch 一次，不必逐接口判断状态码，
 * 失败原因一律从 ApiError.message 拿中文文案。
 */
export async function request<T>(options: RequestOptions): Promise<T> {
  let res: RawResult<ApiEnvelope<T>>;
  try {
    res = (await wx.request({
      url: ENV.API_BASE + options.url,
      method: options.method ?? 'GET',
      data: options.data,
      header: { 'content-type': 'application/json', ...options.header },
      timeout: options.timeout ?? ENV.REQUEST_TIMEOUT,
    })) as unknown as RawResult<ApiEnvelope<T>>;
  } catch (e) {
    const errMsg = (e as { errMsg?: string })?.errMsg ?? '';
    throw new ApiError(
      0,
      errMsg.includes('timeout') ? TRANSPORT_CODES.TIMEOUT : TRANSPORT_CODES.NETWORK,
      errMsg || '网络请求失败',
    );
  }

  const { statusCode, data: body } = res;
  if (statusCode < 200 || statusCode >= 300) {
    throw new ApiError(statusCode, TRANSPORT_CODES.NETWORK, `服务异常（HTTP ${statusCode}）`);
  }
  if (!body || typeof body !== 'object') {
    throw new ApiError(statusCode, TRANSPORT_CODES.BAD_RESPONSE, '服务返回格式异常');
  }
  if (body.code !== 0) {
    throw new ApiError(statusCode, String(body.code), body.message || '请求失败');
  }
  return body.data;
}