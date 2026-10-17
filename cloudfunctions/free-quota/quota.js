'use strict';
const cloud = require('wx-server-sdk');
const db = cloud.database();

/**
 * 读取用户免费次数余额；建档缺失或存量用户缺 quota 字段时补齐免费次数。
 *
 * 这里是「免费次数」的发放点 —— 注册赠送、平台活动派发、后续的配置化重置
 * 都最终落在这个字段；身份函数（wx-identity）只建档不送次数，身份与业务解耦。
 * generate-image 的 consumeQuota 也有同样的缺字段补齐兜底，两侧语义一致，
 * 任何路径先到都不会丢次数。
 * 未建档（未登录）返回 null，由调用方按未登录处理。
 */
async function ensureQuota(openid, freeQuota) {
  try {
    const res = await db.collection('users').doc(openid).get();
    const user = res && res.data;
    if (!user) return null;
    if (typeof user.quota === 'number') return user.quota;
    await db.collection('users').doc(openid).update({ data: { quota: freeQuota, updatedAt: Date.now() } });
    return freeQuota;
  } catch (e) {
    return null;
  }
}

module.exports = { ensureQuota };
