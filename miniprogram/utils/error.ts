export class ApiError extends Error {
  readonly httpStatus: number;
  readonly code: string;

  constructor(httpStatus: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.httpStatus = httpStatus;
    this.code = code;
  }
}

export const TRANSPORT_CODES = {
  TIMEOUT: 'TIMEOUT',
  NETWORK: 'NETWORK',
  BAD_RESPONSE: 'BAD_RESPONSE',
} as const;

export function toFriendlyMessage(err: unknown, fallback = '出了点问题，请稍后重试'): string {
  if (err instanceof ApiError) {
    if (err.code === TRANSPORT_CODES.TIMEOUT) return '网络有点慢，请检查网络后重试';
    if (err.code === TRANSPORT_CODES.NETWORK) return '连不上服务器，请稍后重试';
    return err.message || fallback;
  }
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
