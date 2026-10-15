import type { PayPackage } from '../../services/pay';
import { setTabBarHidden } from '../../utils/tabbar';

/**
 * 付费墙弹层（纯展示）。
 *
 * 套餐数据由父页面从云端拉取后经 properties 下发（价格/档位以
 * MP 后台虚拟支付道具为准，前端不再维护定价真源）。
 * 购买编排（登录 → 下单 → 拉起支付 → 服务端确认）也由父页面处理，
 * 本组件只回传所选道具 id 与 paying 状态展示。
 */

Component({
  options: { addGlobalClass: true },

  properties: {
    show: { type: Boolean, value: false },
    packages: { type: Array, value: [] as PayPackage[] },
    /** 父页面支付编排进行中：按钮禁用防止重复拉起 */
    paying: { type: Boolean, value: false },
    /** false=演示模式（服务端模拟发货，不拉真实收银台） */
    payEnabled: { type: Boolean, value: true },
  },

  /** 半屏必须盖住底部菜单：tabBar 在独立渲染层，遮罩压不住，只能让它自己隐藏 */
  observers: {
    show(val: boolean) {
      setTabBarHidden(val);
    },
    /** 默认选中第一档；套餐刷新后若当前选择已失效则回落 */
    packages(list: PayPackage[]) {
      const ids = (list || []).map((p) => p.id);
      if (!ids.includes(this.data.selectedId) && ids.length) {
        this.setData({ selectedId: ids[0] });
      }
    },
  },

  data: {
    selectedId: '',
  },

  methods: {
    onClose() {
      if (this.data.paying) return;
      this.triggerEvent('close');
    },

    onSelect(e: { currentTarget: { dataset: { id?: string } } }) {
      const id = e.currentTarget.dataset.id;
      if (id && !this.data.paying) this.setData({ selectedId: id });
    },

    onBuy() {
      if (this.data.paying) return;
      const pkg = ((this.data.packages as PayPackage[]) || []).find((p) => p.id === this.data.selectedId);
      if (!pkg) return;
      this.triggerEvent('buy', { id: pkg.id });
    },

    // 点卡片内部不关闭弹层
    noop() {},
  },
});
