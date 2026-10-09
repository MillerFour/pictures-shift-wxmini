import { ENV } from '../config/env';
import { ApiError, TRANSPORT_CODES } from './error';

export interface PreparedImage {
  path: string;
  width: number;
  height: number;
  size: number;
}

/** 读文件体积。拿不到就返回 0，最终校验交给 BFF */
export function fileSize(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    wx.getFileSystemManager().stat({
      path: filePath,
      success: (res) => resolve((res.stats as { size?: number })?.size ?? 0),
      fail: () => resolve(0),
    });
  });
}

/**
 * 压缩到适合上传的尺寸。
 *
 * 手机原图普遍 3-8MB，直接传会被 BFF 体积限制拦下，上传也慢；
 * 而长边超过 1280px 对风格化结果没有可见收益，反而拖慢出图。
 */
export async function prepareImage(src: string): Promise<PreparedImage> {
  const info = await wx.getImageInfo({ src });
  const longEdge = Math.max(info.width, info.height);
  const scale = longEdge > ENV.MAX_LONG_EDGE ? ENV.MAX_LONG_EDGE / longEdge : 1;
  const width = Math.round(info.width * scale);
  const height = Math.round(info.height * scale);

  let path = src;
  try {
    const res = await wx.compressImage({
      src,
      quality: ENV.COMPRESS_QUALITY,
      ...(scale < 1 ? { compressedWidth: width, compressedHeight: height } : {}),
    });
    path = res.tempFilePath || src;
  } catch {
    // 基础库 < 2.26.0 不支持 compressedWidth，退回只压质量
    path = src;
  }

  return { path, width, height, size: await fileSize(path) };
}

/** 拉起相册/相机。用户取消返回 null */
export async function chooseImage(): Promise<PreparedImage | null> {
  const res = await wx.chooseMedia({
    count: 1,
    mediaType: ['image'],
    sourceType: ['album', 'camera'],
    sizeType: ['original'],
  });
  const file = res.tempFiles?.[0];
  if (!file?.tempFilePath) return null;
  return prepareImage(file.tempFilePath);
}

/** 下载远程图片到本地临时文件 */
export function downloadImage(url: string): Promise<string> {
  const full = /^https?:/.test(url) ? url : ENV.API_BASE + url;
  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url: full,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.tempFilePath);
        else reject(new ApiError(res.statusCode, TRANSPORT_CODES.NETWORK, '图片下载失败'));
      },
      fail: (e) => reject(new ApiError(0, TRANSPORT_CODES.NETWORK, e.errMsg || '图片下载失败')),
    });
  });
}

async function promptOpenAlbumSetting(): Promise<void> {
  const res = await wx.showModal({
    title: '需要相册权限',
    content: '保存作品需要写入相册，请在设置中打开「保存到相册」权限',
    confirmText: '去设置',
  });
  if (res.confirm) await wx.openSetting();
}

/** 保存到系统相册，权限被拒时引导用户去设置页打开 */
export async function saveToAlbum(url: string): Promise<void> {
  const localPath = await downloadImage(url);
  try {
    await wx.saveImageToPhotosAlbum({ filePath: localPath });
  } catch (err) {
    const msg = (err as { errMsg?: string })?.errMsg ?? '';
    if (msg.includes('auth deny') || msg.includes('authorize')) {
      await promptOpenAlbumSetting();
    }
    throw err;
  }
}