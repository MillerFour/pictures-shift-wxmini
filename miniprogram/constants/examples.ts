/**
 * 示例功能的素材。
 *
 * 示例用「一张原图 + 各风格对应的成片」做对比滑块，让用户直观感受差异。
 * 素材由 server/scripts/gen-examples.ts 走正式链路生成（同一只小熊猫、同一构图，
 * 仅画风不同，对比才直观）；支持本地路径或网络 URL。
 *
 * 首屏的画风芯片点一下就切换这里的成片：选了某个画风、预览却不动，
 * 等于告诉用户「这个选择和预览无关」，联动是必须的。
 */
export interface ExampleSet {
  /** 示例原图 */
  original: string;
  /** 各风格 id → 成片示例图 */
  after: Record<string, string>;
}

export const EXAMPLE: ExampleSet = {
  original: '/assets/example-panda.jpg',
  after: {
    ghibli: '/assets/example-panda-ghibli.jpg',
    anime: '/assets/example-panda-anime.jpg',
    pixar: '/assets/example-panda-pixar.jpg',
    film: '/assets/example-panda-film.jpg',
  },
};

/** 首屏默认展示的画风，也是「画风没有对应素材时」的兜底 */
export const DEFAULT_EXAMPLE_STYLE = 'ghibli';

/** 画风没有本地示例时回退到默认那张，保证滑块两侧始终是「原图 vs 风格化」 */
export function exampleAfterOf(styleId: string): string {
  return EXAMPLE.after[styleId] ?? EXAMPLE.after[DEFAULT_EXAMPLE_STYLE] ?? EXAMPLE.original;
}
