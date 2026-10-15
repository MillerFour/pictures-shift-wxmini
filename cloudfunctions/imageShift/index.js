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
const xpay = require('./xpay');
const pay = require('./pay');
const creations = require('./creations');
const { ensureCollections } = require('./db-init');

const db = cloud.database();
const ordersCollection = () => db.collection('orders');

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

/** 次数包列表：价格文案在服务端算好，前端纯展示。PAY_AMOUNT 测试金额时同步改价 */
function payPackages() {
  const testFen = config.pay.amountFen;
  return Object.entries(config.products).map(([id, p]) => {
    const priceFen = testFen !== null ? testFen : p.priceFen;
    return {
      id,
      name: p.name,
      priceFen,
      priceText: `¥${(priceFen / 100).toFixed(2).replace(/\.00$/, '')}`,
      count: p.count,
      unitText: testFen !== null ? '测试金额' : `约 ¥${(p.priceFen / p.count / 100).toFixed(2).replace(/\.00$/, '')}/次`,
      tag: p.tag || '',
    };
  });
}

/**
 * 解析本次下单的道具与金额。
 * PAY_AMOUNT 测试金额：金额统一为 amountFen；道具优先用 XPAY_TEST_PRODUCT_ID
 * （需在后台建同价道具），未指定则沿用套餐 id（需把后台道具价临时改为同额）。
 */
function resolveOrderItem(packageId) {
  const product = config.products[packageId];
  if (!product) return null;
  const { amountFen, testProductId } = config.pay;
  if (amountFen === null) {
    return { productId: packageId, priceFen: product.priceFen, count: product.count };
  }
  return {
    productId: testProductId || packageId,
    priceFen: amountFen,
    count: product.count,
  };
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
  }, config.freeQuota);
  return ok({ openid: user.openid }, rid);
}

/* ================= 虚拟支付 ================= */

/** 当前用户剩余创作次数（云端为准，前端仅缓存展示） */
async function actionGetQuota(data, rid, openid) {
  if (!openid) return fail(ErrorCode.UNAUTHORIZED, '无法识别用户身份', rid);
  const quota = await pay.ensureQuota(openid, config.freeQuota);
  if (quota === null) return fail(ErrorCode.UNAUTHORIZED, '请先登录', rid);
  return ok({ quota }, rid);
}

async function actionPayPackages(data, rid) {
  // NEED_PAY=false 时不依赖虚拟支付配置也能拉套餐（模拟发货演示）
  if (config.pay.needPay && !xpay.isConfigured(config.xpay)) {
    return fail(ErrorCode.PAY_NOT_CONFIGURED, '虚拟支付未配置', rid);
  }
  return ok({ payEnabled: config.pay.needPay, packages: payPackages() }, rid);
}

/**
 * 创建订单。
 * NEED_PAY=false：mock 模式 —— 不签名，建单后立即模拟发货，返回 { outTradeNo, mock: true }。
 * NEED_PAY=true：真实虚拟支付 —— code 换 session_key，签名后返回 payData。
 */
async function actionCreateOrder(data, rid, openid) {
  if (!openid) return fail(ErrorCode.UNAUTHORIZED, '无法识别用户身份', rid);
  if (!data.productId || typeof data.productId !== 'string') return fail(ErrorCode.BAD_REQUEST, '缺少道具 id', rid);
  const item = resolveOrderItem(data.productId);
  if (!item) return fail(ErrorCode.BAD_REQUEST, `道具 ${data.productId} 不存在`, rid);

  // 免支付演示：跳过签名与平台校验，直接发货
  if (!config.pay.needPay) {
    try {
      const created = await pay.createOrder({
        openid,
        product: item,
        attach: typeof data.attach === 'string' ? data.attach : '',
        mock: true,
      });
      console.log(`[createOrder] mock 发货 ${created.outTradeNo} openid=${openid} count=${item.count}`);
      return ok(created, rid);
    } catch (err) {
      console.error(`[createOrder] mock ${rid}`, err);
      return fail(ErrorCode.PAY_ERROR, err instanceof Error ? err.message : '下单失败', rid);
    }
  }

  if (!xpay.isConfigured(config.xpay)) return fail(ErrorCode.PAY_NOT_CONFIGURED, '虚拟支付未配置', rid);
  if (!data.code || typeof data.code !== 'string') return fail(ErrorCode.BAD_REQUEST, '缺少登录 code', rid);

  try {
    const session = await xpay.code2Session(config.xpay, data.code);
    if (session.openid !== openid) {
      return fail(ErrorCode.UNAUTHORIZED, '登录态与用户不匹配', rid);
    }
    const created = await pay.createOrder({
      openid,
      product: item,
      sessionKey: session.sessionKey,
      attach: typeof data.attach === 'string' ? data.attach : '',
      // 闭包注入 xpay 配置：pay.js 只关心业务参数，签名细节留在 xpay 模块
      buildPayData: (args) => xpay.buildPayData({ ...args, xpay: config.xpay }),
    });
    return ok(created, rid);
  } catch (err) {
    console.error(`[createOrder] ${rid}`, err);
    return fail(ErrorCode.PAY_ERROR, err instanceof Error ? err.message : '下单失败', rid);
  }
}

