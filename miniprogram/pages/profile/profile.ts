import { getQuota, refreshQuota } from '../../utils/quota';
import { setTabBarHidden, syncTabBarFromPage } from '../../utils/tabbar';
import { clearUser, getUser, isLoggedIn, type WxUser } from '../../utils/auth';
import { resolveAvatar } from '../../utils/cloud';
import { buyPackage, fetchPackages, PayError, PayPackage } from '../../services/pay';
import { toFriendlyMessage } from '../../utils/error';

/**
 * 「我的」页：次数余额、购买入口、记录与常用设置。
 *
 * 次数真源在云端 users.quota，进入页面即静默校准；
 * 购买走微信虚拟支付（下单 → 拉起支付 → 服务端确认发货 → 支付成功页）。
 */

interface PayPackageLite {
  id: string;
  count: number;
}
Page({
  data: {
    quota: 0,
    showPay: false,
    /** 次数包（云端下发） */
    packages: [] as PayPackage[],
    packagesLoading: false,
    /** false=演示模式（NEED_PAY=false，服务端模拟发货） */
    payEnabled: true,
    /** 支付编排进行中 */
    paying: false,

    /** 微信登录态：未登录时给出手动登录入口 */
    loggedIn: false,
    user: null as WxUser | null,
    showLogin: false,
    /** 头像直链（由云存储 fileID 经 getTempFileURL 换取），WXML 用此展示 */
    avatarDisplayUrl: '',
  },

  onShow() {
    const user = getUser();
    this.setData({ quota: getQuota(), loggedIn: isLoggedIn(), user });
    this.refreshAvatar(user);
    // 登录后静默校准配额（购买成功页返回时也走这里刷新次数）
    if (isLoggedIn()) {
      void refreshQuota().then((quota) => {
        if (quota >= 0) this.setData({ quota });
      });
    }
    // 高亮由本页自己同步：onShow 时 route 必然正确，不受框架复用 tabBar 实例的时序影响
    syncTabBarFromPage(this);
  },

  /** 手动登录入口 */
  onOpenLogin() {
    this.setData({ showLogin: true });
  },

  onLoginSuccess(_e: { detail: WxUser }) {
    this.setData({ showLogin: false, loggedIn: true, user: getUser() });
    // 登录弹层隐藏过底部菜单，这里立即恢复
    setTabBarHidden(false);
    this.refreshAvatar(getUser());
  },

  onCloseLogin() {
    this.setData({ showLogin: false });
  },

  onLogout() {
    clearUser();
    this.setData({ loggedIn: false, user: null, avatarDisplayUrl: '' });
  },

  /** 头像存的是云存储 fileID，需换成临时直链才能渲染 */
  refreshAvatar(user: WxUser | null) {
    if (user?.avatarFileID) {
      resolveAvatar(user.avatarFileID)
        .then((url) => this.setData({ avatarDisplayUrl: url }))
        .catch(() => this.setData({ avatarDisplayUrl: user?.avatarUrl || '' }));
    } else {
      this.setData({ avatarDisplayUrl: user?.avatarUrl || '' });
    }
  },

  /* ================= 购买（微信虚拟支付） ================= */

  onBuyPack() {
    if (!isLoggedIn()) {
      this.setData({ showLogin: true });
      return;
    }
    void this.openPaywall();
  },

  /** 打开付费墙：拉取云端套餐（价格与档位以后台虚拟支付道具为准） */
  async openPaywall(): Promise<void> {
    if (this.data.packagesLoading) return;
    this.setData({ showPay: true, packagesLoading: true });
    try {
      const { payEnabled, packages } = await fetchPackages();
      this.setData({ packages, payEnabled });
    } catch (err) {
      this.setData({ showPay: false });
      wx.showToast({ title: toFriendlyMessage(err, '套餐加载失败'), icon: 'none' });
    } finally {
      this.setData({ packagesLoading: false });
    }
  },

  onClosePay() {
    if (this.data.paying) return;
    this.setData({ showPay: false });
  },

  /** 选中次数包 → 下单 → 拉起微信虚拟支付 → 服务端确认发货 → 成功页 */
  onBuyPay(e: { detail: PayPackageLite }) {
    const id = e.detail?.id;
    if (!id || this.data.paying) return;
    void this.buy(id);
  },

  async buy(packageId: string): Promise<void> {
    this.setData({ paying: true });
    try {
      const result = await buyPackage(packageId);
      this.setData({ showPay: false, paying: false, packages: [] });
      // 结果页返回时 onShow 会校准次数；这里先乐观更新，避免返回瞬间显示旧值
      const quota = await refreshQuota();
      this.setData({ quota: quota >= 0 ? quota : this.data.quota });
      wx.navigateTo({ url: `/pages/pay-success/pay-success?orderId=${result.outTradeNo}` });
    } catch (err) {
      this.setData({ paying: false });
      if (err instanceof PayError && err.reason === 'CANCELLED') return; // 用户取消，不打扰
      wx.showModal({ title: '支付未完成', content: toFriendlyMessage(err), showCancel: false });
    }
  },

  onGoHistory() {
    wx.navigateTo({ url: '/pages/history/history' });
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
