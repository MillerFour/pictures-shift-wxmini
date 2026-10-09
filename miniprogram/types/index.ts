/**
 * 传输层通用信封。
 *
 * BFF 与小程序约定：HTTP 状态码表达「传输是否成功」，
 * code 表达「业务是否成功」，0 为成功。
 * 这样一个接口的失败原因只需看 code，不用逐个接口约定 HTTP 状态。
 */
export interface ApiEnvelope<T> {
  /** 0 = 成功，其余为业务错误码 */
  code: number;
  message: string;
  data: T;
  /** 排查问题时提供给开发者的追踪号 */
  requestId?: string;
}

/** 转换任务状态机：PENDING → RUNNING → SUCCEEDED / FAILED */
export type TaskStatus = 'PENDING' | 'RUNNING' | 'SUCCEEDED' | 'FAILED';

/**
 * 风格展示元数据。
 *
 * 注意这里的 prompt / 模型参数不在小程序端 —— 它们留在 BFF，
 * 这样调风格或加风格只要改服务端配置，不用等小程序审核发版。
 */
export interface StyleMeta {
  id: string;
  name: string;
  subtitle: string;
  /**
   * 画风色板：单一低饱和纯色，用于卡片色块。
   *
   * 之前这里是「一对高饱和渐变色 + emoji」，而霓虹渐变配 emoji 图标这套组合
   * 几乎只出现在 AI 生成的界面里，是要去掉的主要来源。
   */
  swatch: string;
}

/** BFF 下发的运行期配置 */
export interface RuntimeConfig {
  /** 单张原图体积上限（MB），超了 BFF 直接拒收 */
  maxFileSizeMB: number;
  /** 建议压缩到的长边像素 */
  recommendedLongEdge: number;
  /** 运营位提示语，没有就不展示 */
  notice?: string;
}

/** 提交转换任务后的回执 */
export interface CreateTaskResponse {
  taskId: string;
  status: TaskStatus;
}

/** 任务详情（轮询接口返回） */
export interface TaskDetail {
  taskId: string;
  status: TaskStatus;
  /** 0-100，仅用于展示，BFF 拿不到真实进度时不下发 */
  progress?: number;
  /** 风格化结果图地址，小程序自有域名下的相对路径，可直接 <image> 渲染 */
  resultUrl?: string;
  /** 失败原因，成功时为空 */
  errorMessage?: string;
  /** 端到端耗时（毫秒），用于结果页展示 */
  costMs?: number;
}
