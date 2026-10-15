'use strict';

/**
 * 微信虚拟支付服务端能力封装。
 *
 * 只做三件事：
 * 1. 双签名（paySig 用 AppKey 签接口消息体，signature 用 session_key 签 signData）
 * 2. 凭证管理（stable_token 缓存到 tokens 集合；code2Session 换 session_key）
 * 3. 查单（/xpay/query_order，发货推送丢失时的兜底确认）
 *
 * 密钥全部来自云函数环境变量，不落在代码里。
 * 签名规则（官方）：paySig = HMAC-SHA256(uri + '&' + post_body, AppKey)，
 * post_body 必须与实际发出的请求体逐字节一致 —— 因此这里签名与发送用同一个字符串。
 */

const crypto = require('crypto');
const { httpJson } = require('./http');
const cloud = require('wx-server-sdk');
const db = cloud.database();

const API_BASE = 'https://api.weixin.qq.com';
const TOKEN_DOC = 'xpay_access_token';
/** token 有效期 7200s，提前 5 分钟过期，避免边界时刻请求失败 */
const TOKEN_EARLY_EXPIRE_MS = 5 * 60 * 1000;

function hmacHex(message, key) {
  return crypto.createHmac('sha256', key).update(message, 'utf8').digest('hex');
}

/** 虚拟支付是否已配置（缺一项则视为未配置，支付 action 直接返回明确错误） */
function isConfigured(xpay) {
  return Boolean(xpay && xpay.offerId && xpay.appKey && xpay.appid && xpay.appSecret);
}

/**
 * 构造 C 端下单参数（wx.requestVirtualPayment 的入参）。
 *
 * signData 字段顺序即序列化顺序，前端必须原样透传该字符串，不可重新序列化。
 * goodsPrice 单位为分，且必须与 MP 后台道具价格一致。
 */
function buildPayData({ xpay, sessionKey, productId, goodsPrice, outTradeNo, attach }) {
  const signData = JSON.stringify({
    offerId: xpay.offerId,
    buyQuantity: 1,
    env: xpay.env,
    currencyType: 'CNY',
    productId,
    goodsPrice,
    outTradeNo,
    attach: attach || '',
  });
  return {
    signData,
    mode: 'short_series_goods',
    paySig: hmacHex(`requestVirtualPayment&${signData}`, xpay.appKey),
    signature: hmacHex(signData, sessionKey),
  };
}

/** 推送/服务端接口通用验签（发货推送 pay_sig 校验也走这里） */
function verifyPaySig(xpay, uri, postBody, paySig) {
  if (!xpay.appKey || !paySig) return false;
  const expected = hmacHex(`${uri}&${postBody}`, xpay.appKey);
  const a = Buffer.from(expected);
  const b = Buffer.from(String(paySig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * 小程序全局接口调用凭证（stable_token）。
 *
 * 云函数实例随时可能回收，内存缓存不可靠，落到 tokens 集合跨实例共享，
 * 避免多实例并发刷新触发频控。
 */
async function getAccessToken(xpay) {
  const now = Date.now();
  try {
    const cached = await db.collection('tokens').doc(TOKEN_DOC).get();
    const data = cached && cached.data;
    if (data && data.token && data.expireAt > now) return data.token;
  } catch (e) {
    // 文档不存在 -> 继续刷新
  }

  const res = await httpJson(`${API_BASE}/cgi-bin/stable_token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'client_credential',
      appid: xpay.appid,
      secret: xpay.appSecret,
      force_refresh: false,
    }),
  });
  const body = JSON.parse(res.text || '{}');
  if (!body || !body.access_token) {
    throw new Error(`获取 access_token 失败：${(body && (body.errmsg || body.errcode)) || '空响应'}`);
  }
  const expireAt = now + ((body.expires_in || 7200) - 300) * 1000;
  const record = { token: body.access_token, expireAt, updatedAt: now };
  try {
    await db.collection('tokens').doc(TOKEN_DOC).set({ data: record });
  } catch (e) {
    // 缓存写失败不阻断：token 本身已拿到，本次请求仍可用
  }
  return record.token;
}

/** 用 wx.login 的 code 换 session_key（临时使用，不落库） */
async function code2Session(xpay, code) {
  const url =
    `${API_BASE}/sns/jscode2session?appid=${encodeURIComponent(xpay.appid)}` +
    `&secret=${encodeURIComponent(xpay.appSecret)}` +
    `&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const res = await httpJson(url);
  const body = JSON.parse(res.text || '{}');
  if (!body || body.errcode) {
    throw new Error(`code2Session 失败：${(body && (body.errmsg || body.errcode)) || '空响应'}`);
  }
  if (!body.session_key) throw new Error('code2Session 未返回 session_key');
  return { openid: body.openid, sessionKey: body.session_key };
}

/**
 * 查单兜底。参数名是 order_id（传业务单号 outTradeNo），不是 out_trade_no。
 * 返回 { ok, order } 或 { ok: false, errcode, errmsg }，由调用方决定如何处置。
 */
async function queryOrder(xpay, openid, outTradeNo) {
  const token = await getAccessToken(xpay);
  const postBody = JSON.stringify({ openid, env: xpay.env, order_id: outTradeNo });
  const paySig = hmacHex(`/xpay/query_order&${postBody}`, xpay.appKey);
  const url = `${API_BASE}/xpay/query_order?access_token=${encodeURIComponent(token)}&pay_sig=${encodeURIComponent(paySig)}`;

  const res = await httpJson(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: postBody,
  });
  const body = JSON.parse(res.text || '{}');
  if (!body || body.errcode) {
    console.error(`[xpay] query_order 失败 ${outTradeNo}`, body);
    return { ok: false, errcode: (body && body.errcode) || -1, errmsg: (body && body.errmsg) || '查询失败' };
  }
  console.log(`[xpay] query_order ${outTradeNo}`, JSON.stringify(body));
  return { ok: true, order: body.order || {} };
}

/** 查单响应里的支付状态兼容集（以 SUCCESS 为主，宽容其余历史写法） */
function isPaidStatus(status) {
  return status === 'SUCCESS' || status === 'PAID' || status === 'PAY_SUCCESS';
}

module.exports = { buildPayData, verifyPaySig, getAccessToken, code2Session, queryOrder, isConfigured, isPaidStatus };
