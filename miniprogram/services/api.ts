import { ENV } from '../config/env';
import { STORAGE_KEYS } from '../constants/keys';
import { CONFIG_FALLBACK, STYLE_FALLBACK } from '../constants/styles';
import { readCache, writeCache } from '../utils/cache';
import { ApiError, TRANSPORT_CODES } from '../utils/error';
import { request } from '../utils/request';
import type { CreateTaskResponse, RuntimeConfig, StyleMeta, TaskDetail, TaskStatus } from '../types';

const TTL = {
  styles: 6 * 60 * 60 * 1000,
  config: 24 * 60 * 60 * 1000,
};

/** 启动预热。失败静默 —— 页面都有本地兜底，不该在启动阶段打扰用户 */
export function warmup(): Promise<unknown> {
  return Promise.allSettled([loadStyles(), loadRuntimeConfig()]);
}

export async function loadStyles(): Promise<StyleMeta[]> {
  const cached = readCache<StyleMeta[]>(STORAGE_KEYS.styles, TTL.styles);
  if (cached?.length) return cached;
  const remote = await request<StyleMeta[]>({ url: '/api/styles' });
  const styles = Array.isArray(remote) && remote.length ? remote : STYLE_FALLBACK;
  writeCache(STORAGE_KEYS.styles, styles);
  return styles;
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const cached = readCache<RuntimeConfig>(STORAGE_KEYS.runtimeConfig, TTL.config);
  if (cached) return cached;
  const remote = await request<RuntimeConfig>({ url: '/api/config' });
  const config = { ...CONFIG_FALLBACK, ...remote };
  writeCache(STORAGE_KEYS.runtimeConfig, config);
  return config;
}

export interface CreateTaskParams {
  filePath: string;
  styleId: string;
  /** 0-100 */
  strength: number;
}

/**
 * 上传原图并创建转换任务。
 *
 * 用 wx.uploadFile 而非「转 base64 再 wx.request」：
 * base64 会让体积膨胀约 1/3，大图很容易撞上小程序请求体上限。
 */
export function createTask(
  params: CreateTaskParams,
  onProgress?: (percent: number) => void,
): Promise<CreateTaskResponse> {
  return new Promise((resolve, reject) => {
    const task = wx.uploadFile({
      url: ENV.API_BASE + '/api/convert',
      filePath: params.filePath,
      name: 'photo',
      formData: { styleId: params.styleId, strength: String(params.strength) },
      timeout: ENV.UPLOAD_TIMEOUT,
      success: (res) => {
        let body: { code?: number; message?: string; data?: CreateTaskResponse } | null = null;
        try {
          body = JSON.parse(res.data);
        } catch {
          reject(new ApiError(res.statusCode, TRANSPORT_CODES.BAD_RESPONSE, '服务返回格式异常'));
          return;
        }
        if (res.statusCode < 200 || res.statusCode >= 300 || !body || body.code !== 0 || !body.data) {
          reject(new ApiError(res.statusCode, String(body?.code ?? ''), body?.message || '提交失败'));
          return;
        }
        resolve(body.data);
      },
      fail: (e) => {
        const msg = e.errMsg ?? '';
        const code = msg.includes('timeout') ? TRANSPORT_CODES.TIMEOUT : TRANSPORT_CODES.NETWORK;
        reject(new ApiError(0, code, msg || '上传失败'));
      },
    });
    if (onProgress) task.onProgressUpdate((e) => onProgress(e.progress));
  });
}

export function fetchTask(taskId: string): Promise<TaskDetail> {
  return request<TaskDetail>({ url: `/api/tasks/${encodeURIComponent(taskId)}` });
}

export function isTerminal(status: TaskStatus): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED';
}

/**
 * 轮询直到任务进入终态。
 *
 * 必须设上限：弱网或后端重启时，无上限轮询会让 loading 一直挂着，
 * 也会持续打后端。到达上限按超时抛错，让用户能重试。
 */
export async function waitTask(
  taskId: string,
  onTick?: (detail: TaskDetail) => void,
): Promise<TaskDetail> {
  for (let i = 0; i < ENV.POLL_MAX_ATTEMPTS; i += 1) {
    const detail = await fetchTask(taskId);
    onTick?.(detail);
    if (isTerminal(detail.status)) return detail;
    await delay(ENV.POLL_INTERVAL);
  }
  throw new ApiError(0, TRANSPORT_CODES.TIMEOUT, '生成超时，请稍后重试');
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}