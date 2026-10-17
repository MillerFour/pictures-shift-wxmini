'use strict';

/**
 * 极简配置读取（只含交易域自需要的项目）。
 *
 * 云函数里没有 .env 文件，密钥全部走「云函数环境变量」（在微信开发者工具 /
 * SCF 控制台配置），容器注入的优先级最高。
 */
function str(key, fallback = '') {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

/** 整数读取，允许 0（虚拟支付 env=0 是合法值） */
function int(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isInteger(n) && n >= 0 ? n : fallback;
}

/** 布尔开关：'true' 才为真，其余（含未配置）取 fallback */
function bool(key, fallback) {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return String(v).toLowerCase() === 'true';
}

/** 测试金额（元）→ 分："0.01" → 1。非法或缺省返回 null（走道具真实价格） */
function parseAmountFen(raw) {
  const v = String(raw).trim();
  if (!v) return null;
  const yuan = Number(v);
  if (!Number.isFinite(yuan) || yuan <= 0) return null;
  return Math.round(yuan * 100);
}

/**
 * 道具映射。默认档位与 pay-modal 占位定价一致；
 * MP 后台道具价格变动时，用环境变量覆盖（id:价格分:次数，逗号分隔），
 * 例如 XPAY_PRODUCTS="trial:680:10,value:1990:40"。
 * priceFen 必须与后台道具价格一致（单位：分），否则下单会被平台拒绝。
 */
function parseProducts(raw) {
  const map = {};
  for (const pair of String(raw).split(',')) {
    const parts = pair.split(':').map((s) => s.trim());
    const [id, priceFen, count] = parts;
    if (id && Number.isInteger(Number(priceFen)) && Number.isInteger(Number(count))) {
      map[id] = { priceFen: Number(priceFen), count: Number(count) };
    }
  }
  return map;
}

/** 道具默认目录：name/tag 是展示文案，价格与次数可被环境变量覆盖 */
const PRODUCT_CATALOG = {
  trial: { name: '体验包', priceFen: 680, count: 10, tag: '推荐' },
  value: { name: '超值包', priceFen: 1990, count: 40, tag: '更划算' },
};

const productOverrides = parseProducts(str('XPAY_PRODUCTS'));


const products = {};
for (const [id, meta] of Object.entries(PRODUCT_CATALOG)) {
  const override = productOverrides[id] || {};
  products[id] = {
    ...meta,
    priceFen: override.priceFen ?? meta.priceFen,
    count: override.count ?? meta.count,
  };
}
// 环境变量里的 id 即使不在默认目录，也允许生效（便于后台新增档位）
for (const [id, meta] of Object.entries(productOverrides)) {
  if (!products[id]) products[id] = { name: id, tag: '', ...meta };
}

const config = {
  /** 免费次数的单次发放额度（注册赠送 / 活动派发共用；查单确认后返回余额时补齐存量用户缺字段场景） */
  freeQuota: int('FREE_QUOTA', 1),

  /**
   * 微信虚拟支付（wx.requestVirtualPayment / 道具直购）。
   * OfferID 与现网 AppKey 在 MP 后台「虚拟支付 → 基本配置」；
   * AppID/AppSecret 用于换 access_token 与 session_key，只放云函数环境变量。
   * 未配置时支付相关 action 返回 PAY_NOT_CONFIGURED，不影响其他功能。
   */
  xpay: {
    offerId: str('XPAY_OFFER_ID'),
    appKey: str('XPAY_APP_KEY'),
    appid: str('WX_APPID'),
    appSecret: str('WX_APPSECRET'),
    /** 0=现网，1=沙箱。沙箱仅支持开发者工具内调试 */
    env: int('XPAY_ENV', 0),
    /** 未支付订单兜底查单的启动延迟 */
    sweepDelayMs: int('XPAY_SWEEP_DELAY_MS', 2 * 60 * 1000),
  },

  /**
   * 支付总开关（联调/演示用）：
   * - NEED_PAY=false：不拉起真实支付，下单后直接模拟发货（无需任何密钥配置）。
   * - NEED_PAY=true：走真实虚拟支付，此时要求 xpay 配置齐全。
   * - PAY_AMOUNT（元）：仅 NEED_PAY=true 时生效。空=按道具真实价格下单；
   *   如 "0.01"=所有档位统一按 1 分真实支付。注意平台校验 goodsPrice 必须与
   *   后台道具价格一致，故需把后台道具临时改为此价，或新建同价测试道具
   *   并用 XPAY_TEST_PRODUCT_ID 指定其 id（不指定则沿用所选套餐 id）。
   */
  pay: {
    needPay: bool('NEED_PAY', false),
    amountFen: parseAmountFen(str('PAY_AMOUNT')),
    testProductId: str('XPAY_TEST_PRODUCT_ID'),
  },

  products,
};

module.exports = { config };
