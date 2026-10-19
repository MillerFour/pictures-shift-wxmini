'use strict';
const { ProviderError, downloadImage, toDataUri, makeJsonCaller, buildPrompt } = require('./types');

function createTokenHubProvider(cfg) {
  const call = makeJsonCaller('tokenhub', 'TokenHub');
  const headers = {
    Authorization: `Bearer ${cfg.apiKey}`,
    'Content-Type': 'application/json',
  };

  async function callGenerate(body) {
    return call(`${cfg.baseUrl}/wand/hunyuan-image/v35-generation`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
  }

  /**
   * 从响应里取出图片。没有官方响应示例，按 OpenAI 兼容的常见形态依次尝试。
   * 一个都匹配不上时把响应结构原样抛出，开通计费后一次即可定位真实结构。
   */
  async function extractImage(payload) {
    const root = payload || {};
    const fromUrl = (url) => downloadImage(url);
    const fromB64 = (b64) => ({ bytes: Buffer.from(b64, 'base64'), contentType: 'image/png' });

    const content = root.choices && root.choices[0] && root.choices[0].message && root.choices[0].message.content;
    if (typeof content === 'string' && /^https?:\/\//.test(content)) return fromUrl(content);

    if (Array.isArray(content)) {
      for (const part of content) {
        const url = part && part.image_url && part.image_url.url;
        const u2 = part && part.url;
        if (typeof url === 'string' && /^https?:\/\//.test(url)) return fromUrl(url);
        if (typeof u2 === 'string' && /^https?:\/\//.test(u2)) return fromUrl(u2);
        if (typeof url === 'string' && url.startsWith('data:')) return fromB64(url.slice(url.indexOf(',') + 1));
        if (part && part.b64_json) return fromB64(part.b64_json);
      }
    }

    for (const list of [root.data, root.images, root.output]) {
      if (Array.isArray(list) && list.length > 0) {
        const first = list[0];
        const furl = typeof first === 'string' ? first : first && (first.url || first.image_url);
        if (typeof furl === 'string' && /^https?:\/\//.test(furl)) return fromUrl(furl);
        if (first && first.b64_json) return fromB64(first.b64_json);
      }
    }
    return null;
  }

  return {
    name: 'tokenhub',
    async submit(input) {
      const useBase64 = cfg.imageInput === 'base64';
      if (!useBase64 && !input.publicSourceUrl) {
        throw new ProviderError('tokenhub', 'TOKENHUB_IMAGE_INPUT=url 时必须配置原图公网地址');
      }
      const imageUrl = useBase64 ? toDataUri(input.source) : input.publicSourceUrl;

      const text = buildPrompt(input.style, input.strength);

      const payload = await callGenerate({
        model: cfg.model,
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
        const shape = JSON.stringify(payload).slice(0, 500);
        throw new ProviderError('tokenhub', `响应里没找到图片，需要按真实结构调整 extractImage。响应：${shape}`);
      }
      return { state: 'SUCCEEDED', image };
    },
    async poll() {
      throw new ProviderError('tokenhub', 'TokenHub 生图是同步接口，不该进入轮询');
    },
  };
}

module.exports = { createTokenHubProvider };
