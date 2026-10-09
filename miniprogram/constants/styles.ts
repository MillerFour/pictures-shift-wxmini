import type { RuntimeConfig, StyleMeta } from '../types';

/**
 * 风格的本地兜底数据。
 *
 * 正常路径是启动时从 BFF 拉取（新增风格、改文案不用等发版），
 * 这里只保证接口不可用时页面不至于空白。
 *
 * swatch 选的是低饱和的自然色（苔绿 / 藕荷 / 灰蓝 / 棕褐），
 * 刻意避开高饱和霓虹色 —— 后者在界面里会显得廉价。
 */
export const STYLE_FALLBACK: StyleMeta[] = [
  { id: 'ghibli', name: '吉卜力', subtitle: '手绘动画 · 治愈光影', swatch: '#6f8a5f' },
  { id: 'anime', name: '日系动漫', subtitle: '清透上色 · 大眼萌', swatch: '#c08a93' },
  { id: 'pixar', name: '3D 皮克斯', subtitle: '立体毛发 · 电影打光', swatch: '#5f7f96' },
  { id: 'film', name: '复古胶片', subtitle: '胶片颗粒 · 褪色暖调', swatch: '#8b7455' },
];

/** BFF 不可达时的运行期配置兜底 */
export const CONFIG_FALLBACK: RuntimeConfig = {
  maxFileSizeMB: 8,
  recommendedLongEdge: 1280,
};