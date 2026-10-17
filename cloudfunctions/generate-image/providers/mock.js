'use strict';
const { ProviderError } = require('./types');

const MOCK_LATENCY_MS = 600;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Mock 引擎：不调任何厂商，原样返回上传的图。
 * 让小程序全流程在零配置、零成本、零密钥下先跑通；接真引擎只改 STYLE_PROVIDER。
 */
function createMockProvider() {
  return {
    name: 'mock',
    async submit(input) {
      await delay(MOCK_LATENCY_MS);
      return { state: 'SUCCEEDED', image: input.source };
    },
    async poll() {
      throw new ProviderError('mock', 'mock 引擎没有异步任务，不该进入轮询');
    },
  };
}

module.exports = { createMockProvider };
