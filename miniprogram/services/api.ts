import { ENV } from '../config/env';
import { STORAGE_KEYS } from '../constants/keys';
import { CONFIG_FALLBACK, STYLE_FALLBACK } from '../constants/styles';
import { readCache, writeCache } from '../utils/cache';
import { ApiError, TRANSPORT_CODES } from '../utils/error';
import { callFunction, uploadSource } from '../utils/cloud';
import { CreateTaskResponse, RuntimeConfig, StyleMeta, TaskDetail, TaskStatus } from '../types';

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
  try {
    const remote = await callFunction<StyleMeta[]>('styles');
    const styles = Array.isArray(remote) && remote.length ? remote : STYLE_FALLBACK;
    writeCache(STORAGE_KEYS.styles, styles);
    return styles;
  } catch {
    return STYLE_FALLBACK;
  }
}

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  const cached = readCache<RuntimeConfig>(STORAGE_KEYS.runtimeConfig, TTL.config);
  if (cached) return cached;
  try {
    const remote = await callFunction<RuntimeConfig>('config');
    const config = { ...CONFIG_FALLBACK, ...remote };
    writeCache(STORAGE_KEYS.runtimeConfig, config);
    return config;
  } catch {
    return CONFIG_FALLBACK;
  }
}

export interface CreateTaskParams {
  filePath: string;
  styleId: string;
  /** 0-100 */
  strength: number;
}

/**
 * 选图并创建风格化任务。
 *
 * 流程：原图先传云存储拿 fileID，再调云函数 create，由云函数后台异步出图。
 * 不再用 wx.uploadFile 打自有服务器。
 */
export function createTask(
  params: CreateTaskParams,
  onProgress?: (percent: number) => void,
): Promise<CreateTaskResponse> {
  return uploadSource(params.filePath, onProgress).then((fileID) =>
    callFunction<CreateTaskResponse>('create', {
      fileID,
      styleId: params.styleId,
      strength: params.strength,
    }),
  );
}

export function fetchTask(taskId: string): Promise<TaskDetail> {
  return callFunction<TaskDetail>('getTask', { taskId });
}

export function isTerminal(status: TaskStatus): boolean {
  return status === 'SUCCEEDED' || status === 'FAILED';
}

/**
 * 轮询直到任务进入终态。
 *
 * 必须设上限：弱网或云函数重启时，无上限轮询会让 loading 一直挂着。
 * 到达上限按超时抛错，让用户能重试。
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

/** 生图云函数名（在微信开发者工具里部署时使用的函数名） */
export const GENERATE_FUNCTION = 'generatelmage-NGR4JB';

/** 生图为同步等待，耗时较长；前端超时放宽到 60s（需与云函数控制台超时配置保持一致） */
export const GEN_TIMEOUT = 60000;

export interface GenerateParams {
  filePath: string;
  styleId: string;
  /** 0-100 */
  strength: number;
}

export interface GenerateResponse {
  resultFileID: string;
  resultUrl?: string;
  costMs?: number;
}

/**
 * 同步生图：上传原图到云存储拿 fileID，调 generatelmage 云函数一次出图，
 * 直接返回生成图的 fileID 与临时直链，无需轮询。
 */
export function generateImage(
  params: GenerateParams,
  onProgress?: (percent: number) => void,
): Promise<GenerateResponse> {
  return uploadSource(params.filePath, onProgress).then((fileID) =>
    callFunction<GenerateResponse>(
      'generate',
      { fileID, styleId: params.styleId, strength: params.strength },
      GENERATE_FUNCTION,
      GEN_TIMEOUT,
    ),
  );
}
