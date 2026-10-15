import { confirmOrder, type OrderResult } from '../../services/pay';

/**
 * 支付结果页。
 *
 * 进入时向服务端确认订单（顺带触发查单补发货），状态确认前轮询：
 * - DELIVERED：展示成功 + 到账次数 + 最新余额
 * - REFUNDED：退款提示
 * - 轮询到上限仍未终态：给出「确认中」兜底文案，用户稍后可在「我的」看到到账
 *
 * 返回语义：从哪个页面跳进来（首页 / 我的），点「完成」或系统返回就回哪里 ——
 * 本页永远通过 navigateTo 进入，navigateBack 即回到原页面。
 */

type PayState = 'checking' | 'success' | 'refunded' | 'unknown';

/** 轮询：2.5s × 8 ≈ 20s，覆盖正常发货推送/查单确认的时延 */
const POLL_INTERVAL = 2500;
const MAX_ATTEMPTS = 8;

Page({
  data: {
    state: 'checking' as PayState,
    /** 到账次数 */
    count: 0,
    /** 确认后的最新剩余次数 */
    quota: 0,
    orderId: '',
  },

  alive: true,
  attempts: 0,
  timer: null as number | null,

  onLoad(options: Record<string, string | undefined>) {
    const orderId = (options && options.orderId) || '';
    this.setData({ orderId });
    if (!orderId) {
      this.setData({ state: 'unknown' });
      return;
    }
    void this.poll();
  },

  onUnload() {
    this.alive = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  },

  async poll(): Promise<void> {
    if (!this.alive) return;
    let result: OrderResult | null = null;
    try {
      result = await confirmOrder(this.data.orderId);
    } catch {
      // 单次查询失败不算终局，继续轮询
    }
    if (!this.alive) return;

    if (result) {
      if (result.status === 'DELIVERED') {
        this.setData({ state: 'success', count: result.count, quota: result.quota });
        return;
      }
      if (result.status === 'REFUNDED') {
        this.setData({ state: 'refunded' });
        return;
      }
    }

    this.attempts += 1;
    if (this.attempts >= MAX_ATTEMPTS) {
      this.setData({ state: 'unknown' });
      return;
    }
    this.timer = setTimeout(() => void this.poll(), POLL_INTERVAL) as unknown as number;
  },

  /** 回到跳转进来的页面（首页或「我的」） */
  onBack(): void {
    if (getCurrentPages().length > 1) {
      wx.navigateBack();
    } else {
      // 理论上不可达（本页总是被 navigateTo 打开）；兜底回首页
      wx.switchTab({ url: '/pages/index/index' });
    }
  },

  /** 确认超时后给用户一个手动重试的入口 */
  onRetry(): void {
    this.attempts = 0;
    this.setData({ state: 'checking' });
    void this.poll();
  },
});
