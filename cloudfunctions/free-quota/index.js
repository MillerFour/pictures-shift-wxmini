'use strict';
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { ErrorCode, ok, fail } = require('./envelope');
const { ensureQuota } = require('./quota');
const { ensureCollections } = require('./db-init');

/** 免费次数的单次发放额度（注册赠送 / 平台活动派发；与 generate-image 云函数的 FREE_QUOTA 保持一致） */
const FREE_QUOTA = Number(process.env.FREE_QUOTA) || 1;

/**
 * 免费次数 —— 唯一接口 getFreeQuota。
 *
 * 「免费次数」= 平台通过各种方式赠送给用户的次数（注册赠送、活动派发、
 * 后续的重置补发……），与购买所得共用 users.quota 一个余额池。
 * 次数真源在云端，前端本地计数仅作展示缓存；
 * 未建档（未登录）返回 40100，由前端按未登录处理。
 */

function requestId() {
  return Math.random().toString(36).slice(2, 10);
}

exports.main = async (event) => {
  const rid = requestId();
  await ensureCollections(['users']);
  if (!event || event.action !== 'getFreeQuota') {
    return fail(
      ErrorCode.BAD_REQUEST,
      event && event.action ? `未知 action：${event.action}` : '缺少 action',
      rid,
    );
  }
  const openid = cloud.getWXContext().OPENID || '';
  if (!openid) return fail(ErrorCode.UNAUTHORIZED, '无法识别用户身份', rid);
  const quota = await ensureQuota(openid, FREE_QUOTA);
  if (quota === null) return fail(ErrorCode.UNAUTHORIZED, '请先登录', rid);
  return ok({ quota }, rid);
};
