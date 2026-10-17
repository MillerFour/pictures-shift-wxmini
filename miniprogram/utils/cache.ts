/** 本地缓存条目（at 保留时间戳，便于排查数据新旧） */
interface CacheEntry<T> {
  at: number;
  value: T;
}

/**
 * 读缓存（忽略年龄，允许陈旧）。
 *
 * 画风列表 / 运行期配置走 stale-while-revalidate：先拿缓存渲染（哪怕已旧），
 * 同时后台静默刷新写回 —— 服务端改完，用户下次打开小程序即更新。
 * 全部异常都吞掉：storage 被清空、空间不足，都不该让页面白屏。
 */
export function peekCache<T>(key: string): T | null {
  try {
    const hit = wx.getStorageSync(key) as CacheEntry<T> | '';
    if (!hit || typeof hit !== 'object') return null;
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
