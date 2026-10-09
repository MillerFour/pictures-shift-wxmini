import type { StyleDefinition, StyleMeta } from './types.js';

/**
 * 风格目录 —— 全站唯一的风格真源。
 *
 * 设计要点：
 * 1. 每条 prompt 都显式写「保留原图人物的五官、发型与身份」。
 *    图生图模型最容易出的问题是把人画成陌生人，这条约束比任何美术描述都重要。
 * 2. negativePrompt 里重点压制「照片质感」。不给负向约束，模型会保留写实光影，
 *    风格化就只剩下「加了个滤镜」。
 * 3. guidance 是区间而非定值：小程序端的「风格强度」滑块线性映射到区间内，
 *    不同风格的可用区间不同，胶片类需要大幅偏移，3D 卡通类可以更极端。
 */
export const STYLES: StyleDefinition[] = [
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
export function toStyleMeta(def: StyleDefinition): StyleMeta {
  const { id, name, subtitle, swatch } = def;
  return { id, name, subtitle, swatch };
}

export function listStyleMeta(): StyleMeta[] {
  return STYLES.map(toStyleMeta);
}

export function findStyle(id: string): StyleDefinition | undefined {
  return STYLES.find((s) => s.id === id);
}

/** 把小程序传来的 0-100 强度线性映射到该风格的 guidance 区间 */
export function guidanceOf(def: StyleDefinition, strength: number): number {
  const [min, max] = def.guidance;
  const ratio = Math.min(100, Math.max(0, strength)) / 100;
  return Math.round(min + (max - min) * ratio);
}