'use strict';
const { guidanceOf } = require('../catalog');
const { ProviderError, downloadImage, readVendorError, toDataUri, httpJson } = require('./types');

/**
 * Seedream（方舟 images/generations）请求体。
 * 固定单图生成（sequential_image_generation=disabled）、同步返回（stream=false）；
 * 结果优先 b64_json 省一次下载，厂商只回 url 时由 submit 兜底下载。
 * guidance_scale 仅 4.0 系列支持（目录里 guidance: true 才带），5.0 由 prompt 表达强度。
 */
function buildRequest(input, cfg) {
  const body = {
    model: cfg.model,
    prompt: input.style.prompt,
    negative_prompt: input.style.negativePrompt,
    image: toDataUri(input.source),
    sequential_image_generation: 'disabled',
    response_format: 'b64_json',
    size: cfg.size,
    stream: false,
    watermark: false,
    seed: Math.floor(Math.random() * 2 ** 31),
  };
  if (cfg.guidance) body.guidance_scale = guidanceOf(input.style, input.strength);
  return body;
}

function createVolcengineProvider(cfg) {
  const headers = {
    Authorization: `Bearer ${cfg.apiKey}`,
    'Content-Type': 'application/json',
  };

  async function call(url, init) {
    let res;
    try {
      res = await httpJson(url, { method: init.method || 'POST', headers: init.headers, body: init.body });
    } catch (e) {
      throw new ProviderError('volcengine', `请求方舟失败：${e.message}`);
    }
    const { status: resStatus, text } = res;
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      throw new ProviderError('volcengine', `方舟返回非 JSON（HTTP ${resStatus}）：${text.slice(0, 200)}`);
    }
    if (resStatus < 200 || resStatus >= 300) {
      throw new ProviderError('volcengine', readVendorError(payload) || `方舟返回 HTTP ${resStatus}`);
    }
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
