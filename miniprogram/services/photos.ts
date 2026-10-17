import { getUser } from '../utils/auth';
import { CLOUD_FUNCTIONS, callFunction, uploadUserPhoto } from '../utils/cloud';

export interface UserPhoto {
  /** 数据库记录 _id */
  photoId: string;
  /** 云存储 fileID，展示时需 getTempFileURL 换直链 */
  fileID: string;
  /** 照片大小（KB），可选 */
  sizeKB: number;
  /** 上传时带上的昵称快照，可选 */
  nickname: string;
  /** 上传时间戳 */
  createdAt: number;
}

/**
 * 选图 -> 上传云存储 -> 落库为当前用户的照片记录。
 * openid 由云端从调用身份取，前端不传；返回的记录含 fileID，展示时再用 getTempFileURL。
 */
export async function uploadAndSavePhoto(filePath: string, sizeKB?: number): Promise<UserPhoto> {
  const user = getUser();
  const fileID = await uploadUserPhoto(filePath, user?.openid);
  return callFunction<UserPhoto>(
    'savePhoto',
    {
      fileID,
      sizeKB,
      nickname: user?.nickname || '',
    },
    CLOUD_FUNCTIONS.records,
  );
}

/** 拉取当前用户的照片记录（按时间倒序）；展示需自行 getTempFileURL(fileID)。 */
export async function fetchUserPhotos(limit = 50): Promise<UserPhoto[]> {
  return callFunction<UserPhoto[]>('listPhotos', { limit }, CLOUD_FUNCTIONS.records);
}
