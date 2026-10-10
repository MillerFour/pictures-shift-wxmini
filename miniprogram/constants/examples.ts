/**
 * 示例功能的素材。
 *
 * 示例用「一张原图 + 各风格对应的成片」做对比滑块，让用户直观感受差异。
 * 当前为本地 SVG 占位（同一构图，原图灰阶 + 各风格上色），开箱即可拖动预览。
 * 接入时把 original 与各风格的 after 换成真实图片地址（建议同一张原图、同一构图，
 * 仅画风不同，对比才直观）；支持本地路径或网络 URL，缺失则回退 original。
 */
export interface ExampleSet {
  /** 示例原图 */
  original: string;
  /** 各风格 id → 成片示例图；缺失则回退 original */
  after: Record<string, string>;
}

export const EXAMPLE: ExampleSet = {
  original: '/assets/examples/original.svg',
  after: {
    ghibli: '/assets/examples/ghibli.svg',
    anime: '/assets/examples/anime.svg',
    pixar: '/assets/examples/pixar.svg',
    film: '/assets/examples/film.svg',
  },
};
