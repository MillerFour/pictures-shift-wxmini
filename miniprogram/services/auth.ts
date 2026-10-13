import { callFunction } from '../utils/cloud';
import { type WxUser } from '../utils/auth';

export interface LoginResult {
  /** 微信 openid，账户唯一标识 */
  openid: string;
}

export interface LoginProfile {
  /** 昵称（用户授权） */
  nickname: string;
  /** 头像在云存储的 fileID（已由前端上传，稳定可持久） */
  avatarFileID: string;
}

export interface CheckResult {
  /** 云端是否已存在该 openid 的档案 */
  exists: boolean;
  /** 已存在时带回完整用户信息 */
  user?: WxUser;
}

/**
 * 用 openid 查云端是否已注册。
 *
 * openid 由云函数侧 cloud.getWXContext().OPENID 取（前端无法伪造），前端不传。
 * 已注册返回 exists + 完整信息，调用方可直接登录、无需再弹授权框；
 * 未注册返回 exists=false，由调用方引导用户授权头像昵称建档。
 */
export async function checkUser(): Promise<CheckResult> {
  return callFunction<CheckResult>('getUserInfo');
}

/**
 * 真实登录（建档）：调用云函数 login action。
 *
 * 仅用于首次注册——云端用 openid 把昵称/头像 upsert 进 users 集合（openid 即 _id，天然唯一）。
 */
export async function login(profile: LoginProfile): Promise<LoginResult> {
  return callFunction<LoginResult>('login', profile);
}
