import { STORAGE_KEYS } from '../constants/keys';
import { CONFIG_FALLBACK, STYLE_FALLBACK } from '../constants/styles';
import { peekCache, writeCache } from '../utils/cache';
import { CLOUD_FUNCTIONS, callFunction, taskStamp, uploadCloudFile } from '../utils/cloud';
import { getUser } from '../utils/auth';
import { ModelMeta, RuntimeConfig, StyleMeta, TaskRecord } from '../types';

/**
 * 后台静默刷新的去重标记：同一次运行内，同一个 key 只发一次刷新请求。
 */
const revalidating = new Set<string>();

/**
 * stale-while-revalidate 的刷新半边：拉到新值写回缓存，失败/空值保持旧缓存。
 * 生效速度优先 —— 服务端改完画风/配置，用户下次打开小程序即更新；
 * 本次首屏不受影响（仍渲染缓存），刷新失败也不打扰用户。
 */
function revalidate(key: string, fetcher: () => Promise<unknown>): void {
  if (revalidating.has(key)) return;
  revalidating.add(key);
  fetcher()
    .then((value) => {
      if (value != null) writeCache(key, value);
    })
    .catch(() => undefined)
    .finally(() => revalidating.delete(key));
}

/** 启动预热。失败静默 —— 页面都有本地兜底，不该在启动阶段打扰用户 */
export function warmup(): Promise<unknown> {
  return Promise.allSettled([loadStyles(), loadRuntimeConfig()]);
}

/** 拉取画风列表；空列表/失败返回 null（保持旧缓存，不写兜底覆盖真值） */
async function fetchStyles(): Promise<StyleMeta[] | null> {
  try {
    const remote = await callFunction<StyleMeta[]>('styles', {}, CLOUD_FUNCTIONS.appConfig);
    return Array.isArray(remote) && remote.length ? remote : null;
  } catch {
    return null;
  }
}

/** 缓存命中判定：数组要有元素才算命中，对象非空即可 */
function cacheHit(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/**
 * stale-while-revalidate 的读取半边：有缓存立即返回 + 后台静默刷新；
 * 无缓存时等待首拉，首拉空值 / 失败回落 fallback 且不写缓存（防空值覆盖真值）。
 * writeOnFirstLoad：首拉成功是否落缓存 —— 模型列表与引擎密钥状态强相关、
 * 变化频繁，刻意不落缓存保证每次冷启动都拿最新；画风 / 配置正常落。
 */
function swrLoad<T>(options: {
  key: string;
  fetcher: () => Promise<T | null>;
  fallback: T;
  writeOnFirstLoad: boolean;
}): Promise<T> {
  const cached = peekCache<T>(options.key);
  if (cacheHit(cached)) {
    revalidate(options.key, options.fetcher);
    return Promise.resolve(cached as T);
  }
  return options.fetcher().then((value) => {
    if (!value) return options.fallback;
    if (options.writeOnFirstLoad) writeCache(options.key, value);
    return value;
  });
}

/**
 * 画风列表（stale-while-revalidate）。
 * 有缓存立即渲染 + 后台刷新：上架新画风后，用户下次打开小程序即见；
 * 无缓存（首装）等待网络，失败退回内置兜底。
 */
export function loadStyles(): Promise<StyleMeta[]> {
  return swrLoad({ key: STORAGE_KEYS.styles, fetcher: fetchStyles, fallback: STYLE_FALLBACK, writeOnFirstLoad: true });
}

/**
 * 任务档案（历史创作）：分页拉取当前用户的生成记录。
 * 结果图 fileID 需先用 resolveTempUrls 换临时直链才能渲染。
 */
export function fetchTasks(limit = 20, skip = 0): Promise<TaskRecord[]> {
  return callFunction<TaskRecord[]>('listTasks', { limit, skip }, CLOUD_FUNCTIONS.records);
}

/** 拉取模型列表；空列表/失败返回 null（保持旧缓存） */
async function fetchModels(): Promise<ModelMeta[] | null> {
  try {
    const remote = await callFunction<ModelMeta[]>('models', {}, CLOUD_FUNCTIONS.generate);
    return Array.isArray(remote) && remote.length ? remote : null;
  } catch {
    return null;
  }
}

/**
 * 可用生图模型列表（模型选择数据源）。
 * 服务端按密钥配置过滤，空列表 = 无可选模型，页面隐藏选择器。
 * 缓存策略同画风：立即渲染缓存 + 后台静默刷新。
 */
export function loadModels(): Promise<ModelMeta[]> {
  return swrLoad({ key: STORAGE_KEYS.models, fetcher: fetchModels, fallback: [], writeOnFirstLoad: false });
}

/** 拉取运行期配置；失败返回 null（保持旧缓存） */
async function fetchRuntimeConfig(): Promise<RuntimeConfig | null> {
  try {
    const remote = await callFunction<RuntimeConfig>('config', {}, CLOUD_FUNCTIONS.appConfig);
    return remote && typeof remote === 'object' ? { ...CONFIG_FALLBACK, ...remote } : null;
  } catch {
    return null;
  }
}

/** 运行期配置（stale-while-revalidate，策略同画风） */
export function loadRuntimeConfig(): Promise<RuntimeConfig> {
  return swrLoad({ key: STORAGE_KEYS.runtimeConfig, fetcher: fetchRuntimeConfig, fallback: CONFIG_FALLBACK, writeOnFirstLoad: true });
}

/** 生图云函数名（在微信开发者工具里部署时使用的函数名） */
export const GENERATE_FUNCTION = CLOUD_FUNCTIONS.generate;

/** 生图为同步等待，耗时较长；前端超时放宽到 60s（需与云函数控制台超时配置保持一致） */
export const GEN_TIMEOUT = 60000;

export interface GenerateParams {
  filePath: string;
  styleId: string;
  /** 0-100 */
  strength: number;
  /** 模型选择：模型目录 id，缺省走服务端默认引擎 */
  modelId?: string;
}

export interface GenerateResponse {
  resultFileID: string;
  resultUrl?: string;
  costMs?: number;
}

/**
 * 同步生图：原图落到 task/{openid}/{stamp}_original.{ext}，调 generate-image
 * 云函数一次出图（成图自动落 task/{openid}/{stamp}_result.{ext}，与原图配对），
 * 直接返回生成图的 fileID 与临时直链，无需轮询。
 */
export function generateImage(
  params: GenerateParams,
  onProgress?: (percent: number) => void,
): Promise<GenerateResponse> {
  const openid = getUser()?.openid;
  if (!openid) return Promise.reject(new Error('请先登录后再生成'));
  const stamp = taskStamp();
  const ext = (params.filePath.split('.').pop() || 'jpg').toLowerCase();
  const cloudPath = `task/${openid}/${stamp}_original.${ext}`;
  return uploadCloudFile(cloudPath, params.filePath, onProgress).then((fileID) =>
    callFunction<GenerateResponse>(
      'generate',
      { fileID, styleId: params.styleId, strength: params.strength, modelId: params.modelId, taskStamp: stamp },
      GENERATE_FUNCTION,
      GEN_TIMEOUT,
    ),
  );
}
