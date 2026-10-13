'use strict';
const cloud = require('wx-server-sdk');

// 必须最先 init：providers/config 在模块顶层会用到云能力
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV, timeout: 150000 });

const { findStyle } = require('./catalog');
const { generate } = require('./convert');

function ok(data) {
  return { code: 0, message: 'ok', data };
}
function fail(code, message) {
  return { code, message, data: null };
}

/**
 * 同步生图入口。
 *
 * 入参：{ fileID, styleId, strength }
 *  - fileID：原图在云存储的 fileID（与前端 uploadSource 上传后拿到的一致）
 *  - styleId：沿用 catalog 中的风格 id（如 ghibli / anime / pixar / film）
 *  - strength：0-100 风格强度
 * 出参（统一信封）：{ code:0, message:'ok', data:{ resultFileID, resultUrl, costMs } }
 */
exports.main = async (event) => {
  try {
    const { fileID, styleId, strength } = event;
    if (!fileID || typeof fileID !== 'string') return fail(400, '缺少原图 fileID');
    if (!styleId || typeof styleId !== 'string') return fail(400, '缺少风格 id');
    if (!findStyle(styleId)) return fail(404, `风格 ${styleId} 不存在`);

    const result = await generate(fileID, styleId, strength);

    // 顺手换好临时直链，省去前端再调一次 getTempFileURL
    let resultUrl = '';
    try {
      const res = await cloud.getTempFileURL({ fileList: [result.resultFileID] });
      resultUrl = (res.fileList && res.fileList[0] && res.fileList[0].tempFileURL) || '';
    } catch (e) {
      resultUrl = '';
    }

    return ok({ resultFileID: result.resultFileID, resultUrl, costMs: result.costMs });
  } catch (err) {
    console.error('[generatelmage] 出图失败', err);
    return fail(500, err instanceof Error ? err.message : '生图失败');
  }
};
