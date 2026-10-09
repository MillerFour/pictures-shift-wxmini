import { config, type ProviderName } from '../config.js';
import { createDashScopeProvider } from './dashscope.js';
import { createMockProvider } from './mock.js';
import { createTokenHubProvider } from './tokenhub.js';
import { createVolcengineProvider } from './volcengine.js';
import type { StyleProvider } from './types.js';
import { ProviderError } from './types.js';

/**
 * 引擎工厂。
 *
 * 新接一家厂商 = 加一个 providers/xxx.ts + 在这里加一个 case，
 * 其余代码（路由、任务表、轮询、清理）完全不用动。
 */
export function createProvider(name: ProviderName = config.provider): StyleProvider {
  switch (name) {
    case 'mock':
      return createMockProvider();

    case 'volcengine':
      if (!config.volcengine.apiKey) {
        throw new ProviderError(name, '缺少 VOLCENGINE_API_KEY，请检查 .env');
      }
      return createVolcengineProvider({
        apiKey: config.volcengine.apiKey,
        baseUrl: config.volcengine.baseUrl,
        model: config.volcengine.model,
        size: config.volcengine.size,
      });

    case 'tokenhub':
      if (!config.tokenhub.apiKey) {
        throw new ProviderError(name, '缺少 TOKENHUB_API_KEY，请检查 .env');
      }
      return createTokenHubProvider({
        apiKey: config.tokenhub.apiKey,
        baseUrl: config.tokenhub.baseUrl,
        model: config.tokenhub.model,
        imageInput: config.tokenhub.imageInput,
      });

    case 'dashscope':
      if (!config.dashscope.apiKey) {
        throw new ProviderError(name, '缺少 DASHSCOPE_API_KEY，请检查 .env');
      }
      return createDashScopeProvider({
        apiKey: config.dashscope.apiKey,
        baseUrl: config.dashscope.baseUrl,
        model: config.dashscope.model,
        styleIndex: { ...config.dashscope.styleIndex },
      });

    default:
      throw new ProviderError(String(name), `未知的 STYLE_PROVIDER：${name}`);
  }
}