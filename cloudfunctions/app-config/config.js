'use strict';

/**
 * 极简配置读取（只含元数据下发自需要的项目）。
 * 云函数里没有 .env 文件，配置全部走「云函数环境变量」，容器注入的优先级最高。
 */
function str(key, fallback = '') {
  const v = process.env[key];
  return v === undefined || v === '' ? fallback : v;
}

function num(key, fallback) {
  const n = Number(process.env[key]);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const config = {
  maxFileSizeMB: num('MAX_FILE_SIZE_MB', 8),
  recommendedLongEdge: num('RECOMMENDED_LONG_EDGE', 1280),
  notice: str('NOTICE'),
};

module.exports = { config };
