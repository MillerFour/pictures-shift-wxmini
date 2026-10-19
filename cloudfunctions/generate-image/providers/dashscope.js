'use strict';
const { ProviderError, downloadImage, readVendorError, makeJsonCaller } = require('./types');

const TERMINAL_FAILED = new Set(['FAILED', 'CANCELED', 'UNKNOWN']);
const TERMINAL_OK = new Set(['SUCCEEDED', 'SUCCESS']);

function createDashScopeProvider(cfg) {
  const call = makeJsonCaller('dashscope', '百炼');
  const headers = {
    Authorization: `Bearer ${cfg.apiKey}`,
    'Content-Type': 'application/json',
    /** 百炼异步任务必须带这个头，否则同步返回会不符合预期 */
    'X-DashScope-Async': 'enable',
  };

  async function toSuccess(payload) {
    const output = payload.output;
    if (!output || !TERMINAL_OK.has(output.task_status || '')) return null;
    const first = output.results && output.results[0];
    const url = first && (first.url || first.image_url);
    if (!url) return null;
    return { state: 'SUCCEEDED', image: await downloadImage(url) };
  }

  function toFailed(payload) {
    const output = payload.output;
    if (output && TERMINAL_FAILED.has(output.task_status || '')) {
      return { state: 'FAILED', message: readVendorError(payload) || `任务状态 ${output.task_status}` };
    }
    return null;
  }

  return {
    name: 'dashscope',
    async submit(input) {
      const styleIndex = cfg.styleIndex[input.style.id];
      if (styleIndex === undefined) {
        throw new ProviderError(
          'dashscope',
          `风格 ${input.style.id} 没有配置 DASHSCOPE_STYLE_INDEX_MAP，无法用百炼内置风格库渲染`,
        );
      }
      if (!input.publicSourceUrl) {
        throw new ProviderError('dashscope', '百炼只能通过公网 URL 取原图，必须配置原图公网地址');
      }
      const strength = 1 - input.strength / 100;
      const payload = await call(`${cfg.baseUrl}/api/v1/services/aigc/image2image/style-repaint`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: cfg.model,
          input: { function: 'stylization_all', base_image_url: input.publicSourceUrl, style_index: styleIndex },
          parameters: { strength },
        }),
      });
      const failed = toFailed(payload);
      if (failed) return failed;
      const success = await toSuccess(payload);
      if (success) return success;
      const taskId = payload.output && payload.output.task_id;
      if (taskId) return { state: 'RUNNING', vendorTaskId: taskId };
      throw new ProviderError('dashscope', readVendorError(payload) || '响应里既没有结果也没有任务 id');
    },
    async poll(vendorTaskId) {
      const payload = await call(`${cfg.baseUrl}/api/v1/tasks/${vendorTaskId}`, { method: 'GET', headers });
      const failed = toFailed(payload);
      if (failed) return failed;
      const success = await toSuccess(payload);
      if (success) return success;
      return { state: 'RUNNING', vendorTaskId };
    },
  };
}

module.exports = { createDashScopeProvider };
