'use strict';

/**
 * 历史创作记录（creations 集合）。
 *
 * 记录由 generatelmage 云函数在生图成功后写入（服务端写，不依赖前端回调），
 * 这里只负责按用户分页读取，供小程序「我的 → 历史创作」展示与下载原图。
 */

const cloud = require('wx-server-sdk');
const db = cloud.database();
const CREATIONS = 'creations';

function collection() {
  return db.collection(CREATIONS);
}

/** 某用户的生成记录，按时间倒序分页 */
async function list(openid, { limit = 20, skip = 0 } = {}) {
  if (!openid) return [];
  try {
  const res = await collection()
    .where({ openid })
    .orderBy('createdAt', 'desc')
    .skip(Math.max(0, Number(skip) || 0))
    .limit(Math.min(Math.max(1, Number(limit) || 20), 50))
    .get();
  return (res.data || []).map((c) => ({
    id: c._id,
    styleId: c.styleId || '',
    styleName: c.styleName || '',
    modelId: c.modelId || '',
    modelName: c.modelName || '',
    strength: c.strength || 60,
    resultFileID: c.resultFileID || '',
    costMs: c.costMs || 0,
    createdAt: c.createdAt || 0,
  }));
  } catch (e) {
    // 集合尚未创建时查询会抛错（add 才会自动建集合）：按空态返回，不打扰用户
    console.error('[creations] list 查询失败（集合可能未创建）', e);
    return [];
  }
}

module.exports = { list };
