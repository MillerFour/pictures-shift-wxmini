'use strict';
const cloud = require('wx-server-sdk');

// 必须在所有业务模块的 require 之前初始化：photos/tasks 在模块顶层就调用 cloud.database()，
// 若未先 init 会抛 "Cloud API isn't enabled"，导致冷启动直接崩溃。
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { ErrorCode, ok, fail } = require('./envelope');
const photos = require('./photos');
const tasks = require('./tasks');
const { ensureCollections } = require('./db-init');

/**
 * 用户内容记录 —— 照片素材（userPhotos）与任务档案（tasks）。
 *
 * tasks 由 generate-image 云函数在生图成功后服务端写入，这里只读；
 * photos 由前端上传云存储后调 savePhoto 落库。两个集合都是「按用户隔离的
 * 内容记录」，归入同一能力域；目录自包含，日后要独立拆分直接拷出即可。
 *
 * 接口（event.action）：
 * - savePhoto：落库一张照片记录
 * - listPhotos：当前用户照片列表（时间倒序）
 * - listTasks：当前用户任务档案分页（结果图 fileID 需前端换临时直链）
 */

function requestId() {
  return Math.random().toString(36).slice(2, 10);
}

/** 上传照片后落库为当前用户的照片记录 */
async function actionSavePhoto(data, rid, openid) {
  if (!openid) return fail(ErrorCode.UNAUTHORIZED, '无法识别用户身份', rid);
  if (!data.fileID || typeof data.fileID !== 'string') return fail(ErrorCode.BAD_REQUEST, '缺少照片 fileID', rid);
  const photo = await photos.add({
    openid,
    fileID: data.fileID,
    sizeKB: data.sizeKB,
    nickname: data.nickname,
  });
  return ok(photo, rid);
}

/** 拉取当前用户的照片记录（按时间倒序） */
async function actionListPhotos(data, rid, openid) {
  if (!openid) return fail(ErrorCode.UNAUTHORIZED, '无法识别用户身份', rid);
  const limit = Math.min(Number(data.limit) || 50, 100);
  const list = await photos.list(openid, limit);
  return ok(list, rid);
}

/** 任务档案：分页拉取当前用户的生成记录 */
async function actionListTasks(data, rid, openid) {
  if (!openid) return fail(ErrorCode.UNAUTHORIZED, '无法识别用户身份', rid);
  const list = await tasks.list(openid, { limit: Number(data.limit) || 20, skip: Number(data.skip) || 0 });
  return ok(list, rid);
}

exports.main = async (event) => {
  const rid = requestId();
  // 集合懒创建（tasks 读取兜底 + userPhotos 写入前置，实例内只建一次）
  await ensureCollections(['userPhotos', 'tasks']);
  if (!event || !event.action) return ok({ skipped: true }, rid);
  try {
    const openid = cloud.getWXContext().OPENID || '';
    switch (event.action) {
      case 'savePhoto':
        return await actionSavePhoto(event, rid, openid);
      case 'listPhotos':
        return await actionListPhotos(event, rid, openid);
      case 'listTasks':
        return await actionListTasks(event, rid, openid);
      default:
        return fail(ErrorCode.BAD_REQUEST, `未知 action：${event.action}`, rid);
    }
  } catch (err) {
    console.error(`[records] 未捕获异常 ${rid}`, err);
    return fail(ErrorCode.INTERNAL, '服务内部错误', rid);
  }
};
