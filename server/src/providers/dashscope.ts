import type { ConvertInput, PollResult, StyleProvider } from './types.js';
import { ProviderError, downloadImage, readVendorError } from './types.js';

interface DashScopeConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  /** styleId -> 百炼内置风格索引 */
  styleIndex: Record<string, number>;
}

interface DashScopeOutput {
  task_id?: string;
  task_status?: string;
  /** 结果地址字段名在不同版本里有 url / image_url 两种 */
  results?: Array<{ url?: string; image_url?: string }>;
}

interface DashScopeResponse {
  output?: DashScopeOutput;
  request_id?: string;
  code?: string;
  message?: string;
}

const TERMINAL_FAILED = new Set(['FAILED', 'CANCELED', 'UNKNOWN']);
const TERMINAL_OK = new Set(['SUCCEEDED', 'SUCCESS']);

export function createDashScopeProvider(cfg: DashScopeConfig): StyleProvider {
  const headers = {
    Authorization: `Bearer ${cfg.apiKey}`,
    'Content-Type': 'application/json',
    /** 百炼异步任务必须带这个头，否则同步返回会不符合预期 */
    'X-DashScope-Async': 'enable',
  };

  async function call(url: string, init: RequestInit): Promise<DashScopeResponse> {
    let res: Response;
    try {
      res = await fetch(url, init);
    } catch (e) {
      throw new ProviderError('dashscope', `请求百炼失败：${(e as Error).message}`);
    }
    const text = await res.text();
    let payload: DashScopeResponse;
    try {
      payload = text ? (JSON.parse(text) as DashScopeResponse) : {};
    } catch {
      throw new ProviderError('dashscope', `百炼返回非 JSON（HTTP ${res.status}）：${text.slice(0, 200)}`);
    }
    if (!res.ok) throw new ProviderError('dashscope', readVendorError(payload) || `百炼返回 HTTP ${res.status}`);
    return payload;
  }

  async function toSuccess(payload: DashScopeResponse): Promise<PollResult | null> {
    const output = payload.output;
    if (!output || !TERMINAL_OK.has(output.task_status ?? '')) return null;
    const first = output.results?.[0];
    const url = first?.url ?? first?.image_url;
    if (!url) return null;
    // 百炼的结果链接会过期，必须立刻取回字节存进任务记录
    return { state: 'SUCCEEDED', image: await downloadImage(url) };
  }

  function toFailed(payload: DashScopeResponse): PollResult | null {
    const output = payload.output;
    if (output && TERMINAL_FAILED.has(output.task_status ?? '')) {
      return { state: 'FAILED', message: readVendorError(payload) || `任务状态 ${output.task_status}` };
    }
    return null;
  }

  return {
    name: 'dashscope',

    async submit(input: ConvertInput): Promise<PollResult> {
      const styleIndex = cfg.styleIndex[input.style.id];
      if (styleIndex === undefined) {
        throw new ProviderError(
          'dashscope',
          `风格 ${input.style.id} 没有配置 DASHSCOPE_STYLE_INDEX_MAP，无法用百炼内置风格库渲染`,
        );
      }
      if (!input.publicSourceUrl) {
        throw new ProviderError(
          'dashscope',
          '百炼只能通过公网 URL 取原图，必须配置 PUBLIC_BASE_URL',
        );
      }

      /**
       * parameters.strength 取值 [0,1]。
       *
       * 这里按「值越大越贴近原图」的语义处理，所以小程序滑块（越大越有画风）
       * 要取反。首次接入请用 0.2 / 0.6 / 0.95 三档实测确认方向；
       * 方向反了只改这一行。
       */
      const strength = 1 - input.strength / 100;

      const payload = await call(`${cfg.baseUrl}/api/v1/services/aigc/image2image/style-repaint`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: cfg.model,
          input: {
            function: 'stylization_all',
            base_image_url: input.publicSourceUrl,
            style_index: styleIndex,
          },
          parameters: { strength },
        }),
      });

      const failed = toFailed(payload);
      if (failed) return failed;

      const success = await toSuccess(payload);
      if (success) return success;

      const taskId = payload.output?.task_id;
      if (taskId) return { state: 'RUNNING', vendorTaskId: taskId };

      throw new ProviderError('dashscope', readVendorError(payload) || '响应里既没有结果也没有任务 id');
    },

    async poll(vendorTaskId: string): Promise<PollResult> {
      const payload = await call(`${cfg.baseUrl}/api/v1/tasks/${vendorTaskId}`, {
        method: 'GET',
        headers,
      });

      const failed = toFailed(payload);
      if (failed) return failed;

      const success = await toSuccess(payload);
      if (success) return success;

      return { state: 'RUNNING', vendorTaskId };
    },
  };
}