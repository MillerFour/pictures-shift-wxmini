/**
 * 风格展示元数据。
 *
 * 注意这里的 prompt / 模型参数不在小程序端 —— 它们留在云函数与云数据库，
 * 这样调风格或加风格只要改云端配置，不用等小程序审核发版。
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

/** 任务档案（一次成功生成的记录，由服务端写入 tasks 集合） */
export interface TaskRecord {
  id: string;
  styleName: string;
  modelName: string;
  /** 0-100 生成时的画风强度 */
  strength: number;
  /** 端到端耗时（毫秒） */
  costMs: number;
  /** 结果图在云存储的 fileID（task/{openid}/{stamp}_result.{ext}），展示前换临时直链 */
  resultFileID: string;
  createdAt: number;
}

/** 生图模型元数据（「模型选择」下发，参数细节留在服务端） */
export interface ModelMeta {
  id: string;
  name: string;
  desc: string;
}

/** 云端下发的运行期配置 */
export interface RuntimeConfig {
  /** 单张原图体积上限（MB），超了云端直接拒收 */
  maxFileSizeMB: number;
  /** 建议压缩到的长边像素 */
  recommendedLongEdge: number;
  /** 运营位提示语，没有就不展示 */
  notice?: string;
}
