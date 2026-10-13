'use strict';
const cloud = require('wx-server-sdk');
const db = cloud.database();
const PHOTOS = 'userPhotos';

function collection() {
  return db.collection(PHOTOS);
}

/**
 * 新增一条用户照片记录。fileID 是照片在云存储的引用，
 * openid 用于按用户隔离；尺寸等元数据可选，便于列表展示。
 */
async function add({ openid, fileID, sizeKB, nickname }) {
  if (!openid || !fileID) return null;
  const now = Date.now();
  const res = await collection().add({
    data: {
      openid,
      fileID,
      sizeKB: sizeKB || 0,
      nickname: nickname || '',
      createdAt: now,
    },
  });
  return { photoId: res._id, fileID, sizeKB: sizeKB || 0, createdAt: now };
}

/** 某用户的照片列表，按上传时间倒序 */
async function list(openid, limit = 50) {
  if (!openid) return [];
  const res = await collection()
    .where({ openid })
    .orderBy('createdAt', 'desc')
    .limit(limit)
    .get();
  return res.data || [];
}

module.exports = { add, list };
