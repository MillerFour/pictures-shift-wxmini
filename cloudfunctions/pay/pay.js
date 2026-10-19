'use strict';

/**
 * 订单与配额：orders 集合 + users.quota。
 *
 * 状态机：CREATED（已下单未支付）→ PAID（平台确认已支付）→ DELIVERED（次数已到账）
 *        CREATED/PAID → REFUNDED（退款，DELIVERED 的同时回收次数）
 *
 * 发货采用「条件更新抢占 + 事务」双保险：
 * - 前端查单确认、发货推送、定时兜底三条路径都会并发调到这里，
 *   任何时刻只有一次「非终态 → DELIVERED」的更新能成功，配额只加一次。
 * - 事务内完成订单终态与配额 inc，两边要么都成功要么都回滚。
 */

const cloud = require('wx-server-sdk');
const db = cloud.database();
const _ = db.command;

const ORDERS = 'orders';
const USERS = 'users';

function orders() {
  return db.collection(ORDERS);
}

function usersCollection() {
  return db.collection(USERS);
}

/** 业务单号：PS + 时间戳(36) + 4 位随机，8-32 位、不以 _ 开头、不可复用 */
function genOutTradeNo() {
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, '0');
  return `PS${Date.now().toString(36)}${rand}`.slice(0, 32);
}

/**
 * 创建订单并生成支付参数。
 * sessionKey 来自本次下单时前端新换的 code，保证签名与当前登录态一致。
 * mock=true（NEED_PAY=false）：不签名，建单后立即模拟发货，返回 { outTradeNo, mock: true }。
 */
async function createOrder({ openid, product, sessionKey, attach, buildPayData, mock }) {
  const outTradeNo = genOutTradeNo();
  const now = Date.now();
  const order = {
    _id: outTradeNo,
    openid,
    productId: product.id,
    priceFen: product.priceFen,
    count: product.count,
    status: 'CREATED',
    wxOrderId: '',
    attach: attach || '',
    createdAt: now,
    updatedAt: now,
    paidAt: 0,
    deliveredAt: 0,
  };
  await orders().add({ data: order });

  if (mock) {
    // 免支付演示：走同一套幂等发货状态机，wxOrderId 标记 MOCK 便于对账
    order.status = 'DELIVERED';
    await confirmDelivery(order, 'MOCK');
    return { outTradeNo, mock: true };
  }

  const payData = buildPayData({
    sessionKey,
    productId: product.id,
    goodsPrice: product.priceFen,
    outTradeNo,
    attach: attach || '',
  });
  return { outTradeNo, payData };
}

/**
 * 幂等发货：订单置 DELIVERED，同时给用户加次数。
 * 返回 { delivered: true, order }；订单已是终态时返回 { delivered: false }。
 */
async function confirmDelivery(order, wxOrderId) {
  const result = await db.runTransaction(async (transaction) => {
    const raw = await transaction.collection(ORDERS).doc(order._id).get();
    const current = raw && raw.data ? raw.data : raw;
    // 兼容不同事务实现的返回结构；文档可能已被并发请求处理
    if (!current) return { delivered: false };
    if (current.status === 'DELIVERED' || current.status === 'REFUNDED') return { delivered: false };

    const now = Date.now();
    await transaction.collection(ORDERS).doc(order._id).update({
      data: {
        status: 'DELIVERED',
        wxOrderId: wxOrderId || current.wxOrderId || '',
        paidAt: current.paidAt || now,
        deliveredAt: now,
        updatedAt: now,
      },
    });

    // 配额：用户档案理论上已由 login 建档；缺失时用 set 补建，避免 inc 打空
    let userDoc = null;
    try {
      const userRaw = await transaction.collection(USERS).doc(order.openid).get();
      userDoc = userRaw && userRaw.data ? userRaw.data : userRaw;
    } catch (e) {
      // 未建档时 doc().get() 抛错：置 null 走下方 set 补建；真故障也被幂等 set 兜住
      userDoc = null;
    }
    if (userDoc) {
      const base = typeof userDoc.quota === 'number' ? userDoc.quota : 0;
      await transaction.collection(USERS).doc(order.openid).update({
        data: { quota: base + (order.count || 0), updatedAt: now },
      });
    } else {
      await transaction.collection(USERS).doc(order.openid).set({
        data: {
          _id: order.openid,
          openid: order.openid,
          nickname: '',
          avatarFileID: '',
          quota: order.count || 0,
          createdAt: now,
          updatedAt: now,
        },
      });
    }
    return { delivered: true };
  });
  return result;
}

