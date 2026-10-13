import { STORAGE_KEYS } from '../constants/keys';

/**
 * 登录用户态（本地会话）。
 *
 * 真实微信 openid 由云函数侧 cloud.getWXContext().OPENID 获取（前端无法伪造，
 * 见 services/auth 的 login 函数），这里只负责把云函数回写的 openid 与用户
 * 授权的头像、昵称持久化到本地存储，供页面判断是否已登录。
 */

export interface WxUser {
  /** 微信 openid，账户唯一标识 */
  openid: string;
  /** 昵称（用户授权） */
  nickname: string;
  /** 头像在云存储的 fileID；展示时需经 getTempFileURL 换直链，避免微信临时路径失效 */
  avatarFileID: string;
  /** 旧版兼容：可直接展示的头像直链（可选） */
  avatarUrl?: string;
}

/** 读取已登录用户；缺失或结构不全返回 null */
export function getUser(): WxUser | null {
  try {
    const raw = wx.getStorageSync(STORAGE_KEYS.user) as WxUser | undefined;
    if (raw && raw.openid) return raw;
  } catch {
    /* 存储异常不阻断流程，按未登录处理 */
  }
  return null;
}

/** 是否已登录：本地有完整用户态即视为已登录 */
export function isLoggedIn(): boolean {
  return getUser() !== null;
}

export function saveUser(user: WxUser): void {
  wx.setStorageSync(STORAGE_KEYS.user, user);
}

export function clearUser(): void {
  wx.removeStorageSync(STORAGE_KEYS.user);
}
