import { CLOUD_FUNCTIONS, callFunction, uploadCloudFile } from '../utils/cloud';
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
  return callFunction<CheckResult>('getUserInfo', {}, CLOUD_FUNCTIONS.identity);
}

/**
 * 真实登录（建档）：调用云函数 login action。
 *
 * 仅用于首次注册——云端用 openid 把昵称/头像 upsert 进 users 集合（openid 即 _id，天然唯一）。
 */
/**
 * 登录成功后预创建任务目录：上传 task/{openid}/.keep 占位文件，
 * 让云存储在用户登录后立即出现其任务文件夹（正式原/成图按任务时间戳随后落入）。
 * 失败静默：占位只影响控制台可见性，首次生成时目录仍会自动产生。
 */
async function ensureTaskFolder(openid: string): Promise<void> {
  try {
    const local = `${wx.env.USER_DATA_PATH}/task-folder-keep`;
    wx.getFileSystemManager().writeFileSync(local, '', 'utf8');
    await uploadCloudFile(`task/${openid}/.keep`, local);
  } catch {
    /* 静默：见函数注释 */
  }
}

export async function login(profile: LoginProfile): Promise<LoginResult> {
  const result = await callFunction<LoginResult>('login', profile, CLOUD_FUNCTIONS.identity);
  // 及时生成用户任务目录（后台执行，不阻塞登录返回）
  void ensureTaskFolder(result.openid);
  return result;
}
