import { guidanceOf } from '../catalog.js';
import type { ConvertInput, PollResult, StyleProvider } from './types.js';
import { ProviderError, downloadImage, readVendorError, toDataUri } from './types.js';

interface ArkConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  size: string;
}

interface ArkImageItem {
  url?: string;
  b64_json?: string;
}

interface ArkResponse {
  id?: string;
  data?: ArkImageItem[];
  error?: { message?: string; code?: string };
}

/**
 * 火山引擎方舟（Ark）图片生成 —— 单图风格化。
 *
 * 下面的入参形状是**实测确认过**的（2026-10，doubao-seedream-4-0-20260415）：
 * - `image` 接受 base64 data URI，不需要公网可访问的原图地址；
 * - `response_format: 'b64_json'` 同步返回，实测 13-21 秒；
 * - `negative_prompt` 与 `guidance_scale` 都被接受（单独加、一起加都试过）；
 * - `size` 只接受 'WIDTHxHEIGHT' 或 '1k' / '2k' / '4k'，旧版的 'adaptive' 会报 InvalidParameter。
 *
 * 还没验证的：
 * - seededit 系列支持多张参考图（垫图）。吉卜力这类 IP 风格靠垫图锁定效果会明显更好，
 *   但它的入参结构和这里不同，要接必须同时改 buildRequest 和 ConvertInput.source。
 */
function buildRequest(input: ConvertInput, cfg: { model: string; size: string }): Record<string, unknown> {
  return {
    model: cfg.model,
    prompt: input.style.prompt,
    negative_prompt: input.style.negativePrompt,
    image: toDataUri(input.source),
    response_format: 'b64_json',
    size: cfg.size,
    watermark: false,
    guidance_scale: guidanceOf(input.style, input.strength),
    seed: Math.floor(Math.random() * 2 ** 31),
  };
}

export function createVolcengineProvider(cfg: ArkConfig): StyleProvider {
  const headers = {
    Authorization: `Bearer ${cfg.apiKey}`,
    'Content-Type': 'application/json',
  };

  async function call(url: string, init: RequestInit): Promise<ArkResponse> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      throw new ProviderError('volcengine', `请求方舟失败：${(e as Error).message}`);
    }
    const text = await res.text();
    let payload: ArkResponse;
    try {
      payload = text ? (JSON.parse(text) as ArkResponse) : {};
    } catch {
      throw new ProviderError('volcengine', `方舟返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
    }
    if (!res.ok) {
      throw new ProviderError('volcengine', readVendorError(payload) || `方舟返回 HTTP ${res.status}`);
    }
    return payload;
  }

  function toSuccess(payload: ArkResponse): PollResult | null {
    const item = payload.data?.[0];
    if (item?.b64_json) {
      return {
        state: 'SUCCEEDED',
        image: { bytes: Buffer.from(item.b64_json, 'base64'), contentType: 'image/jpeg' },
      };
    }
    return null;
  }

  /** 只有当响应里既没有内联图、也没有任务 id 时才算失败 */
  function toPending(payload: ArkResponse): PollResult | null {
    if (payload.id) return { state: 'RUNNING', vendorTaskId: payload.id };
    return null;
  }

  return {
    name: 'volcengine',

    async submit(input: ConvertInput): Promise<PollResult> {
      const payload = await call(`${cfg.baseUrl}/api/v3/images/generations`, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildRequest(input, cfg)),
      });

      if (payload.error?.message) throw new ProviderError('volcengine', payload.error.message);

      const inline = toSuccess(payload);
      if (inline) return inline;

      // 同步返回的也可能只给 URL（response_format 被改成 url 时）
      const url = payload.data?.[0]?.url;
      if (url) return { state: 'SUCCEEDED', image: await downloadImage(url) };

      const pending = toPending(payload);
      if (pending) return pending;

      throw new ProviderError('volcengine', readVendorError(payload) || '响应里既没有图片也没有任务 id');
    },

    async poll(vendorTaskId: string): Promise<PollResult> {
      const payload = await call(`${cfg.baseUrl}/api/v3/images/${vendorTaskId}`, { headers });

      if (payload.error?.message) throw new ProviderError('volcengine', payload.error.message);

      const inline = toSuccess(payload);
      if (inline) return inline;

      const url = payload.data?.[0]?.url;
      if (url) return { state: 'SUCCEEDED', image: await downloadImage(url) };

      // 拿不到图又没有失败标记时按「仍在跑」处理，交给外层超时兜底
      return { state: 'RUNNING', vendorTaskId };
    },
  };
}