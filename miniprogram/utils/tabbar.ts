/**
 * 自定义 tabBar 的显隐与选中态同步。
 *
 * 为什么不用 z-index 盖住它：
 * app.json 里 tabBar.custom = true，底部菜单由框架自动挂载，渲染在页面内容之上，
 * 属于独立的原生渲染层 —— 页面里任何 z-index 的半屏遮罩都压不住它。
 * （wx.hideTabBar 也不行：那只对原生 tabBar 生效，对自定义组件是空操作。）
 * 所以半屏弹层打开时只能让 tabBar 自己隐藏，入口是 Page 的 getTabBar()。
 *
 * 为什么选中态由页面同步、而不是组件自己算：
 * 框架会复用 tabBar 组件实例，切页时 pageLifetimes.show 可能早于新页面入栈，
 * 此时 getCurrentPages() 还停在上一页 —— 算出来的下标正好和当前页相反（高亮反了），
 * 拿它做点击短路还会出现「点了没反应」。页面自己的 onShow 里 route 必然正确，是唯一真源。
 */

/** tabBar 配置真源：组件渲染与页面同步选中态都从这里取 */
export interface TabItem {
  path: string;
  text: string;
}

export const TAB_LIST: TabItem[] = [
  { path: '/pages/index/index', text: '创作' },
  { path: '/pages/profile/profile', text: '我的' },
];

/**
 * tabBar 高度（rpx），与 custom-tab-bar 里 .tab 的高度保持一致。
 * 页面要算「扣掉底部菜单后还剩多少可视高度」时用它换算成 px。
 */
export const TAB_BAR_RPX_HEIGHT = 100;

interface TabBarInstance {
  setData(data: Record<string, unknown>): void;
}

/** 页面实例：route 是 typings 里有的，getTabBar 只在自定义 tabBar 场景由框架注入 */
interface PageLike {
  route?: string;
  getTabBar?: () => TabBarInstance | null;
}

let hidden = false;

function tabBarOf(page: PageLike | undefined | null): TabBarInstance | null {
  try {
    return page?.getTabBar?.() ?? null;
  } catch {
    return null;
  }
}

function currentPage(): PageLike | undefined {
  const pages = getCurrentPages() as unknown as PageLike[];
  return pages[pages.length - 1];
}

function normalize(route: string | undefined): string {
  return (route ?? '').replace(/^\//, '');
}

/** 半屏弹层打开时传 true，关闭时传 false */
export function setTabBarHidden(next: boolean): void {
  hidden = next;
  tabBarOf(currentPage())?.setData({ hidden: next });
}

/** 供 tabBar 组件自身在 attached / 页面 onShow 时对齐显隐 */
export function isTabBarHidden(): boolean {
  return hidden;
}

/**
 * 由 tab 页在自己的 onShow 里调用（传 this）。
 * 只认「这个页面自己」的路由，不看页面栈顺序，因此不存在时序问题。
 */
export function syncTabBarFromPage(page: PageLike): void {
  const bar = tabBarOf(page);
  if (!bar) return;
  const route = normalize(page.route);
  const selected = TAB_LIST.findIndex((i) => normalize(i.path) === route);
  if (selected < 0) return;
  bar.setData({ selected, hidden });
}