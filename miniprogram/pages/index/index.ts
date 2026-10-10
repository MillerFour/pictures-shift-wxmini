import { ENV } from '../../config/env';
import { createTask, loadRuntimeConfig, loadStyles, waitTask } from '../../services/api';
import { STYLE_FALLBACK } from '../../constants/styles';

import { chooseImage, saveToAlbum } from '../../utils/image';
import { toFriendlyMessage } from '../../utils/error';
import { getQuota, setQuota, consumeQuota } from '../../utils/quota';
import { setTabBarHidden, syncTabBarFromPage, TAB_BAR_RPX_HEIGHT } from '../../utils/tabbar';
import { isLoggedIn, type WxUser } from '../../utils/auth';
import type { StyleMeta } from '../../types';

/**
 * 单页三步向导：上传 → 选风格 → 出图。
 *
 * 做成单页而不是三页，是因为这是一条线性引导流程：
 * 页面跳转会让用户丢掉「我已经选好的东西」，跨页传数据又得靠 storage 中转
 * （原先 result 页就是这么写的）。单页把状态收在一处，onReset 一句话回到起点。
 */
type Step = 'upload' | 'style' | 'result';

const FALLBACK_STYLE = STYLE_FALLBACK[0];

function formatCost(ms: number): string {
  return ms < 1000 ? `${ms} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`;
}

