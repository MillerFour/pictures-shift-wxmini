'use strict';
const { config } = require('../config');
const { createDashScopeProvider } = require('./dashscope');
const { createHunyuanProvider } = require('./hunyuan');
const { createMockProvider } = require('./mock');
const { createTokenHubProvider } = require('./tokenhub');
const { createVolcengineProvider } = require('./volcengine');
const { ProviderError } = require('./types');

/**
 * 引擎工厂。
 * 新接一家厂商 = 加一个 providers/xxx.js + 在这里加一个 case，
 * 其余代码（路由、任务表、轮询、清理）完全不用动。
 *
 * override 来自模型目录（models.js）：用户选定模型后，同一 provider
 * 用不同的 model/size 参数调用（如 Seedream 4.0 → 5.0），无需重复建文件。
 * override 缺省时沿用 STYLE_PROVIDER 的环境变量默认值。
 */
function createProvider(name = config.provider, override = {}) {
  switch (name) {
    case 'mock':
      return createMockProvider();

    case 'volcengine':
      if (!config.volcengine.apiKey) throw new ProviderError(name, '缺少 VOLCENGINE_API_KEY');
      return createVolcengineProvider({
        apiKey: config.volcengine.apiKey,
        baseUrl: config.volcengine.baseUrl,
        model: override.model || config.volcengine.model,
        size: override.size || config.volcengine.size,
        guidance: override.guidance,
      });

    case 'tokenhub':
      if (!config.tokenhub.apiKey) throw new ProviderError(name, '缺少 TOKENHUB_API_KEY');
      return createTokenHubProvider({
        apiKey: config.tokenhub.apiKey,
        baseUrl: config.tokenhub.baseUrl,
        model: override.model || config.tokenhub.model,
        imageInput: config.tokenhub.imageInput,
      });

    case 'hunyuan':
      // CloudBase 原生混元生图：无需 API Key，走云环境鉴权
      return createHunyuanProvider({ model: override.model || config.hunyuan.model });

    case 'dashscope':
      if (!config.dashscope.apiKey) throw new ProviderError(name, '缺少 DASHSCOPE_API_KEY');
      return createDashScopeProvider({
        apiKey: config.dashscope.apiKey,
        baseUrl: config.dashscope.baseUrl,
        model: override.model || config.dashscope.model,
        styleIndex: { ...config.dashscope.styleIndex },
      });

    default:
      throw new ProviderError(String(name), `未知的 STYLE_PROVIDER：${name}`);
  }
}

module.exports = { createProvider };
