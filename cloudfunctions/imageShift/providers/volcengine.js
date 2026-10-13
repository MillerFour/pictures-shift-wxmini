'use strict';
const { guidanceOf } = require('../catalog');
const { ProviderError, downloadImage, readVendorError, toDataUri } = require('./types');

function buildRequest(input, cfg) {
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

function createVolcengineProvider(cfg) {
  const headers = {
    Authorization: `Bearer ${cfg.apiKey}`,
    'Content-Type': 'application/json',
  };

  async function call(url, init) {
    let res;
    try {
      res = await fetch(url, init);
    } catch (e) {
      throw new ProviderError('volcengine', `请求方舟失败：${e.message}`);
    }
    const text = await res.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new ProviderError('volcengine', `方舟返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
    }
    if (!res.ok) throw new ProviderError('volcengine', readVendorError(payload) || `方舟返回 HTTP ${res.status}`);
    return payload;
  }

  function toSuccess(payload) {
    const item = payload.data && payload.data[0];
    if (item && item.b64_json) {
      return {
        state: 'SUCCEEDED',
        image: { bytes: Buffer.from(item.b64_json, 'base64'), contentType: 'image/jpeg' },
      };
    }
    return null;
  }

  function toPending(payload) {
    if (payload.id) return { state: 'RUNNING', vendorTaskId: payload.id };
    return null;
  }

  return {
    name: 'volcengine',
    async submit(input) {
      const payload = await call(`${cfg.baseUrl}/api/v3/images/generations`, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildRequest(input, cfg)),
      });
      if (payload.error && payload.error.message) throw new ProviderError('volcengine', payload.error.message);
      const inline = toSuccess(payload);
      if (inline) return inline;
      const url = payload.data && payload.data[0] && payload.data[0].url;
      if (url) return { state: 'SUCCEEDED', image: await downloadImage(url) };
      const pending = toPending(payload);
      if (pending) return pending;
      throw new ProviderError('volcengine', readVendorError(payload) || '响应里既没有图片也没有任务 id');
    },
    async poll(vendorTaskId) {
      const payload = await call(`${cfg.baseUrl}/api/v3/images/${vendorTaskId}`, { headers });
      if (payload.error && payload.error.message) throw new ProviderError('volcengine', payload.error.message);
      const inline = toSuccess(payload);
      if (inline) return inline;
      const url = payload.data && payload.data[0] && payload.data[0].url;
      if (url) return { state: 'SUCCEEDED', image: await downloadImage(url) };
      return { state: 'RUNNING', vendorTaskId };
    },
  };
}

module.exports = { createVolcengineProvider };
