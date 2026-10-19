'use strict';
const cloud = require('wx-server-sdk');

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const { ErrorCode, ok, fail } = require('./envelope');
const { listStyleMeta } = require('./catalog');
const { config } = require('./config');
const { ensureCollections } = require('./db-init');

/**
 * 应用配置 —— 下发小程序的只读运行参数。
 *
 * 特点：全是「运营侧想随时调、小程序不用发版就能生效」的参数：
 * - config 走云函数环境变量，styles 走云数据库 styles 集合（控制台改文档即生效）。
 *
 * 接口（event.action）：
 * - config：运行期配置（原图大小上限 / 建议压缩长边 / 运营公告）
 * - styles：画风目录（styles 集合真源，只含展示字段，
 *   prompt / guidance 等生成参数留数据库、绝不下发前端）
 */

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

exports.main = async (event) => {
  const rid = requestId();
  try {
    // styles 集合懒创建 + 首次播种（实例内只做一次检查）；放主流程内，
    // 数据库抖动时返回统一错误信封，而不是云平台的裸异常
    await ensureCollections(['styles']);
    if (!event || !event.action) return ok({ skipped: true }, rid);
    switch (event.action) {
      case 'config':
        return ok(runtimeConfig(), rid);
      case 'styles':
        return ok(await listStyleMeta(), rid);
      default:
        return fail(ErrorCode.BAD_REQUEST, `未知 action：${event.action}`, rid);
    }
  } catch (err) {
    console.error('[app-config] 处理失败', err);
    return fail(ErrorCode.INTERNAL, '服务暂时不可用，请稍后重试', rid);
  }
};
