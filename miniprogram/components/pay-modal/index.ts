interface PayPackage {
  id: string;
  name: string;
  desc: string;
  price: string;
  count: number;
  tag?: string;
}

/**
 * 次数包定价为占位数据，最终档位 / 价格以实际上线为准。
 * 微信支付 API 对接暂作预留：onBuy 只把所选套餐回传父级做本地占位授予。
 */
const PACKAGES: PayPackage[] = [
  { id: 'free', name: '免费体验', desc: '新用户专享', price: '¥0', count: 1, tag: '已赠送' },
  { id: 'trial', name: '体验包', desc: '约 ¥0.7 / 张', price: '¥6.8', count: 10, tag: '推荐' },
  { id: 'value', name: '超值包', desc: '约 ¥0.5 / 张', price: '¥19.9', count: 40, tag: '更划算' },
];

import { setTabBarHidden } from '../../utils/tabbar';

Component({
  options: { addGlobalClass: true },

  properties: {
    show: { type: Boolean, value: false },
  },

  /** 半屏必须盖住底部菜单：tabBar 在独立渲染层，遮罩压不住，只能让它自己隐藏 */
  observers: {
    show(val: boolean) {
      setTabBarHidden(val);
    },
  },

  data: {
    packages: PACKAGES,
    selectedId: 'trial',
  },

  methods: {
    onClose() {
      this.triggerEvent('close');
    },

    onSelect(e: { currentTarget: { dataset: { id?: string } } }) {
      const id = e.currentTarget.dataset.id;
      if (id) this.setData({ selectedId: id });
    },

    onBuy() {
      const pkg = (this.data.packages as PayPackage[]).find((p) => p.id === this.data.selectedId);
      if (!pkg) return;
      // TODO: 微信支付 API 对接暂作预留。真实流程：后端下发 prepay → wx.requestPayment。
      // 此处仅把所选套餐回传给父级做本地占位授予。
      this.triggerEvent('buy', { id: pkg.id, count: pkg.count });
    },

    // 点卡片内部不关闭弹层
    noop() {},
  },
});