/**
 * 查单并同步发货（前端支付成功回调后的确认路径）。
 * 只允许查询本人订单，防止用他人单号探测。
 */
async function actionQueryOrder(data, rid, openid) {
  if (!openid) return fail(ErrorCode.UNAUTHORIZED, '无法识别用户身份', rid);
  if (!xpay.isConfigured(config.xpay)) return fail(ErrorCode.PAY_NOT_CONFIGURED, '虚拟支付未配置', rid);
  if (!data.outTradeNo || typeof data.outTradeNo !== 'string') return fail(ErrorCode.BAD_REQUEST, '缺少订单号', rid);

  try {
    const res = await ordersCollection().doc(data.outTradeNo).get();
    const order = res && res.data;
    if (!order || order.openid !== openid) return fail(ErrorCode.TASK_NOT_FOUND, '订单不存在', rid);

    const synced = await pay.syncOrder(order, config.xpay, xpay.queryOrder, xpay.isPaidStatus);
    const quota = await pay.ensureQuota(openid, config.freeQuota);
    return ok(
      {
        status: synced.order.status,
        count: synced.order.count,
        priceFen: synced.order.priceFen,
        productId: synced.order.productId,
        quota: typeof quota === 'number' ? quota : 0,
      },
      rid,
    );
  } catch (err) {
    console.error(`[queryOrder] ${rid}`, err);
    return fail(ErrorCode.PAY_ERROR, err instanceof Error ? err.message : '查询订单失败', rid);
  }
}

/** 当前用户订单列表 */
async function actionListOrders(data, rid, openid) {
  if (!openid) return fail(ErrorCode.UNAUTHORIZED, '无法识别用户身份', rid);
  const list = await pay.listOrders(openid, Number(data.limit) || 20);
  return ok(list, rid);
}

/** 历史创作：分页拉取当前用户的生成记录（结果图 fileID 需前端换临时直链） */
async function actionListCreations(data, rid, openid) {
  if (!openid) return fail(ErrorCode.UNAUTHORIZED, '无法识别用户身份', rid);
  const list = await creations.list(openid, { limit: Number(data.limit) || 20, skip: Number(data.skip) || 0 });
  return ok(list, rid);
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

  // 关键集合懒创建（新版云开发环境不再自动建集合；实例内只建一次）
  await ensureCollections(['orders', 'tokens', 'creations']);

  // 定时触发器：兜底扫描未完成订单（下单后推送丢失时由查单补发货）
  if (event && event.TriggerName) {
    try {
      if (!xpay.isConfigured(config.xpay)) return { ok: true, skipped: 'xpay not configured' };
      const result = await pay.sweepStaleOrders({
        xpay: config.xpay,
        queryOrder: xpay.queryOrder,
        isPaidStatus: xpay.isPaidStatus,
        sweepDelayMs: config.xpay.sweepDelayMs,
      });
      console.log(`[sweep] TriggerName=${event.TriggerName}`, JSON.stringify(result));
      return { ok: true, ...result };
    } catch (err) {
      console.error('[sweep] 定时兜底失败', err);
      return { ok: false, error: String(err && err.message) };
    }
  }

  // 无 action：其他被动触发，直接空响应
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
      case 'getQuota':
        return await actionGetQuota(event, rid, openid);
      case 'payPackages':
        return await actionPayPackages(event, rid);
      case 'createOrder':
        return await actionCreateOrder(event, rid, openid);
      case 'queryOrder':
        return await actionQueryOrder(event, rid, openid);
      case 'listCreations':
        return await actionListCreations(event, rid, openid);
      case 'listOrders':
        return await actionListOrders(event, rid, openid);
      default:
        return fail(ErrorCode.BAD_REQUEST, `未知 action：${event.action}`, rid);
    }
  } catch (err) {
    console.error(`[main] 未捕获异常 ${rid}`, err);
    return fail(ErrorCode.INTERNAL, '服务内部错误', rid);
  }
};
