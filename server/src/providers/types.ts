import type { StyleDefinition } from '../types.js';
import type { SourceImage } from '../task-store.js';

export interface ConvertInput {
  taskId: string;
  style: StyleDefinition;
  /** 小程序端滑块值 0-100 */
  strength: number;
  source: SourceImage;
  /**
   * 原图的公网可访问地址。
   *
   * 只有「必须用 URL 取图」的厂商（如百炼）才需要它，
   * 所以 URL 拼接是调用方的事，provider 只负责决定用不用。
   */
  publicSourceUrl: string;
}

export type PollResult =
  /** 还在跑。异步厂商会带上 vendorTaskId，供调用方跨请求续轮询 */
  | { state: 'PENDING' | 'RUNNING'; vendorTaskId?: string }
  | { state: 'SUCCEEDED'; image: SourceImage }
  | { state: 'FAILED'; message: string };

export interface StyleProvider {
  readonly name: string;

  /**
   * 提交转换。
   *
   * 返回值刻意与 poll 同一个类型：厂商在这一点上并不统一 ——
   * 有的同步直接返回图片，有的返回 task_id 让调用方轮询。
   * 让 submit 也能返回终态，同步型厂商就不必空转一次 poll。
   */
  submit(input: ConvertInput): Promise<PollResult>;

  poll(vendorTaskId: string): Promise<PollResult>;
}

/** 厂商侧返回了错误，统一转成可读信息 */
export class ProviderError extends Error {
  constructor(
    readonly provider: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProviderError';
  }
}

/**
 * 提取厂商错误信息。
 *
 * 各家错误结构不统一，而这条消息会直接显示给小程序用户，
 * 所以宁可多试几种形状也不能退化成「返回 HTTP 402」这种废话：
 * - OpenAI 兼容：{ error: { message, code } }（TokenHub / Ark 走这条）
 * - 百炼：{ output: { message, code }, code, message }
 * - 方舟：{ error: { message, code } }，有的把 message_zh 放在同一层
 */
export function readVendorError(payload: unknown): string {
  if (typeof payload !== 'object' || payload === null) return '';
  const root = payload as Record<string, unknown>;
  const error = (root.error ?? {}) as Record<string, unknown>;
  const output = (root.output ?? {}) as Record<string, unknown>;

  const candidates = [
    error.message,
    error.message_zh,
    error.code,
    output.message,
    output.code,
    root.message,
    root.code,
    root.request_id,
    error.request_id,
  ];
  const parts = candidates.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return parts.join(' | ');
}

/** 把远端图片 URL 拉成字节。厂商返回临时链接，必须立刻取回 */
export async function downloadImage(url: string, timeoutMs = 30000): Promise<SourceImage> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`下载结果图失败：HTTP ${res.status}`);
    const contentType = res.headers.get('content-type') ?? 'image/jpeg';
    return { bytes: Buffer.from(await res.arrayBuffer()), contentType };
  } finally {
    clearTimeout(timer);
  }
}

/** data URI 是部分厂商（如方舟）接受 base64 直传时的省事做法 */
export function toDataUri(source: SourceImage): string {
  return `data:${source.contentType};base64,${source.bytes.toString('base64')}`;
}