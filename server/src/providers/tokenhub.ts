import type { ConvertInput, PollResult, StyleProvider } from './types.js';
import { ProviderError, downloadImage, readVendorError, toDataUri } from './types.js';
import type { SourceImage } from '../task-store.js';

interface TokenHubConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  imageInput: 'base64' | 'url';
}

/**
 * 腾讯云 TokenHub —— 混元生图（hy-image-v3.5-preview）。
 *
 * 走的是 OpenAI 兼容的 messages 结构：一个 user 消息里
 * 文本提示词 + image_url 拼在一起，和多模态对话完全同构。
 *
 * 已实测（2026-10）：endpoint 与 model 名正确，请求体通过了网关的参数校验，
 * 被计费闸门拦下 —— HTTP 402 / code 401007
 * 「服务无可用免费体验额度，且未开启后付费」。
 * 开通后付费后需要重新确认下面两件事：
 *
 * 1. `image_url.url` 到底收不收 base64 data URI。
 *    官方示例给的是公网 URL。config 里留了 TOKENHUB_IMAGE_INPUT 开关。
 * 2. 响应体结构。官方只给了请求示例，没有响应示例，
 *    所以 extractImage 下面按几种常见形态依次尝试。
 */
export function createTokenHubProvider(cfg: TokenHubConfig): StyleProvider {
  const headers = {
    Authorization: `Bearer ${cfg.apiKey}`,
    'Content-Type': 'application/json',
  };

  async function call(body: Record<string, unknown>): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl}/wand/hunyuan-image/v35-generation`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
      });
    } catch (e) {
      throw new ProviderError('tokenhub', `请求 TokenHub 失败：${(e as Error).message}`);
    }
    const text = await res.text();
    let payload: unknown;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new ProviderError('tokenhub', `TokenHub 返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
    }
    if (!res.ok) throw new ProviderError('tokenhub', readVendorError(payload) || `TokenHub 返回 HTTP ${res.status}`);
    return payload;
  }

  /**
   * 从响应里取出图片。
   *
   * 没有官方响应示例，所以按 OpenAI 兼容的常见形态依次尝试；
   * 一个都匹配不上时，把响应结构原样抛出去 —— 这样开通计费后
   * 一次就能定位真实结构，不用反复猜。
   */
  async function extractImage(payload: unknown): Promise<SourceImage | null> {
    const root = (payload ?? {}) as Record<string, any>;

    const fromUrl = async (url: string): Promise<SourceImage> => downloadImage(url);
    const fromB64 = (b64: string): SourceImage => ({
      bytes: Buffer.from(b64, 'base64'),
      contentType: 'image/png',
    });

    // 形态 1：choices[0].message.content 是字符串（图片 URL）
    const content = root?.choices?.[0]?.message?.content;
    if (typeof content === 'string' && /^https?:\/\//.test(content)) return fromUrl(content);

    // 形态 2：content 是数组，取其中的 url 或 b64
    if (Array.isArray(content)) {
      for (const part of content) {
        const url = part?.image_url?.url ?? part?.url;
        if (typeof url === 'string' && /^https?:\/\//.test(url)) return fromUrl(url);
        if (typeof url === 'string' && url.startsWith('data:')) {
          return fromB64(url.slice(url.indexOf(',') + 1));
        }
        if (typeof part?.b64_json === 'string') return fromB64(part.b64_json);
      }
    }

    // 形态 3：data / images 数组
    for (const list of [root?.data, root?.images, root?.output]) {
      if (Array.isArray(list) && list.length > 0) {
        const first = list[0];
        if (typeof first === 'string' && /^https?:\/\//.test(first)) return fromUrl(first);
        if (typeof first?.url === 'string') return fromUrl(first.url);
        if (typeof first?.image_url === 'string') return fromUrl(first.image_url);
        if (typeof first?.b64_json === 'string') return fromB64(first.b64_json);
      }
    }

    return null;
  }

  return {
    name: 'tokenhub',

    async submit(input: ConvertInput): Promise<PollResult> {
      const useBase64 = cfg.imageInput === 'base64';
      if (!useBase64 && !input.publicSourceUrl) {
        throw new ProviderError('tokenhub', 'TOKENHUB_IMAGE_INPUT=url 时必须配置 PUBLIC_BASE_URL');
      }
      const imageUrl = useBase64 ? toDataUri(input.source) : input.publicSourceUrl;

      const style = input.style;
      const text = [
        style.prompt,
        // 滑块拉得越高越强调「这是同一个人」，抵消画风强度的偏移
        input.strength < 50 ? '尽可能保留原图人物的五官、发型与姿态，只做画风转译' : '',
      ]
        .filter(Boolean)
        .join('。');

      const payload = await call({
        model: cfg.model,
        // session 只是请求分组标识，用 taskId 保证一次生成可追溯
        session: `ps-${input.taskId}`,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text },
              { type: 'image_url', image_url: { url: imageUrl } },
            ],
          },
        ],
      });

      const image = await extractImage(payload);
      if (!image) {
        // 结构不认识时把真实响应打出来，比在这里猜要快得多
        const shape = JSON.stringify(payload).slice(0, 500);
        throw new ProviderError('tokenhub', `响应里没找到图片，需要按真实结构调整 extractImage。响应：${shape}`);
      }
      return { state: 'SUCCEEDED', image };
    },

    async poll(): Promise<PollResult> {
      // 混元生图是同步接口（一次请求直接返回图），不该走到这里
      throw new ProviderError('tokenhub', 'TokenHub 生图是同步接口，不该进入轮询');
    },
  };
}
