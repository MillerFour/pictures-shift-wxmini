'use strict';
const cloud = require('wx-server-sdk');
const db = cloud.database();

/**
 * 画风参数读取（styles 集合 = 唯一真源，控制台改文档即生效，无需部署）。
 *
 * 字段约定（与 app-config/catalog.js 的播种数据一致）：
 * - prompt / negativePrompt：生成参数，绝不下发前端
 * - guidance: [min, max]：风格强度滑块线性映射的区间
 * - enabled: true/false：下架开关（不写视为上架）
 *
 * 生图链路本就强依赖数据库（次数扣减 / 记录落库），这里不做代码兜底：
 * 读取失败按异常上抛（内部错误），画风不存在或已下架返回 null（调用方按 404 处理）。
 */

/** 读取单个画风（含生成参数）；不存在或已下架返回 null */
async function findStyle(styleId) {
  try {
    const res = await db.collection('styles').doc(styleId).get();
    const style = res && res.data;
    if (!style || style.enabled === false) return null;
    return style;
  } catch (e) {
    const msg = String((e && (e.message || e.errMsg)) || e);
    if (/not exist|-502005/i.test(msg)) return null; // 文档不存在
    throw e; // 数据库故障：上抛，按内部错误处理
  }
}

/** 把小程序传来的 0-100 强度线性映射到该风格的 guidance 区间；区间缺失/非法时回退默认 */
function guidanceOf(style, strength) {
  const range =
    Array.isArray(style.guidance) &&
    style.guidance.length === 2 &&
    style.guidance.every((n) => Number.isFinite(n))
      ? style.guidance
      : [3, 9];
  const [min, max] = range;
  const ratio = Math.min(100, Math.max(0, strength)) / 100;
  return Math.round(min + (max - min) * ratio);
}

module.exports = { findStyle, guidanceOf };
