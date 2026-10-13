'use strict';
const https = require('https');
const http = require('http');

/** 厂商侧返回了错误，统一转成可读信息 */
class ProviderError extends Error {
  constructor(provider, message) {
    super(message);
    this.provider = provider;
    this.name = 'ProviderError';
  }
}

/**
 * 提取厂商错误信息。各家错误结构不统一，而这条消息会直接显示给小程序用户，
 * 所以宁可多试几种形状也不能退化成「返回 HTTP 402」这种废话。
 */
function readVendorError(payload) {
  if (typeof payload !== 'object' || payload === null) return '';
  const root = payload;
  const error = root.error || {};
  const output = root.output || {};
  const candidates = [
    error.message,
    error.message_zh,
    error.code,
    output.message,
    output.code,
    root.message,
    root.code,
    root.request_id,
    error.request_id,
  ];
  const parts = candidates.filter((v) => typeof v === 'string' && v.length > 0);
  return parts.join(' | ');
}

/** 把远端图片 URL 拉成字节。厂商返回临时链接，必须立刻取回 */
async function downloadImage(url, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        reject(new Error(`下载结果图失败：HTTP ${res.statusCode}`));
        return;
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const bytes = Buffer.concat(chunks);
        const contentType = res.headers['content-type'] || 'image/jpeg';
        resolve({ bytes, contentType });
      });
    });
    req.on('error', (err) => reject(new Error(`下载结果图失败：${err.message}`)));
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('下载结果图超时'));
    });
    req.setTimeout(timeoutMs);
  });
}

/** data URI 是部分厂商（如方舟）接受 base64 直传时的省事做法 */
function toDataUri(source) {
  return `data:${source.contentType};base64,${source.bytes.toString('base64')}`;
}

module.exports = { ProviderError, readVendorError, downloadImage, toDataUri };
