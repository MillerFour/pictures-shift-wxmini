'use strict';

/**
 * 集合懒创建。
 *
 * 微信云开发新版环境不再为 add 自动创建集合（缺集合报 -502005 ResourceNotFound），
 * 这里在业务读写前确保关键集合存在；已存在时 createCollection 报错被吞掉。
 * ensured 按实例内存缓存：每个云函数实例首个请求建一次，之后零开销。
 */

const cloud = require('wx-server-sdk');
const db = cloud.database();

const ensured = new Set();

async function ensureCollections(names) {
  await Promise.all(
    names.map(async (name) => {
      if (ensured.has(name)) return;
      try {
        await db.createCollection(name);
        console.log(`[db-init] 已创建集合 ${name}`);
      } catch (e) {
        // 已存在（最常见的失败）或权限不足：不阻断，交给业务层暴露真实错误
        console.log(`[db-init] 集合 ${name} 创建跳过：${(e && e.message) || e}`);
      }
      ensured.add(name);
    }),
  );
}

module.exports = { ensureCollections };
