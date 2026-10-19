Page({
  data: {
    qa: [
      { q: '生成失败会扣次数吗？', a: '不会。生成失败不扣次数，可重新尝试。' },
      { q: '免费次数用完了怎么办？', a: '在「我的」页购买次数包即可继续创作。' },
      { q: '生成的图片版权归谁？', a: '归您自己所有，平台仅提供技术处理，不主张任何权利。' },
      { q: '支持哪些画风？', a: '吉卜力、日系动漫、3D 皮克斯、复古胶片等，画风清单由云端配置，会持续上新。' },
    ],
    open: -1,
  },

  onToggle(e: { currentTarget: { dataset: { idx?: number } } }) {
    const idx = e.currentTarget.dataset.idx ?? -1;
    this.setData({ open: this.data.open === idx ? -1 : idx });
  },
});
