/**
 * 图像对比滑块（Before-After）。
 *
 * 底层铺「转换后」图，上层叠「原图」(view + background-image)，用 clip-path 横向裁切，
 * 裁切边界跟随中间分割线。原生 <image> 不支持 clip-path，故原图层用非原生 view 承载。
 *
 * 拖拽事件只绑在把手（.cmp-knob）上：其余元素不捕获触摸 → 页面纵向滚动不受影响；
 * 触摸被把手捕获后，即便手指移出把手仍持续收到 touchmove，拖动顺滑无延迟。
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
    /** 容器像素宽：让原图与成片等宽对齐 */
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
          this.setData({ boxW: Math.round(rect.width), rectLeft: rect.left, rectWidth: rect.width || 1 });
        })
        .exec();
    },

    /** 把手的 touchstart / touchmove 共用：实时换算分割位置 */
    onTouch(e: WechatMiniprogram.TouchEvent) {
      const t = e.touches[0] || e.changedTouches[0];
      if (!t) return;
      // 每次按下重新测量，纠正页面滚动后 left 偏移
      if (e.type === 'touchstart') this.measure();
      const w = this.data.boxW || this.data.rectWidth;
      if (!w) return;
      const x = t.clientX - this.data.rectLeft;
      let p = (x / w) * 100;
      p = Math.max(0, Math.min(100, p));
      this.setData({ pos: p });
    },

    /** 无障碍 slider：键盘左右键微调（小程序支持有限，作为增强） */
    onKey(e: WechatMiniprogram.KeyboardEvent) {
      const code = (e as unknown as { keyCode?: number; key?: string }).keyCode;
      const step = 2;
      let p = this.data.pos;
      if (code === 37 || (e as unknown as { key?: string }).key === 'ArrowLeft') p -= step;
      else if (code === 39 || (e as unknown as { key?: string }).key === 'ArrowRight') p += step;
      else return;
      p = Math.max(0, Math.min(100, p));
      this.setData({ pos: p });
    },
  },
});
