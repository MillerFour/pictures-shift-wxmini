import { TAB_LIST, isTabBarHidden, syncTabBarFromPage } from '../utils/tabbar';

/**
 * 自定义底部 tabBar。
 *
 * app.json 里 tabBar.custom = true，框架会把这个组件自动挂到每个 tab 页上，
 * 页面里不要再手动 <custom-tab-bar />（会多出一个实例，且 getTabBar() 拿不到它）。
 *
 * 组件只负责渲染与点击；选中态由 tab 页在自己的 onShow 里调
 * utils/tabbar.syncTabBarFromPage 同步过来 —— 见该文件里「为什么选中态由页面同步」。
 */

function currentRoute(): string {
  const pages = getCurrentPages();
  const current = pages[pages.length - 1];
  return (current ? current.route : '').replace(/^\//, '');
}

Component({
  data: {
    /** 由 syncTabBarFromPage 写入，初始值只用于首帧渲染前不闪烁 */
    selected: 0,
    /** 半屏弹层打开时隐藏，避免它浮在遮罩之上 */
    hidden: false,
    list: TAB_LIST,
  },

  lifetimes: {
    attached() {
      this.syncHidden();
    },
  },

  pageLifetimes: {
    show() {
      this.syncHidden();
    },
  },

  methods: {
    /** 显隐真源在 utils/tabbar（模块级状态），与路由无关，可以放心自己对齐 */
    syncHidden() {
      const hidden = isTabBarHidden();
      if (hidden !== this.data.hidden) this.setData({ hidden });
    },

    onTap(e: WechatMiniprogram.BaseEvent) {
      const idx = Number(e.currentTarget.dataset.index);
      const item = this.data.list[idx];
      if (!item) return;

      // 点击发生在当前页，页面栈此刻是稳定的，可以直接判断是否还在这一页。
      // 不用 this.data.selected —— 那是异步同步出来的缓存值，拿它判断会误吞点击。
      if (currentRoute() === item.path.replace(/^\//, '')) return;

      // 乐观更新：先切高亮，不等页面回显
      this.setData({ selected: idx });
      wx.switchTab({
        url: item.path,
        fail: (err) => {
          // 没跳走就以真实所在页为准回滚
          const pages = getCurrentPages() as unknown as { route?: string }[];
          syncTabBarFromPage(pages[pages.length - 1]);
          console.warn('[tabBar] switchTab 失败:', item.path, err);
        },
      });
    },
  },
});