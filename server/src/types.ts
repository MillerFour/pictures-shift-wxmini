/**
 * 前后端共享的传输契约。
 *
 * 与 miniprogram/types/index.ts 一一对应，改动必须两边同时改。
 * 这里不 import 小程序代码：两边是独立构建的工程，共享一份「约定」
 * 比共享一份「编译产物」更稳。
 */

/** HTTP 2xx 且 code === 0 才算成功 */
export interface ApiEnvelope<T> {
  code: number;
  message: string;
  data: T;
  requestId?: string;
}

export type TaskStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

/** 展示用风格元数据，与 StyleDefinition 的对外投影 */
export interface StyleMeta {
  id: string;
  name: string;
  subtitle: string;
  /** 画风色板：单一低饱和纯色，与小程序端 constants/styles.ts 保持一致 */
  swatch: string;
}
export interface RuntimeConfig {
  maxFileSizeMB: number;
  recommendedLongEdge: number;
  notice?: string;
}

export interface CreateTaskResponse {
  taskId: string;
  status: TaskStatus;
}

export interface TaskDetail {
  taskId: string;
  status: TaskStatus;
  progress?: number;
  /** 小程序自有域名下的相对路径，可直接 <image> 渲染 */
  resultUrl?: string;
  errorMessage?: string;
  costMs?: number;
}

/**
 * 风格定义（仅服务端持有）。
 *
 * prompt 与厂商参数故意不放进 StyleMeta：
 * 风格是可以随时加减的运营配置，放小程序端意味着每次调整都要等审核发版。
 */
export interface StyleDefinition extends StyleMeta {
  /** 正向提示词 */
  prompt: string;
  /** 负向提示词 */
  negativePrompt: string;
  /**
   * 风格强度 0-100 到厂商 guidance 参数的映射区间。
   * 取值范围随厂商而异，这里只表达「线性映射到 [min, max]」。
   */
  guidance: [number, number];
  /** IP 风格（如吉卜力）靠提示词兜底效果有限，建议配参考图 */
  ipStyle: boolean;
}
