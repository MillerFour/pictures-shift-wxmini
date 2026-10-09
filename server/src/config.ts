import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * 极简 .env 加载。
 *
 * 只为省掉一个 dotenv 依赖：只支持 KEY=VALUE、# 注释、可选引号，
 * 且不覆盖已存在的真实环境变量（容器里注入的优先级最高）。
 */
function loadDotEnv(): void {
  try {
    const text = readFileSync(resolve(process.cwd(), '.env'), 'utf8');
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let value = line.slice(eq + 1).trim();
      const quoted =
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"));
      if (quoted) value = value.slice(1, -1);
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    /* 没有 .env 就直接用真实环境变量 */
  }
}

loadDotEnv();

function str(key: string, fallback = ''): string {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function num(key: string, fallback: number): number {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function parseIndexMap(raw: string): Record<string, number> {
  const map: Record<string, number> = {};
  for (const pair of raw.split(',')) {
    const [id, value] = pair.split('=');
    const n = Number(value);
    if (id?.trim() && Number.isFinite(n)) map[id.trim()] = n;
  }
  return map;
}

export type ProviderName = 'mock' | 'volcengine' | 'dashscope' | 'tokenhub';

export const config = {
  port: num('PORT', 8787),

  /**
   * 引擎选择。mock 不需要密钥，原样返回上传的图，
   * 用来在没有任何厂商账号时先跑通小程序全流程。
   */
  provider: str('STYLE_PROVIDER', 'mock') as ProviderName,

  /** 小程序可访问的公网 HTTPS 地址。dashscope 引擎强制要求 */
  publicBaseUrl: str('PUBLIC_BASE_URL').replace(/\/+$/, ''),

  maxFileSizeMB: num('MAX_FILE_SIZE_MB', 8),
  recommendedLongEdge: num('RECOMMENDED_LONG_EDGE', 1280),
  notice: str('NOTICE'),

  /** 任务在内存中的存活时长，到期由定时清理抹掉 */
  taskTtlMs: num('TASK_TTL_MS', 30 * 60 * 1000),
  /** 清理扫描间隔 */
  sweepIntervalMs: num('SWEEP_INTERVAL_MS', 5 * 60 * 1000),

  vendorPollIntervalMs: num('VENDOR_POLL_INTERVAL_MS', 3000),
  vendorPollTimeoutMs: num('VENDOR_POLL_TIMEOUT_MS', 5 * 60 * 1000),

  volcengine: {
    apiKey: str('VOLCENGINE_API_KEY'),
    baseUrl: str('VOLCENGINE_BASE_URL', 'https://ark.cn-beijing.volces.com').replace(/\/+$/, ''),
    /**
     * 实测（2026-10）：这个账号能出图的模型是 doubao-seedream-4-0-20260415。
     * 同列表里的 5-0-pro / 5-0-flash 都返回 429 SetLimitExceeded ——
     * 报错原文是「安全体验模式」，需要在方舟控制台关闭它才会放开。
     */
    model: str('VOLCENGINE_MODEL', 'doubao-seedream-4-0-20260415'),
    /**
     * 出图尺寸预设或 WIDTHxHEIGHT。
     * 旧版的 'adaptive' 已不被支持，实测报 InvalidParameter。
     */
    size: str('VOLCENGINE_SIZE', '1k'),
  },

  tokenhub: {
    apiKey: str('TOKENHUB_API_KEY'),
    baseUrl: str('TOKENHUB_BASE_URL', 'https://tokenhub.tencentmaas.com/v1').replace(/\/+$/, ''),
    model: str('TOKENHUB_IMAGE_MODEL', 'hy-image-v3.5-preview'),
    /**
     * 原图怎么传给厂商：base64 | url
     *
     * 官方请求示例用的是公网 URL，但同一套 image_url 结构通常也收 data URI。
     * 没实测过（账号计费闸门拦住了），所以留成开关：
     * - base64：开发期不需要公网域名，默认选它
     * - url：若 base64 被拒，改成 url 并配好 PUBLIC_BASE_URL
     */
    imageInput: str('TOKENHUB_IMAGE_INPUT', 'base64') as 'base64' | 'url',
  },

  dashscope: {
    apiKey: str('DASHSCOPE_API_KEY'),
    baseUrl: str('DASHSCOPE_BASE_URL', 'https://dashscope.aliyuncs.com').replace(/\/+$/, ''),
    model: str('DASHSCOPE_MODEL', 'wanx-style-repaint-v1'),
    /** 风格 id -> 百炼内置风格索引。未配置的 styleId 在该引擎下不可用 */
    styleIndex: parseIndexMap(str('DASHSCOPE_STYLE_INDEX_MAP')),
  },
} as const;