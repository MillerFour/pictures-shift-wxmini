/**
 * 图像对比滑块。
 *
 * 左半边是原图（before），右半边是成片（after），中间一条可拖动的分割线。
 * 拖动时改变 before 容器的宽度（百分比），露出或盖住原图，从而实现「擦除式」对比。
 *
 * before 图宽度用测量得到的容器像素宽（boxW）固定，避免被外层裁剪容器压窄，
 * 这样两侧图片始终等宽对齐。
 */
Component({
  options: { addGlobalClass: true },

  properties: {
    /** 左/下：原图 */
    before: { type: String, value: '' },
    /** 右/上：成片 */
    after: { type: String, value: '' },
    /** 初始分割位置 0-100 */
    initial: { type: Number, value: 50 },
  },

  data: {
    pos: 50,
    boxW: 0,
    rectLeft: 0,
    rectWidth: 1,
  },

  lifetimes: {
    attached() {
      this.setData({ pos: this.data.initial });
    },
    ready() {
      this.measure();
    },
  },

  methods: {
    measure() {
      wx.createSelectorQuery()
        .in(this)
        .select('.cmp')
        .boundingClientRect((rect) => {
          if (!rect) return;
          this.setData({
            boxW: Math.round(rect.width),
            rectLeft: rect.left,
            rectWidth: rect.width || 1,
          });
        })
        .exec();
    },

    onTouch(e: WechatMiniprogram.TouchEvent) {
      const t = e.touches[0] || e.changedTouches[0];
      if (!t) return;
      const { rectLeft, rectWidth } = this.data;
      let p = ((t.clientX - rectLeft) / rectWidth) * 100;
      p = Math.max(0, Math.min(100, p));
      this.setData({ pos: p });
    },
  },
});
