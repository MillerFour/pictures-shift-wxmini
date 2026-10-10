import { STORAGE_KEYS } from '../constants/keys';

/**
 * 登录用户态。
 *
 * 这里是「应用级会话」：小程序没有本地可读的微信 openid，必须走
 * wx.login 拿 code、再由后端换 openid（见 services/auth）。头像与昵称
 * 则由用户在授权弹层里通过 chooseAvatar / nickname 输入显式授予。
 *
 * 本仓库后端尚未打通时，会话以本地存储为准；接好后端后这套逻辑不变，
 * 只是 openid 从「兜底伪值」换成「真实值」。
 */
export interface WxUser {
  /** 微信 openid，账户唯一标识 */
  openid: string;
  /** 昵称（用户授权） */
  nickname: string;
  /** 头像地址（chooseAvatar 给的临时路径，真实环境应上传后换成 CDN 地址） */
  avatarUrl: string;
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

/**
 * 封装 wx.login 为 Promise。
 * 拿到的 code 一次性有效，仅用于交给后端换 openid，不要本地留存。
 */
export function wxLogin(): Promise<string> {
  return new Promise((resolve, reject) => {
    wx.login({
      success: (res) => {
        if (res.code) resolve(res.code);
        else reject(new Error('微信登录失败：未返回 code'));
      },
      fail: (e) => reject(new Error(e.errMsg || '微信登录失败')),
    });
  });
}
