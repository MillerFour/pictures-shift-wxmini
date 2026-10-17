import { CLOUD_FUNCTIONS, callFunction } from '../utils/cloud';

/**
 * 虚拟支付（wx.requestVirtualPayment · 道具直购）前端编排。
 *
 * 流程与责任边界：
 * 1. wx.login 拿新 code（云函数用它换 session_key 算 signature）
 * 2. 云函数 createOrder：生成业务单号、落库、算双签名，返回 payData
 * 3. wx.requestVirtualPayment(payData) 拉起微信支付
 * 4. 云函数 queryOrder：服务端查单确认 + 幂等发货
 *
 * 客户端的 success 回调只是 UI 反馈；次数到账一律以第 4 步服务端确认为准。
 */

export interface PayPackage {
  /** 道具 id（MP 后台道具管理中的 productId） */
  id: string;
  name: string;
  /** 单位：分，仅透传展示用，支付金额以后台道具为准 */
  priceFen: number;
  /** 服务端格式化好的价格文案，如 ¥6.8 */
  priceText: string;
  count: number;
  /** 服务端格式化好的单次文案，如 约 ¥0.68/次 */
  unitText: string;
  tag?: string;
}

export type OrderStatus = 'CREATED' | 'PAID' | 'DELIVERED' | 'REFUNDED';

export interface OrderResult {
  status: OrderStatus;
  /** 本次订单包含的次数 */
  count: number;
  /** 服务端确认后的最新剩余次数 */
  quota: number;
  productId: string;
}

export interface BuyResult {
  outTradeNo: string;
  count: number;
  quota: number;
}

/** 支付链路专用错误：页面据此决定静默、提示还是跳升级引导 */
export class PayError extends Error {
  readonly reason: 'CANCELLED' | 'NOT_SUPPORTED' | 'IOS_NEED_UPGRADE' | 'FAILED';

  constructor(reason: PayError['reason'], message: string) {
    super(message);
    this.name = 'PayError';
    this.reason = reason;
  }
}

/** iOS 虚拟支付要求微信客户端 8.0.68+（苹果 IAP 通道） */
const MIN_WECHAT_VERSION = '8.0.68';

function compareVersion(a: string, b: string): number {
  const pa = a.split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

function wechatVersion(): string {
  try {
    const info = wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync();
    return (info as { version?: string }).version || '';
  } catch {
    return '';
  }
}

function platform(): string {
  try {
    return wx.getSystemInfoSync().platform || '';
  } catch {
    return '';
  }
}

/** 拉起支付前的环境检查：API 存在性 + iOS 版本门槛 */
function assertPayable(): void {
  if (typeof wx.requestVirtualPayment !== 'function') {
    throw new PayError('NOT_SUPPORTED', '当前微信版本不支持虚拟支付，请升级微信后重试');
  }
  if (platform() === 'ios') {
    const version = wechatVersion();
    if (version && compareVersion(version, MIN_WECHAT_VERSION) < 0) {
      throw new PayError('IOS_NEED_UPGRADE', `iOS 支付需要微信 ${MIN_WECHAT_VERSION} 及以上，请升级微信`);
    }
  }
}

export interface PayPackagesResult {
  /** true=走真实虚拟支付；false=演示模式（服务端模拟发货，不拉收银台） */
  payEnabled: boolean;
  packages: PayPackage[];
}

export function fetchPackages(): Promise<PayPackagesResult> {
  return callFunction<PayPackagesResult>('payPackages', {}, CLOUD_FUNCTIONS.pay);
}

export function fetchFreeQuota(): Promise<number> {
  return callFunction<{ quota: number }>('getFreeQuota', {}, CLOUD_FUNCTIONS.freeQuota).then((r) => r.quota);
}

function wxLogin(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    wx.login({
      success: (res) => (res.code ? resolve(res.code) : reject(new Error('wx.login 未返回 code'))),
      fail: (err) => reject(new Error(err.errMsg || 'wx.login 失败')),
    });
  });
}

interface PayData {
  signData: string;
  /** 与云函数 buildPayData 的 mode 一致：道具直购 */
  mode: 'short_series_goods' | 'short_series_coin';
  paySig: string;
  signature: string;
}

function requestVirtualPayment(payData: PayData): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    wx.requestVirtualPayment({
      ...payData,
      success: () => resolve(),
      fail: (err: { errMsg?: string }) => {
        const msg = err.errMsg || '';
        if (/cancel/i.test(msg)) reject(new PayError('CANCELLED', '已取消支付'));
        else reject(new PayError('FAILED', msg || '支付未完成'));
      },
      // 官方 API 要求 signData 为 JSON 字符串（云函数签名也基于该字符串），
      // 类型库却将其声明为 SignData 对象，按运行时事实断言
    } as unknown as WechatMiniprogram.RequestVirtualPaymentOption);
  });
}

/**
 * 完整购买编排。
 * 服务端 NEED_PAY=false 时返回 mock 单（无 payData）：跳过拉起支付，直接确认到账。
 * 真实支付时，客户端 success 回调只是 UI 反馈，次数到账一律以服务端查单确认为准。
 */
export async function buyPackage(packageId: string): Promise<BuyResult> {
  const created = await callFunction<{ outTradeNo: string; mock?: boolean; payData?: PayData }>(
    'createOrder',
    {
      productId: packageId,
      code: await wxLogin(),
    },
    CLOUD_FUNCTIONS.pay,
  );

  if (created.mock || !created.payData) {
    // 演示模式：服务端已模拟发货，直接确认订单拿最新配额
    const confirmed = await confirmOrder(created.outTradeNo);
    if (confirmed.status !== 'DELIVERED') {
      throw new PayError('FAILED', '订单未完成，请稍后在「我的」查看');
    }
    return { outTradeNo: created.outTradeNo, count: confirmed.count, quota: confirmed.quota };
  }

  assertPayable();

  try {
    await requestVirtualPayment(created.payData);
  } catch (err) {
    // fail 不等于未支付（弱网下 success 回调可能丢失），先服务端查一次单
    if (err instanceof PayError && err.reason === 'CANCELLED') throw err;
    try {
      const confirmed = await confirmOrder(created.outTradeNo);
      if (confirmed.status === 'DELIVERED') {
        return { outTradeNo: created.outTradeNo, count: confirmed.count, quota: confirmed.quota };
      }
    } catch (confirmErr) {
      // 查单也失败：按未完成支付向上抛原始错误
    }
    throw err;
  }

  const confirmed = await confirmOrder(created.outTradeNo);
  return { outTradeNo: created.outTradeNo, count: confirmed.count, quota: confirmed.quota };
}

/** 查询订单状态（服务端会顺带查单补发货）。支付成功页轮询使用。 */
export function confirmOrder(outTradeNo: string): Promise<OrderResult> {
  return callFunction<OrderResult>('queryOrder', { outTradeNo }, CLOUD_FUNCTIONS.pay);
}
