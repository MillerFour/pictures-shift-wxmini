'use strict';
const cloud = require('wx-server-sdk');
const db = cloud.database();
const _ = db.command;

/**
 * 画风目录 —— 线上真源在云数据库 styles 集合（控制台改文档即生效，无需部署）。
 *
 * 本文件只剩两个职责：
 * 1. BUILT_IN_STYLES：首次播种数据 + 数据库不可用时的展示兜底；
 * 2. listStyleMeta：读取上架中画风的展示字段（prompt 等生成参数绝不下发前端）。
 *
 * prompt 编写规范（播种与日常在数据库新增画风都要遵守）：
 * 1. 每条 prompt 都显式写「保留原图人物的五官、发型与身份」。
 * 2. negativePrompt 重点压制「照片质感」。
 * 3. guidance 是区间而非定值：小程序「风格强度」滑块线性映射到区间内。
 *
 * 示例素材约定：不在数据库配置 —— 前端 miniprogram/constants/examples.ts
 * 写死云存储 fileID（根目录 example/ 文件夹：original.jpg 共用原图 +
 * {key}.jpg 各画风效果图），替换素材覆盖同名文件即可，与本函数无关。
 */
const STYLES_COLLECTION = 'styles';

const BUILT_IN_STYLES = [
  {
    id: 'ghibli',
    name: '吉卜力',
    subtitle: '手绘动画 · 治愈光影',
    swatch: '#6f8a5f',
    prompt: [
      '吉卜力工作室风格的手绘动画插画',
      '严格保留原图人物的五官特征、发型、年龄与表情，不改变人物身份',
      '赛璐璐平涂上色，清晰的色块边界，柔和的自然光',
      '温暖的午后色调，通透的空气感',
      '背景替换为郁郁葱葱的乡野、层叠的山丘与棉花糖般的积云',
      '细腻的线条，胶片颗粒质感，画面干净，高细节',
    ].join('，'),
    negativePrompt:
      '照片质感，写实皮肤纹理，塑料感，过度磨皮，浓妆，现代服饰，现代建筑，汽车，文字，水印，畸变，多余手指，低分辨率，噪点',
    guidance: [3, 9],
    ipStyle: true,
  },
  {
    id: 'anime',
    name: '日系动漫',
    subtitle: '清透上色 · 大眼萌',
    swatch: '#c08a93',
    prompt: [
      '日系赛璐璐动漫插画风格',
      '保留原图人物的五官特征与发型，整体向动漫比例适度夸张',
      '干净锐利的线稿，明亮的大眼睛，柔和的睫毛高光',
      '淡雅通透的水彩色调，柔和渐变上色',
      '樱花与晴空的简洁背景',
      '高分辨率，精细线稿',
    ].join('，'),
    negativePrompt:
      '照片质感，写实皮肤，油腻高光，浓重阴影，3D 渲染感，文字，水印，畸变，多余手指，模糊，低分辨率',
    guidance: [4, 10],
    ipStyle: false,
  },
  {
    id: 'pixar',
    name: '3D 皮克斯',
    subtitle: '立体毛发 · 电影打光',
    swatch: '#5f7f96',
    prompt: [
      '皮克斯风格的三维动画角色',
      '保留原图人物的五官特征与发型特征，做成大头身比例的动画角色',
      '精细的毛发与次表面散射皮肤质感',
      '电影级三点布光，柔和的轮廓光，浅景深虚化背景',
      '明快饱和的色彩，温暖的画面氛围',
      '高细节，专业渲染',
    ].join('，'),
    negativePrompt:
      '照片质感，恐怖谷，写实人像，扁平插画，文字，水印，畸变，多余手指，噪点，低分辨率',
    guidance: [3, 9],
    ipStyle: true,
  },
  {
    id: 'film',
    name: '复古胶片',
    subtitle: '胶片颗粒 · 褪色暖调',
    swatch: '#8b7455',
    prompt: [
      '1990 年代胶片摄影质感',
      '保留原图人物的五官、发型与姿态',
      '柯达 Gold 风格的暖黄偏色，褪色的高光与偏青的阴影',
      '细腻的胶片颗粒，轻微漏光，柔和的暗角',
      '低对比度，轻微色差',
      '自然光，真实生活感',
    ].join('，'),
    negativePrompt:
      '数字锐化，HDR，过饱和，塑料感，文字，水印，畸变，多余手指，画面过亮，低分辨率',
    guidance: [2, 7],
    ipStyle: false,
  },
];

/** 对外只暴露展示字段，prompt / guidance 不外泄 */
function toStyleMeta(doc) {
  return {
    id: doc._id || doc.id,
    name: doc.name || '',
    subtitle: doc.subtitle || '',
    swatch: doc.swatch || '',
  };
}

function sortKey(doc) {
  return Number.isFinite(doc.sort) ? doc.sort : Number.MAX_SAFE_INTEGER;
}

/** 播种标记：按实例只查一次 */
let seedChecked = false;

/** 集合为空时播种内置画风（add 带 _id，重复播种报错被吞掉，天然幂等） */
async function ensureSeed() {
  if (seedChecked) return;
  try {
    const res = await db.collection(STYLES_COLLECTION).count();
    if ((res && res.total) > 0) {
      seedChecked = true;
      return;
    }
    const now = Date.now();
    for (let i = 0; i < BUILT_IN_STYLES.length; i += 1) {
      const { id, ...rest } = BUILT_IN_STYLES[i];
      try {
        await db.collection(STYLES_COLLECTION).add({
          data: { _id: id, ...rest, enabled: true, sort: i + 1, createdAt: now, updatedAt: now },
        });
      } catch (e) {
        // _id 已存在（并发播种 / 手工建过）：忽略，保证幂等
      }
    }
    seedChecked = true;
    console.log('[app-config] styles 集合已播种内置画风');
  } catch (e) {
    console.error('[app-config] styles 播种检查失败', e);
  }
}

/**
 * 上架中的画风展示列表（控制台改文档即时生效，无需部署）。
 * 排序：sort 小者在前，未写 sort 的新画风排最后（上架不打扰现有排序）。
 * 数据库不可用或为空时兜底返回内置画风，保证小程序可用。
 */
async function listStyleMeta() {
  await ensureSeed();
  try {
    const res = await db.collection(STYLES_COLLECTION)
      .where({ enabled: _.neq(false) })
      .limit(50)
      .get();
    const docs = (res && res.data) || [];
    if (!docs.length) return BUILT_IN_STYLES.map(toStyleMeta);
    docs.sort((a, b) => sortKey(a) - sortKey(b));
    return docs.map(toStyleMeta);
  } catch (e) {
    console.error('[app-config] styles 读取失败，使用内置兜底', e);
    return BUILT_IN_STYLES.map(toStyleMeta);
  }
}

module.exports = { listStyleMeta };