Page({
  data: {
    /** 滚动区高度（px）。0 = 还没量出来，先吃 CSS 的 100% */
    scrollH: 0,

    step: 'upload' as Step,
    /** 步骤条用：1 / 2 / 3。由 goStep 统一维护，不要手动改 */
    stepIdx: 1,

    /** 示例：原图与成片（使用用户提供的真实素材） */
    exampleOriginal: '/assets/example-panda.jpg',
    exampleAfter: '/assets/example-panda-ghibli.png',

    styles: [] as StyleMeta[],
    styleId: FALLBACK_STYLE.id,
    styleName: FALLBACK_STYLE.name,
    /** 主按钮文案跟着选择走：「生成吉卜力风格」比「生成这张风格」明确得多 */
    submitLabel: `生成${FALLBACK_STYLE.name}风格`,

    photoPath: '',
    photoMeta: '',
    /** 0-100 */
    strength: 60,
    maxSizeMB: 8,
    notice: '',

    /** 生成中 */
    submitting: false,
    phaseText: '',
    phaseHint: '',
    /** 上传为真实百分比；出图为伪进度，永不越过 90 */
    progress: 0,
    indeterminate: false,

    /** 结果 */
    resultUrl: '',
    costText: '',
    revealed: false,
    showOriginal: false,
    saving: false,

    /** 付费墙（占位弹层） */
    showPay: false,

    /** 授权登录弹层：未登录点击上传时弹出 */
    showLogin: false,
  },

  /**
   * 页面是否还活着。
   * 出图是分钟级异步流程，用户很可能中途退出；
   * 卸载后 setData 会直接抛错，所以每个异步回调都要先判断。
   */
  alive: true,
  timer: null as number | null,

  onLoad() {
    this.alive = true;
    void this.hydrate();
  },

  onReady() {
    this.measureScrollArea();
  },

  onShow() {
    // 底部菜单高亮由本页自己同步：此刻 route 必然正确，不受框架复用实例的时序影响
    syncTabBarFromPage(this);
  },

  /**
   * 量出滚动区真实高度。
   *
   * 不能写死 100vh：自定义 tabBar 是覆盖在页面上的独立渲染层，不同机型/版本上
   * 框架给页面留的可视高度并不一致 —— 有的已经把 tabBar 那段扣掉了，有的没有。
   * 前者还按 100vh 取，页面底部就会多出一条能拖动的空白；后者不扣，底部操作条
   * 会被菜单压住。所以量一次页面容器的实际高度，再决定要不要减去 tabBar 那一段。
   */
  measureScrollArea(): void {
    const sys = wx.getSystemInfoSync();
    wx.createSelectorQuery()
      .select('.index-page')
      .boundingClientRect((rect) => {
        if (!rect || !this.alive) return;

        const rpx = sys.windowWidth / 750;
        // 底部菜单自身高度 + Home 指示器那一段
        const safeBottom = sys.safeArea ? Math.max(0, sys.screenHeight - sys.safeArea.bottom) : 0;
        const barPx = TAB_BAR_RPX_HEIGHT * rpx + safeBottom;

        // 框架已预留过 tabBar 高度时，页面容器会明显矮于 windowHeight，不再重复减
        const reserved = sys.windowHeight - rect.height;
        const visible = Math.min(rect.height, sys.windowHeight) - (reserved < barPx / 2 ? barPx : 0);

        const h = Math.round(visible - rect.top);
        if (h > 0) this.setData({ scrollH: h });
      })
      .exec();
  },

  onUnload() {
    this.alive = false;
    this.stopFakeProgress();
    setTabBarHidden(false);
  },

  onShareAppMessage() {
    const { resultUrl, styleName, step } = this.data;
    // 只有出图后才带成片做分享封面，否则分享出去是个空壳首页
    const ready = step === 'result' && !!resultUrl;
    return {
      title: ready ? `我把自拍变成了${styleName}风格 · 照片百变` : '照片百变 · 上传照片一键换画风',
      path: '/pages/index/index',
      imageUrl: ready ? ENV.API_BASE + resultUrl : '',
    };
  },

  /**
   * 统一推进步骤。
   * stepIdx 只在这里改，避免「step 和步骤条显示不一致」这种低级错位。
   */
  goStep(step: Step): void {
    this.setData({ step, stepIdx: step === 'upload' ? 1 : step === 'style' ? 2 : 3 });
  },

  /** 同步选中画风 + 主按钮文案 */
  syncSelection(styleId: string): void {
    const picked = this.data.styles.find((s) => s.id === styleId);
    const name = picked?.name ?? '';
    this.setData({
      styleId,
      styleName: name,
      submitLabel: `生成${name}风格`,
    });
  },

  /** 拉风格与运行期配置；失败退回内置数据，不打断用户 */
  async hydrate(): Promise<void> {
    const [styles, config] = await Promise.allSettled([loadStyles(), loadRuntimeConfig()]);
    if (!this.alive) return;

    if (styles.status === 'fulfilled' && styles.value.length > 0) {
      // 默认选中一个，用户一进第二屏就有可提交的选择，不用先点一下
      const list = styles.value;
      this.setData({ styles: list });
      this.syncSelection(list.find((s) => s.id === this.data.styleId)?.id ?? list[0].id);
    } else {
      this.setData({ styles: STYLE_FALLBACK });
    }

    if (config.status === 'fulfilled') {
      this.setData({
        maxSizeMB: config.value.maxFileSizeMB,
        notice: config.value.notice ?? '',
      });
    }
  },
  /* ================= 第一步：上传 ================= */

  onPickPhoto(): void {
    // 未登录先弹授权登录；授权完成后由 onLoginSuccess 继续上传流程
    if (!isLoggedIn()) {
      this.setData({ showLogin: true });
      return;
    }
    void this.pickPhoto();
  },

  /** 授权登录成功：收起弹层，继续刚才被拦截的上传 */
  onLoginSuccess(_e: { detail: WxUser }): void {
    this.setData({ showLogin: false });
    void this.pickPhoto();
  },

  onCloseLogin(): void {
    this.setData({ showLogin: false });
  },

  async pickPhoto(): Promise<void> {
    try {
      const picked = await chooseImage();
      if (!picked) return;
      if (!this.alive) return;
      if (picked.size > this.data.maxSizeMB * 1024 * 1024) {
        wx.showToast({ title: `照片超过 ${this.data.maxSizeMB}MB，换一张试试`, icon: 'none' });
        return;
      }
      // 选图成功才推进到第二步；取消则留在原地，不让界面闪一下
      this.setData({
        photoPath: picked.path,
        photoMeta: `${picked.width} × ${picked.height}`,
      });
      this.goStep('style');
    } catch {
      // 用户在系统级选择器里点了取消，无需提示
    }
  },

  onPreviewPhoto(): void {
    const { photoPath } = this.data;
    if (!photoPath) return;
    wx.previewImage({ urls: [photoPath] });
  },

  /* ================= 第二步：选风格 ================= */

  onSelectStyle(e: { detail: { id: string } }): void {
    const id = e.detail.id;
    if (!id || id === this.data.styleId) return;
    this.syncSelection(id);
  },

  onStrengthChanging(e: { detail: { value: number } }): void {
    this.setData({ strength: e.detail.value });
  },

  onStrengthChange(e: { detail: { value: number } }): void {
    this.setData({ strength: e.detail.value });
  },

  /* ================= 生成 ================= */

  onSubmit(): void {
    void this.submit();
  },

  async submit(): Promise<void> {
    const { photoPath, strength, styleId } = this.data;
    if (!photoPath) {
      wx.showToast({ title: '先上传一张照片吧', icon: 'none' });
      return;
    }
    if (this.data.submitting) return;

    // 付费墙（占位拦截）：真实配额来自后端，这里读本地占位值。
    // 文件上传与配额 / 支付 API 对接暂作预留 —— 硬拦截在真实配额接口就绪后启用。
    if (getQuota() <= 0) {
      this.setData({ showPay: true });
      return;
    }

    this.setData({
      submitting: true,
      progress: 0,
      indeterminate: false,
      phaseText: '正在上传原图',
      phaseHint: '照片越大上传越慢，稍等一下',
    });
    // 生成中是整屏遮罩，底部菜单同样压不住（tabBar 在独立渲染层）
    setTabBarHidden(true);

    try {
      const { taskId } = await createTask(
        { filePath: photoPath, styleId, strength },
        (percent) => {
          if (this.alive) this.setData({ progress: percent });
        },
      );

      this.setData({
        indeterminate: true,
        progress: 0,
        phaseText: '正在绘制你的专属风格',
        phaseHint: '出图通常需要 10-30 秒，可以去喝口水',
      });
      this.startFakeProgress();

      const detail = await waitTask(taskId);
      this.stopFakeProgress();

      if (detail.status === 'FAILED' || !detail.resultUrl) {
        throw new Error(detail.errorMessage || '生成失败，换一张照片再试试');
      }
      if (!this.alive) return;

      this.setData({
        resultUrl: detail.resultUrl,
        costText: detail.costMs ? formatCost(detail.costMs) : '',
      });
      // 生成成功扣减一次（仅占位，真实扣减以后端为准）
      consumeQuota();
      this.goStep('result');
      // 等一拍再淡入：直接置 true 会让图片在解码前就开始过渡，看到的是白底
      setTimeout(() => {
        if (this.alive) this.setData({ revealed: true });
      }, 60);
    } catch (err) {
      if (!this.alive) return;
      // 失败时停在第二步：用户换张图或换个风格就能重试，不用从头再来
      wx.showModal({ title: '生成失败', content: toFriendlyMessage(err), showCancel: false });
    } finally {
      this.stopFakeProgress();
      if (this.alive) {
        this.setData({
          submitting: false,
          progress: 0,
          indeterminate: false,
          phaseText: '',
          phaseHint: '',
        });
      }
      setTabBarHidden(false);
    }
  },

  /**
   * 伪进度条。
   * 后端拿不到厂商的真实百分比，干等不动用户会以为卡死；
   * 让进度缓慢爬到 90 停住、成功瞬间跳满，语义上不会撒谎。
   */
  startFakeProgress(): void {
    this.stopFakeProgress();
    let value = 0;
    this.timer = setInterval(() => {
      value = Math.min(90, value + (value < 60 ? 4 : 1));
      if (this.alive) this.setData({ progress: value });
    }, 700);
  },

  stopFakeProgress(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  },

  /* ================= 第三步：结果 ================= */

  onShowOriginal(): void {
    this.setData({ showOriginal: true });
  },

  onHideOriginal(): void {
    if (this.data.showOriginal) this.setData({ showOriginal: false });
  },

  onSave(): void {
    void this.save();
  },

  async save(): Promise<void> {
    const { resultUrl, saving } = this.data;
    if (!resultUrl || saving) return;
    this.setData({ saving: true });
    try {
      await saveToAlbum(resultUrl);
      if (this.alive) wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (err) {
      if (this.alive) wx.showToast({ title: toFriendlyMessage(err, '保存失败'), icon: 'none' });
    } finally {
      if (this.alive) this.setData({ saving: false });
    }
  },

  /**
   * 「换个画风」：退到第二步，照片留着。
   *
   * 这是最常用的重试路径 —— 照片通常没问题，用户只是对画风不满意，
   * 让他重新上传等于白折腾一遍。
   */
  onBackToStyle(): void {
    this.goStep('style');
  },

  /** 「换张照片」：彻底重开，清空照片与结果，保留已选画风 */
  onReset(): void {
    this.stopFakeProgress();
    this.setData({
      photoPath: '',
      photoMeta: '',
      resultUrl: '',
      costText: '',
      revealed: false,
      showOriginal: false,
      progress: 0,
      indeterminate: false,
    });
    this.goStep('upload');
  },

  /* ================= 付费墙（占位） ================= */

  onClosePay(): void {
    this.setData({ showPay: false });
  },

  onBuyPay(e: { detail: { count: number } }): void {
    // TODO: 微信支付 API 对接暂作预留；此处模拟购买并本地授予次数。
    const count = e.detail?.count ?? 0;
    setQuota(getQuota() + count);
    this.setData({ showPay: false });
    wx.showToast({ title: '购买成功（模拟）', icon: 'success' });
  },
});