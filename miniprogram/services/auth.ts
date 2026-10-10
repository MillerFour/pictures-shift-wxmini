import { request } from '../utils/request';

export interface LoginResult {
  /** 微信 openid，账户唯一标识 */
  openid: string;
}

/**
 * 用 wx.login 拿到的 code 向后端换 openid。
 *
 * 后端职责：拿 code 调微信 jscode2session 换成 openid + session_key，
 * 建立本应用账户会话。前端不碰 session_key，也不留存 code。
 *
 * 后端未就绪时（开发 / 联调）做本地兜底：生成一个伪 openid，
 * 让授权登录流程在开发者工具里也能走通；接好后端后即走真实分支。
 * 兜底分支仅用于联调，真机与正式版务必以后端返回为准。
 */
export async function loginWithCode(code: string): Promise<LoginResult> {
  try {
    return await request<LoginResult>({ url: '/api/login', method: 'POST', data: { code } });
  } catch {
    return { openid: `wx_dev_${Date.now().toString(36)}` };
  }
}
