/**
 * 微信云开发调用封装。
 *
 * 替代原来直连 Hono BFF 的 wx.request：接口走 wx.cloud.callFunction，
 * 原图走 wx.cloud.uploadFile（云存储），结果图走 wx.cloud.getTempFileURL。
 * 不再依赖任何自有域名 / 服务器。
 *
 * 类型假设微信开发者工具在开通云开发后已注入 wx.cloud 自带类型；
 * res.result 用 unknown 断言过渡，避免依赖具体返回结构。
 */

import { ApiError } from './error';

interface CallFunctionEnvelope<T> {
  code: number;
  message: string;
  data: T;
  requestId?: string;
}

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

/** 封装一次云函数调用。云函数统一返回 ApiEnvelope，这里透出 data 或抛错。 */
export function callFunction<T = unknown>(
  action: string,
  data: Record<string, unknown> = {},
  name = 'imageShift',
  timeout?: number,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const options = { name, data: { action, ...data } } as WechatMiniprogram.Cloud.CallFunctionOption & {
      timeout?: number;
    };
    if (timeout) options.timeout = timeout;
    wx.cloud
      .callFunction(options)
      .then((res) => {
        const envelope = res.result as unknown as CallFunctionEnvelope<T>;
        if (!envelope || envelope.code !== 0) {
          // 业务错误码随异常透出（如 40200 次数不足），页面据此分流处理
          reject(
            new ApiError(
              0,
              String(envelope?.code ?? 0),
              envelope?.message || '云函数返回异常',
            ),
          );
          return;
        }
        resolve(envelope.data);
      })
      .catch((err: unknown) => reject(toError(err)));
  });
}

/** 上传原图到云存储，返回 fileID。onProgress 接收 0-100 进度。 */
export function uploadSource(filePath: string, onProgress?: (percent: number) => void): Promise<string> {
  const ext = (filePath.split('.').pop() || 'jpg').toLowerCase();
  const cloudPath = `source/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
  return new Promise<string>((resolve, reject) => {
    wx.cloud
      .uploadFile({
        cloudPath,
        filePath,
        onProgressUpdate: onProgress ? (e: { progress: number }) => onProgress(e.progress) : undefined,
      } as WechatMiniprogram.Cloud.UploadFileOption)
      .then((res) => resolve(res.fileID))
      .catch((err: unknown) => reject(toError(err)));
  });
}

/** 把云存储 fileID 换成临时可访问的 HTTPS 直链。 */
export function resolveTempUrl(fileID: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    wx.cloud
      .getTempFileURL({ fileList: [fileID] })
      .then((res) => {
        const item = res.fileList?.[0];
        if (item && item.tempFileURL) resolve(item.tempFileURL);
        else reject(new Error('获取临时链接失败'));
      })
      .catch((err: unknown) => reject(toError(err)));
  });
}

/**
 * 批量换取临时直链（列表页一次几十条，逐条换直链开销太大）。
 * 返回 fileID -> url 映射；换取失败的 fileID 不在映射里，由调用方决定降级展示。
 */
export function resolveTempUrls(fileIDs: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(fileIDs.filter(Boolean)));
  if (!unique.length) return Promise.resolve({});
  return new Promise<Record<string, string>>((resolve) => {
    wx.cloud
      .getTempFileURL({ fileList: unique })
      .then((res) => {
        const map: Record<string, string> = {};
        for (const item of res.fileList || []) {
          if (item.fileID && item.tempFileURL) map[item.fileID] = item.tempFileURL;
        }
        resolve(map);
      })
      .catch(() => resolve({}));
  });
}
/** 上传头像到云存储，返回 fileID。 */
export function uploadAvatar(filePath: string): Promise<string> {
  const ext = (filePath.split('.').pop() || 'png').toLowerCase();
  const cloudPath = `avatar/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
  return new Promise<string>((resolve, reject) => {
    wx.cloud
      .uploadFile({ cloudPath, filePath })
      .then((res) => resolve(res.fileID))
      .catch((err: unknown) => reject(toError(err)));
  });
}

/**
 * 把头像 fileID 转成可渲染的临时直链。
 * getTempFileURL 返回的链接有有效期，故每次展示前重新换取，不缓存。
 */
export function resolveAvatar(fileID: string): Promise<string> {
  return resolveTempUrl(fileID);
}

/**
 * 上传用户照片到云存储，返回 fileID。
 * 按 openid 隔离目录，便于「我的照片」等场景按用户管理；
 * 展示时配合 resolveTempUrl(fileID) 换临时直链渲染。
 */
export function uploadUserPhoto(
  filePath: string,
  openid?: string,
  onProgress?: (percent: number) => void,
): Promise<string> {
  const ext = (filePath.split('.').pop() || 'jpg').toLowerCase();
  const dir = openid ? `user-photos/${openid}` : 'user-photos/anon';
  const cloudPath = `${dir}/${Date.now()}-${Math.floor(Math.random() * 1e6)}.${ext}`;
  return new Promise<string>((resolve, reject) => {
    wx.cloud
      .uploadFile({
        cloudPath,
        filePath,
        onProgressUpdate: onProgress ? (e: { progress: number }) => onProgress(e.progress) : undefined,
      } as WechatMiniprogram.Cloud.UploadFileOption)
      .then((res) => resolve(res.fileID))
      .catch((err: unknown) => reject(toError(err)));
  });
}
