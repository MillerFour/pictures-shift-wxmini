import { STORAGE_KEYS } from '../constants/keys';
import { fetchFreeQuota } from '../services/pay';

/**
 * 剩余次数（配额）。
 *
 * 真源在云端 users.quota：下单扣减、购买发货都发生在服务端，
 * 本地 storage 只是缓存展示值，用来做「是否弹付费墙」的快速判断。
 *
 * 约定：quota >= 0 为已知值；QUOTA_UNKNOWN(-1) 表示尚未从云端拉过。
 * 判断「能否生成」最终以生图云函数的服务端扣减为准，本地值只做体验优化。
 */

/** 尚未从云端获取过配额 */
export const QUOTA_UNKNOWN = -1;

export function getQuota(): number {
  try {
    const v = wx.getStorageSync(STORAGE_KEYS.quota);
    return typeof v === 'number' && v >= 0 ? v : QUOTA_UNKNOWN;
  } catch {
    return QUOTA_UNKNOWN;
  }
}

export function setQuota(n: number): void {
  try {
    wx.setStorageSync(STORAGE_KEYS.quota, Math.max(0, Math.floor(n)));
  } catch {
    /* 忽略：仅本地缓存 */
  }
}

/** 从云端拉取最新免费次数余额并写缓存；失败保持原值 */
export async function refreshQuota(): Promise<number> {
  try {
    const quota = await fetchFreeQuota();
    setQuota(quota);
    return quota;
  } catch {
    return getQuota();
  }
}

/** 生成成功后本地乐观减一（真值随后由 refreshQuota 校准） */
export function consumeQuota(): void {
  const current = getQuota();
  if (current >= 0) setQuota(current - 1);
}
