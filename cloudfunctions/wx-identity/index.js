'use strict';
const cloud = require('wx-server-sdk');

// 必须在所有业务模块的 require 之前初始化：users 在模块顶层就调用 cloud.database()，
// 若未先 init 会抛 "Cloud API isn't enabled"，导致冷启动直接崩溃（status 443 / 0ms）。
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { ErrorCode, ok, fail } = require('./envelope');
const users = require('./users');
const { ensureCollections } = require('./db-init');

/**
 * 微信登录身份 —— 项目无关的复用件。
 *
 * 单一职责：只维护「这个微信用户是谁」（openid / 昵称 / 头像），
 * 不认识任何业务字段（创作次数、订单、会员……都由各业务函数自行维护），
 * 因此整个目录拷贝到任何云开发小程序都能直接用。
 *
 * 接口（event.action）：
 * - getUserInfo：用 openid 查是否已建档，已存在返回完整档案
 * - login：首次建档 / 再次登录更新昵称头像（幂等 upsert）
 *
 * 复用与定制：
 * - 档案集合名可用环境变量 USERS_COLLECTION 覆盖（默认 users）；
 * - 想多存档案字段，只改 users.js 一处。
 */

function requestId() {
  return Math.random().toString(36).slice(2, 10);
}

/** 用 openid 查是否已建档：已存在直接返回完整用户信息，无需再填头像昵称 */
async function actionGetUser(_data, rid, openid) {
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

exports.main = async (event) => {
  const rid = requestId();
  // 集合懒创建（新版云开发环境不再自动建集合；实例内只建一次）
  await ensureCollections([users.COLLECTION]);
  if (!event || !event.action) return ok({ skipped: true }, rid);
  try {
    const openid = cloud.getWXContext().OPENID || '';
    switch (event.action) {
      case 'login':
        return await actionLogin(event, rid, openid);
      case 'getUserInfo':
        return await actionGetUser(event, rid, openid);
      default:
        return fail(ErrorCode.BAD_REQUEST, `未知 action：${event.action}`, rid);
    }
  } catch (err) {
    console.error(`[identity] 未捕获异常 ${rid}`, err);
    return fail(ErrorCode.INTERNAL, '服务内部错误', rid);
  }
};