/** 退款：DELIVERED 订单回收次数（钳到 0）；未发货订单直接置 REFUNDED */
async function applyRefund(order, refundId) {
  const result = await db.runTransaction(async (transaction) => {
    const raw = await transaction.collection(ORDERS).doc(order._id).get();
    const current = raw && raw.data ? raw.data : raw;
    if (!current || current.status === 'REFUNDED') return { refunded: false };
    if (current.status !== 'DELIVERED') {
      await transaction.collection(ORDERS).doc(order._id).update({
        data: { status: 'REFUNDED', refundId: refundId || '', updatedAt: Date.now() },
      });
      return { refunded: true, recovered: false };
    }

    const now = Date.now();
    await transaction.collection(ORDERS).doc(order._id).update({
      data: { status: 'REFUNDED', refundId: refundId || '', updatedAt: now },
    });
    let userDoc = null;
    try {
      const userRaw = await transaction.collection(USERS).doc(order.openid).get();
      userDoc = userRaw && userRaw.data ? userRaw.data : userRaw;
    } catch (e) {
      // 未建档时 doc().get() 抛错：无次数可回收，跳过用户侧更新即可
      userDoc = null;
    }
    if (userDoc) {
      const base = typeof userDoc.quota === 'number' ? userDoc.quota : 0;
      await transaction.collection(USERS).doc(order.openid).update({
        data: { quota: Math.max(0, base - (order.count || 0)), updatedAt: now },
      });
    }
    return { refunded: true, recovered: true };
  });
  return result;
}

/**
 * 以平台查单结果同步订单（前端确认 / 回调丢失 / 定时兜底共用）。
 * 返回同步后的订单快照，status 可能推进为 DELIVERED / REFUNDED。
 * 已是终态的订单（模拟发货 / 已发货）直接短路，不再打平台查单接口。
 */
async function syncOrder(order, xpay, queryOrder, isPaidStatus) {
  if (order.status === 'DELIVERED' || order.status === 'REFUNDED') {
    return { order, synced: true, delivered: false, refunded: false };
  }
  const res = await queryOrder(xpay, order.openid, order._id);
  if (!res.ok) return { order, synced: false, errcode: res.errcode, errmsg: res.errmsg };

  const remote = res.order || {};
  if (isPaidStatus(remote.status)) {
    const { delivered } = await confirmDelivery(order, remote.order_id || remote.transaction_id || '');
    return { order: { ...order, status: 'DELIVERED' }, synced: true, delivered };
  }
  if (remote.status === 'REFUNDED' || remote.status === 'REFUND') {
    const { refunded } = await applyRefund(order, remote.refund_id || '');
    return { order: { ...order, status: 'REFUNDED' }, synced: true, refunded };
  }
  return { order, synced: true };
}

/**
 * 兜底扫描：下单超过 sweepDelayMs 仍未终态的订单，逐个查单补发货。
 * 由每分钟定时触发器调用，单次限量，避免云函数超时。
 */
async function sweepStaleOrders({ xpay, queryOrder, isPaidStatus, sweepDelayMs }) {
  const threshold = Date.now() - (sweepDelayMs || 2 * 60 * 1000);
  const res = await orders()
    .where({ status: _.in(['CREATED', 'PAID']), updatedAt: _.lt(threshold) })
    .orderBy('createdAt', 'asc')
    .limit(10)
    .get();
  const stale = res.data || [];
  const handled = [];
  for (const order of stale) {
    try {
      const r = await syncOrder(order, xpay, queryOrder, isPaidStatus);
      handled.push({ outTradeNo: order._id, status: r.order.status });
    } catch (e) {
      console.error(`[pay] sweep 处理失败 ${order._id}`, e);
      handled.push({ outTradeNo: order._id, status: order.status, error: String(e && e.message) });
    }
  }
  return { scanned: stale.length, handled };
}

/**
 * 读取用户配额；存量用户缺 quota 字段时补齐免费次数。
 * 未建档（未登录）返回 null，由调用方按未登录处理。
 */
async function ensureQuota(openid, freeQuota) {
  try {
    const res = await usersCollection().doc(openid).get();
    const user = res && res.data;
    if (!user) return null;
    if (typeof user.quota === 'number') return user.quota;
    await usersCollection().doc(openid).update({ data: { quota: freeQuota, updatedAt: Date.now() } });
    return freeQuota;
  } catch (e) {
    return null;
  }
}

/** 用户订单列表（按创建时间倒序） */
async function listOrders(openid, limit = 20) {
  const res = await orders()
    .where({ openid })
    .orderBy('createdAt', 'desc')
    .limit(Math.min(limit, 50))
    .get();
  return (res.data || []).map((o) => ({
    outTradeNo: o._id,
    productId: o.productId,
    priceFen: o.priceFen,
    count: o.count,
    status: o.status,
    createdAt: o.createdAt,
    deliveredAt: o.deliveredAt || 0,
  }));
}

module.exports = { genOutTradeNo, createOrder, confirmDelivery, applyRefund, syncOrder, sweepStaleOrders, ensureQuota, listOrders };
