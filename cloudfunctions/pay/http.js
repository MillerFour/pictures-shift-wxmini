'use strict';

/**
 * HTTP 工具：云函数容器没有全局 fetch（实测 TCB Node 运行时），
 * 所有外呼（微信 API / 方舟等）统一走 https 模块。
 * 返回 { status, text }；网络层错误与超时抛 Error，由调用方包装。
 */

const https = require('https');
const http = require('http');

function httpJson(url, { method = 'GET', headers = {}, body = '', timeoutMs = 30000 } = {}) {
  return new Promise((resolve, reject) => {
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      reject(new Error(`非法 URL：${url}`));
      return;
    }
    const client = u.protocol === 'https:' ? https : http;
    const payload = body ? Buffer.from(String(body), 'utf8') : null;
    const req = client.request(
      {
        hostname: u.hostname,
        port: u.port || (u.protocol === 'https:' ? 443 : 80),
        path: `${u.pathname}${u.search}`,
        method,
        headers: payload ? { ...headers, 'Content-Length': payload.length } : headers,
        timeout: timeoutMs,
      },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('error', (err) => reject(new Error(`读取响应失败：${err.message}`)));
        res.on('end', () => {
          resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') });
        });
      },
    );
    req.on('error', (err) => reject(new Error(`请求失败：${err.message}`)));
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    if (payload) req.write(payload);
    req.end();
  });
}

module.exports = { httpJson };
