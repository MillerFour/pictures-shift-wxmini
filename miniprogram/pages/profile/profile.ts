import { getQuota, setQuota } from '../../utils/quota';

interface PayPackageLite {
  id: string;
  count: number;
}

/**
 * 「我的」页：次数余额、购买入口、记录与常用设置。
 *
 * 次数与记录真实数据来自后端，这里读本地占位配额；
 * 微信支付 / 记录列表 API 对接暂作预留。
 */
Page({
  data: {
    quota: 0,
    /** 生成记录占位，真实数据来自后端 */
    records: [] as { id: string; styleName: string; time: string }[],
    showPay: false,
  },

  onShow() {
    this.setData({ quota: getQuota() });
  },

  onBuyPack() {
    this.setData({ showPay: true });
  },

  onClosePay() {
    this.setData({ showPay: false });
  },

  onBuyPay(e: { detail: PayPackageLite }) {
    // TODO: 微信支付 API 对接暂作预留；此处模拟购买成功并本地授予次数。
    const count = e.detail?.count ?? 0;
    setQuota(getQuota() + count);
    this.setData({ showPay: false, quota: getQuota() });
    wx.showToast({ title: '购买成功（模拟）', icon: 'success' });
  },

  onGoDisclaimer() {
    wx.navigateTo({ url: '/pages/disclaimer/disclaimer' });
  },

  onGoFaq() {
    wx.navigateTo({ url: '/pages/faq/faq' });
  },

  onContact() {
    wx.showModal({
      title: '联系客服',
      content: '客服功能接入中。商务合作请联系：hello@pictures-shift.com',
      showCancel: false,
    });
  },
});
