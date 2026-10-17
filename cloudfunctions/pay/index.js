'use strict';
const cloud = require('wx-server-sdk');

// 必须在所有业务模块的 require 之前初始化：pay 在模块顶层就调用 cloud.database()，
// 若未先 init 会抛 "Cloud API isn't enabled"，导致冷启动直接崩溃（status 443 / 0ms）。
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { config } = require('./config');
const { ErrorCode, ok, fail } = require('./envelope');
const xpay = require('./xpay');
const pay = require('./pay');
const { ensureCollections } = require('./db-init');

/**
 * 交易域 —— 订单状态机与 XPAY 密钥的唯一入口。
 *
 * 状态机：CREATED → PAID → DELIVERED（发货加次数）/ REFUNDED（退款回收次数），
 * 发货有三条互为备份的路径，均收敛到 pay.js 的幂等状态机：
 * 1. 前端查单确认（queryOrder）
 * 2. 平台发货推送（xpayNotify 云函数）
 * 3. 定时兜底扫描（本函数的定时触发器）
 *
 * 接口（event.action）：
 * - payPackages：次数包列表（价格文案服务端算好，前端纯展示）
 * - createOrder：建单并返回支付参数（NEED_PAY=false 时模拟发货）
 * - queryOrder：查单并同步发货（只允许查本人订单，防用他人单号探测）
 * - listOrders：当前用户订单列表
 */

const db = cloud.database();
const ordersCollection = () => db.collection('orders');

function requestId() {
  return Math.random().toString(36).slice(2, 10);
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

exports.main = async (event) => {
  const rid = requestId();

  // 关键集合懒创建（orders 订单 / tokens 平台凭证缓存 / users 发货加次数；实例内只建一次）
  await ensureCollections(['orders', 'tokens', 'users']);

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
      case 'payPackages':
        return await actionPayPackages(event, rid);
      case 'createOrder':
        return await actionCreateOrder(event, rid, openid);
      case 'queryOrder':
        return await actionQueryOrder(event, rid, openid);
      case 'listOrders':
        return await actionListOrders(event, rid, openid);
      default:
        return fail(ErrorCode.BAD_REQUEST, `未知 action：${event.action}`, rid);
    }
  } catch (err) {
    console.error(`[pay] 未捕获异常 ${rid}`, err);
    return fail(ErrorCode.INTERNAL, '服务内部错误', rid);
  }
};
