'use strict';
const cloud = require('wx-server-sdk');
const { config } = require('./config');
const { findStyle } = require('./catalog');
const { ProviderError } = require('./providers/types');
const { createProvider } = require('./providers');

function detectImageType(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'image/jpeg';
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(png)) return 'image/png';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  return null;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadSource(fileID) {
  const res = await cloud.downloadFile({ fileID });
  return { bytes: Buffer.from(res.fileContent), contentType: res.contentType || 'image/jpeg' };
}

/** 给「只能用公网 URL 取图」的厂商（如百炼）生成原图临时公网地址 */
async function resolveSourceUrl(fileID) {
  try {
    const res = await cloud.getTempFileURL({ fileList: [fileID] });
    return (res.fileList && res.fileList[0] && res.fileList[0].tempFileURL) || '';
  } catch {
    return '';
  }
}

/**
 * 同步出图：一次调用内完成「下载原图 → 调厂商 → 上传结果到云存储」，
 * 直接返回结果图的 fileID 与耗时，不再走异步任务表。
 *
 * 任务落盘：task/{openid}/{stamp}_result.{ext}，与原图
 * task/{openid}/{stamp}_original.{ext} 共用时间戳前缀配对成任务。
 * model 由入口解析后传入（models 集合真源）；为 null 时回退 STYLE_PROVIDER 默认引擎。
 */
async function generate(originalFileID, styleId, strength, model, task) {
  const startedAt = Date.now();
  // 画风参数来自 styles 集合真源（控制台改文档即生效）；不存在/已下架直接失败
  const style = await findStyle(styleId);
  if (!style) throw new Error(`风格 ${styleId} 不存在`);

  const source = await downloadSource(originalFileID);
  const contentType = detectImageType(source.bytes);
  if (!contentType) throw new Error('只支持 JPG / PNG / WebP 图片');

  const provider = model ? createProvider(model.provider, model) : createProvider();
  const sourceUrl = await resolveSourceUrl(originalFileID);
  const input = { style, strength: Number(strength) || 60, source, publicSourceUrl: sourceUrl };

  let state = await provider.submit(input);
  const deadline = Date.now() + config.vendorPollTimeoutMs;
  while (state.state !== 'SUCCEEDED' && state.state !== 'FAILED') {
    if (!state.vendorTaskId) throw new ProviderError(provider.name, '厂商既没返回图片，也没返回任务 id');
    if (Date.now() > deadline) throw new ProviderError(provider.name, '厂商出图超时');
    await sleep(config.vendorPollIntervalMs);
    state = await provider.poll(state.vendorTaskId);
  }
  if (state.state === 'FAILED') throw new Error(state.message || '生成失败');

  // 结果图落到用户任务目录，与原图按时间戳配对；前端用 getTempFileURL 取直链
  const ext = state.image.contentType.includes('png') ? 'png' : 'jpg';
  const resultCloudPath = `task/${task.openid}/${task.stamp}_result.${ext}`;
  const up = await cloud.uploadFile({ cloudPath: resultCloudPath, fileContent: state.image.bytes });
  return { resultFileID: up.fileID, contentType: state.image.contentType, costMs: Date.now() - startedAt };
}

module.exports = { generate };
