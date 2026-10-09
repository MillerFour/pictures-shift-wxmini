import type { ConvertInput, PollResult, StyleProvider } from './types.js';
import { ProviderError } from './types.js';

const MOCK_LATENCY_MS = 600;

/**
 * Mock 引擎：不调任何厂商，原样返回上传的图。
 *
 * 存在意义是让小程序全流程（选图 → 上传 → 轮询 → 展示 → 存相册）
 * 在零配置、零成本、零密钥下先跑通；接真引擎时只改 STYLE_PROVIDER 一个变量。
 *
 * 代价：结果图与原图完全一样。这是预期行为，不是 bug。
 */
export function createMockProvider(): StyleProvider {
  return {
    name: 'mock',

    async submit(input: ConvertInput): Promise<PollResult> {
      await delay(MOCK_LATENCY_MS);
      return { state: 'SUCCEEDED', image: input.source };
    },

    async poll(): Promise<PollResult> {
      throw new ProviderError('mock', 'mock 引擎没有异步任务，不该进入轮询');
    },
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}