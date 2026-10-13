'use strict';
const cloud = require('wx-server-sdk');
const { config } = require('./config');
const { findStyle } = require('./catalog');
const { ProviderError } = require('./providers/types');
const { createProvider } = require('./providers');
const tasks = require('./tasks');

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
 * 后台执行一次转换。
 *
 * 不 await 是刻意的：create 接口只负责建任务并立刻回执，出图是分钟级操作，
 * 挂在请求上会让小程序超时。状态全部落在云数据库，由 claim 保证单实例执行。
 */
async function runConversion(taskId, styleId, sourceFileID, strength) {
  if (!(await tasks.claim(taskId))) return; // 已被别的实例接手

  try {
    const style = findStyle(styleId);
    if (!style) throw new Error(`风格 ${styleId} 不存在`);

    const source = await downloadSource(sourceFileID);
    const contentType = detectImageType(source.bytes);
    if (!contentType) throw new Error('只支持 JPG / PNG / WebP 图片');

    const provider = createProvider();
    const sourceUrl = await resolveSourceUrl(sourceFileID);

    const input = { taskId, style, strength: Number(strength) || 60, source, publicSourceUrl: sourceUrl };

    let state = await provider.submit(input);
    const deadline = Date.now() + config.vendorPollTimeoutMs;

    while (state.state !== 'SUCCEEDED' && state.state !== 'FAILED') {
      if (!state.vendorTaskId) throw new ProviderError(provider.name, '厂商既没返回图片，也没返回任务 id');
      await tasks.patch(taskId, { vendorTaskId: state.vendorTaskId });
      if (Date.now() > deadline) throw new ProviderError(provider.name, '厂商出图超时');
      await sleep(config.vendorPollIntervalMs);
      state = await provider.poll(state.vendorTaskId);
    }

    if (state.state === 'FAILED') {
      await tasks.patch(taskId, { status: 'FAILED', errorMessage: state.message, finishedAt: Date.now() });
      return;
    }

    // 结果图落到云存储，拿稳定 fileID 存库，前端用 getTempFileURL 取直链
    const ext = state.image.contentType.includes('png') ? 'png' : 'jpg';
    const resultCloudPath = `result/${taskId}.${ext}`;
    const up = await cloud.uploadFile({ cloudPath: resultCloudPath, fileContent: state.image.bytes });
    await tasks.patch(taskId, { status: 'SUCCEEDED', resultFileID: up.fileID, finishedAt: Date.now() });
  } catch (err) {
    console.error(`[convert:${taskId}] 失败`, err);
    await tasks.patch(taskId, {
      status: 'FAILED',
      errorMessage: err instanceof Error ? err.message : '未知错误',
      finishedAt: Date.now(),
    });
  }
}

module.exports = { runConversion };
