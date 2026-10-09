/** 带 TTL 的本地缓存条目 */
interface CacheEntry<T> {
  at: number;
  value: T;
}

/**
 * 读缓存。过期即删。
 *
 * 只用于「风格列表」「运行期配置」这类读多写少、允许短暂陈旧的数据。
 * 全部异常都吞掉：storage 被清空、空间不足，都不该让页面白屏。
 */
export function readCache<T>(key: string, ttlMs: number): T | null {
  try {
    const hit = wx.getStorageSync(key) as CacheEntry<T> | '';
    if (!hit || typeof hit !== 'object') return null;
    if (Date.now() - hit.at > ttlMs) {
      wx.removeStorageSync(key);
      return null;
    }
    return hit.value ?? null;
  } catch {
    return null;
  }
}

export function writeCache(key: string, value: unknown): void {
  try {
    wx.setStorageSync(key, { at: Date.now(), value } as CacheEntry<unknown>);
  } catch {
    /* 空间不足时放弃缓存，不影响主流程 */
  }
}
