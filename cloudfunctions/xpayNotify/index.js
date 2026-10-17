'use strict';

/**
 * 虚拟支付发货推送回调（xpay_* 事件）。
 *
 * 部署方式：上传到云函数后，在「云开发控制台 → 云函数 →
 * HTTP 访问服务（云接入）」为它开通一个路径（默认 /xpay-notify），
 * 再把 MP 后台「虚拟支付 → 基本配置 → 发货推送 URL」配成
 *   https://<接入域名>/xpay-notify
 * path 必须与环境变量 XPAY_NOTIFY_PATH 一致（默认 /xpay-notify），否则验签不通过。
 *
 * 处理逻辑：
 * - 验签：pay_sig = HMAC-SHA256(path + '&' + 原始 body, AppKey)
 * - xpay_goods_deliver_notify：幂等发货（订单 → DELIVERED + users.quota 加次数）
 * - xpay_refund_notify：幂等退款（订单 → REFUNDED，已发货的回收次数）
 * - 成功必须返回 <xml><ErrCode>0</ErrCode>...，否则平台最多重试 15 次
 *
 * 说明：本函数是「发货推送」路径；即使未配置推送，pay 云函数的前端查单确认
 * 与每分钟定时兜底也能保证发货，二者以订单状态机天然幂等。
 *
 * 注意：发货逻辑与 pay/pay.js 的 confirmDelivery/applyRefund 等价，
 * 云函数目录相互独立无法共享代码，改动状态机时两边保持同步。
 */

const crypto = require('crypto');
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const { ensureCollections } = require('./db-init');
const ORDERS = 'orders';
const USERS = 'users';

function str(key, fallback = '') {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function hmacHex(message, key) {
  return crypto.createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

function xmlResponse(errCode, errMsg) {
  const body = `<xml><ErrCode>${errCode}</ErrCode><ErrMsg><![CDATA[${errMsg}]]></ErrMsg></xml>`;
  return {
    statusCode: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8' },
    body,
  };
}

/** 幂等发货：与 pay/pay.js confirmDelivery 状态机一致 */
async function confirmDelivery(order, wxOrderId) {
  return db.runTransaction(async (transaction) => {
    const raw = await transaction.collection(ORDERS).doc(order._id).get();
    const current = raw && raw.data ? raw.data : raw;
    if (!current) return false;
    if (current.status === 'DELIVERED' || current.status === 'REFUNDED') return false;

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

    let userDoc = null;
    try {
      const userRaw = await transaction.collection(USERS).doc(order.openid).get();
      userDoc = userRaw && userRaw.data ? userRaw.data : userRaw;
    } catch (e) {
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
    return true;
  });
}

/** 幂等退款：已发货订单回收次数（钳到 0） */
async function applyRefund(order, refundId) {
  return db.runTransaction(async (transaction) => {
    const raw = await transaction.collection(ORDERS).doc(order._id).get();
    const current = raw && raw.data ? raw.data : raw;
    if (!current || current.status === 'REFUNDED') return { refunded: false };
    if (current.status !== 'DELIVERED') {
      await transaction.collection(ORDERS).doc(order._id).update({
        data: { status: 'REFUNDED', refundId: refundId || '', updatedAt: Date.now() },
      });
      return { refunded: true };
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
      userDoc = null;
    }
    if (userDoc) {
      const base = typeof userDoc.quota === 'number' ? userDoc.quota : 0;
      await transaction.collection(USERS).doc(order.openid).update({
        data: { quota: Math.max(0, base - (order.count || 0)), updatedAt: now },
      });
    }
    return { refunded: true };
  });
}

async function getOrder(outTradeNo) {
  try {
    const res = await db.collection(ORDERS).doc(outTradeNo).get();
    return (res && res.data) || null;
  } catch (e) {
    return null;
  }
}

exports.main = async (event) => {
  // orders 集合懒创建（推送到达早于首笔下单时兜底）
  await ensureCollections(['orders']);
  const appKey = str('XPAY_APP_KEY');
  const notifyPath = str('XPAY_NOTIFY_PATH', '/xpay-notify');

  try {
    // 云接入（HTTP 访问服务）event 结构：{ path, httpMethod, headers, queryStringParameters, body, isBase64Encoded }
    const path = event.path || notifyPath;
    const rawBody = event.isBase64Encoded && event.body
      ? Buffer.from(event.body, 'base64').toString('utf8')
      : event.body || '';

    if (!appKey) {
      console.error('[xpayNotify] 缺少 XPAY_APP_KEY 环境变量');
      return xmlResponse(-1, 'server not configured');
    }
    if (event.httpMethod && event.httpMethod !== 'POST') {
      return xmlResponse(-1, 'method not allowed');
    }

    // 验签：uri 取推送 URL 的 path 部分
    const paySig =
      (event.queryStringParameters && event.queryStringParameters.pay_sig) ||
      (event.query && event.query.pay_sig) ||
      '';
    const expected = hmacHex(`${path}&${rawBody}`, appKey);
    if (!paySig || paySig !== expected) {
      console.error('[xpayNotify] 验签失败', JSON.stringify({ path, expected, paySig, body: rawBody.slice(0, 500) }));
      return xmlResponse(-1, 'invalid signature');
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      console.error('[xpayNotify] body 不是合法 JSON', rawBody.slice(0, 500));
      return xmlResponse(-1, 'bad request');
    }

    const eventName = payload.Event || payload.event || '';
    const outTradeNo = payload.OutTradeNo || payload.out_trade_no || '';
    const wxOrderId =
      (payload.WeChatPayInfo && (payload.WeChatPayInfo.MchOrderNo || payload.WeChatPayInfo.TransactionId)) || '';
    console.log(`[xpayNotify] event=${eventName} outTradeNo=${outTradeNo}`, rawBody.slice(0, 1000));

    if (eventName === 'xpay_goods_deliver_notify') {
      const order = await getOrder(outTradeNo);
      if (!order) {
        // 平台会用同一单号重试；此处拒绝让推送重试（可能是本地记录晚于推送的极端时序）
        console.error(`[xpayNotify] 订单不存在 ${outTradeNo}`);
        return xmlResponse(-1, 'order not found');
      }
      await confirmDelivery(order, wxOrderId);
      return xmlResponse(0, 'success');
    }

    if (eventName === 'xpay_refund_notify') {
      const order = await getOrder(outTradeNo);
      if (!order) {
        console.error(`[xpayNotify] 退款订单不存在 ${outTradeNo}`);
        return xmlResponse(-1, 'order not found');
      }
      const refundId =
        (payload.WeChatPayInfo && payload.WeChatPayInfo.RefundOrderId) || payload.RefundOrderId || '';
      await applyRefund(order, refundId);
      return xmlResponse(0, 'success');
    }

    // 其他事件（投诉/订阅等）先记录日志，不阻断推送
    console.warn(`[xpayNotify] 未处理事件 ${eventName}`);
    return xmlResponse(0, 'success');
  } catch (err) {
    console.error('[xpayNotify] 处理失败', err);
    return xmlResponse(-1, 'internal error');
  }
};
