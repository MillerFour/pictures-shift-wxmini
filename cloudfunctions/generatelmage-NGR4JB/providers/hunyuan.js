'use strict';
const cloud = require('wx-server-sdk');
const { ProviderError, downloadImage } = require('./types');

/**
 * 腾讯云开发（CloudBase）原生混元图生图。
 * 走 cloud.ai() 内置能力，无需自建 HTTP、无需第三方 API Key，
 * 仅依赖当前云环境已开通「混元生图」模型权限。
 *
 * 文档：https://docs.cloudbase.net/ai/image-model/image-to-image
 */
function createHunyuanProvider(cfg = {}) {
  const model = cfg.model || 'HY-Image-v3.0-I2I-ToB-v1.0.1';

  function buildPrompt(style, strength) {
    return [
      style.prompt,
      strength < 50 ? '尽可能保留原图人物的五官、发型与姿态，只做画风转译' : '',
    ]
      .filter(Boolean)
      .join('。');
  }

  return {
    name: 'hunyuan',
    async submit(input) {
      let imageModel;
      try {
        imageModel = cloud.ai().createImageModel('hunyuan-image');
      } catch (e) {
        throw new ProviderError(
          'hunyuan',
          `初始化混元生图失败：${e.message}（请确认 wx-server-sdk>=4.0.2 且云环境已开通混元生图能力）`,
        );
      }

      const prompt = buildPrompt(input.style, input.strength);
      // 优先内联 base64，避免依赖原图公网地址（云存储文件默认非公开）
      const base64 = input.source.bytes.toString('base64');

      let res;
      try {
        res = await imageModel.generateImage({
          model,
          prompt,
          images: [base64],
          revise: { value: true },
        });
      } catch (e) {
        throw new ProviderError('hunyuan', `混元生图调用失败：${e.message}`);
      }

      const item = res && res.data && res.data[0];
      const url = item && (item.url || item.image_url);
      if (!url) {
        const shape = JSON.stringify(res).slice(0, 500);
        throw new ProviderError('hunyuan', `混元返回里找不到图片 URL。响应：${shape}`);
      }
      const image = await downloadImage(url);
      return { state: 'SUCCEEDED', image };
    },
    async poll() {
      throw new ProviderError('hunyuan', '混元图生图是同步接口，不该进入轮询');
    },
  };
}

module.exports = { createHunyuanProvider };
