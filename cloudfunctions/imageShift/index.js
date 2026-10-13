'use strict';
const cloud = require('wx-server-sdk');

// 必须在所有业务模块的 require 之前初始化：users/photos 在模块顶层就调用 cloud.database()，
// 若未先 init 会抛 "Cloud API isn't enabled"，导致冷启动直接崩溃（status 443 / 0ms）。
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { config } = require('./config');
const { listStyleMeta } = require('./catalog');
const { ErrorCode, ok, fail } = require('./envelope');
const users = require('./users');
const photos = require('./photos');

function requestId() {
  return Math.random().toString(36).slice(2, 10);
}

function runtimeConfig() {
  const payload = {
    maxFileSizeMB: config.maxFileSizeMB,
    recommendedLongEdge: config.recommendedLongEdge,
  };
  if (config.notice) payload.notice = config.notice;
  return payload;
}

async function actionConfig(rid) {
  return ok(runtimeConfig(), rid);
}

async function actionStyles(rid) {
  return ok(listStyleMeta(), rid);
}

/** 用 openid 查是否已注册：已存在直接返回完整用户信息，无需再填头像昵称 */
async function actionGetUser(data, rid, openid) {
  if (!openid) return fail(ErrorCode.UNAUTHORIZED, '无法识别用户身份', rid);
  const user = await users.get(openid);
  if (!user) return ok({ exists: false }, rid);
  return ok(
    {
      exists: true,
      user: {
        openid: user.openid,
        nickname: user.nickname || '',
        avatarFileID: user.avatarFileID || '',
      },
    },
    rid,
  );
}

async function actionLogin(data, rid, openid) {
  if (!openid) return fail(ErrorCode.UNAUTHORIZED, '无法识别用户身份', rid);
  const user = await users.upsert(openid, {
    nickname: data.nickname,
    avatarFileID: data.avatarFileID,
  });
  return ok({ openid: user.openid }, rid);
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

exports.main = async (event) => {
  const rid = requestId();
  // 无 action：通常是定时触发器误触发，这里不再有生图任务，直接空响应
  if (!event || !event.action) {
    return ok({ skipped: true }, rid);
  }
  try {
    const openid = cloud.getWXContext().OPENID || '';
    switch (event.action) {
      case 'config':
        return await actionConfig(rid);
      case 'styles':
        return await actionStyles(rid);
      case 'login':
        return await actionLogin(event, rid, openid);
      case 'getUserInfo':
        return await actionGetUser(event, rid, openid);
      case 'savePhoto':
        return await actionSavePhoto(event, rid, openid);
      case 'listPhotos':
        return await actionListPhotos(event, rid, openid);
      default:
        return fail(ErrorCode.BAD_REQUEST, `未知 action：${event.action}`, rid);
    }
  } catch (err) {
    console.error(`[main] 未捕获异常 ${rid}`, err);
    return fail(ErrorCode.INTERNAL, '服务内部错误', rid);
  }
};
