'use strict';
const cloud = require('wx-server-sdk');
const db = cloud.database();

/** 档案集合名：跨项目复用时可用环境变量 USERS_COLLECTION 覆盖 */
const COLLECTION = process.env.USERS_COLLECTION || 'users';

function collection() {
  return db.collection(COLLECTION);
}

/**
 * 幂等 upsert：首次登录建档，再次登录更新昵称/头像与最后活跃时间。
 * 以 openid 作为 _id，天然保证一个微信用户一条记录，无需额外去重。
 * 只写身份字段；业务字段（创作次数等）由各业务函数自行补齐或携带默认值，
 * 本模块保持项目无关。
 */
async function upsert(openid, profile) {
  if (!openid) return null;
  const now = Date.now();
  const nickname = (profile && profile.nickname) || '';
  const avatarFileID = (profile && profile.avatarFileID) || '';
  const docRef = collection().doc(openid);
  try {
    const res = await docRef.get();
    if (res && res.data) {
      await docRef.update({ data: { nickname, avatarFileID, updatedAt: now } });
      return { openid, createdAt: res.data.createdAt, updatedAt: now };
    }
  } catch (e) {
    // doc 不存在 -> 走下方新增
  }
  const record = {
    _id: openid,
    openid,
    nickname,
    avatarFileID,
    createdAt: now,
    updatedAt: now,
  };
  await collection().add({ data: record });
  return record;
}

/** 读取用户信息；不存在返回 null */
async function get(openid) {
  if (!openid) return null;
  try {
    const res = await collection().doc(openid).get();
    return (res && res.data) || null;
  } catch {
    return null;
  }
}

module.exports = { upsert, get, COLLECTION };
