import { getUser, saveUser, type WxUser } from '../../utils/auth';
import { setTabBarHidden } from '../../utils/tabbar';
import { checkUser, login } from '../../services/auth';
import { uploadAvatar } from '../../utils/cloud';

/**
 * 授权登录弹层，首页上传拦截与「我的」手动登录共用。
 *
 * 授权三要素：
 * - wx_openid：wx.login 拿 code 交后端换，无需用户额外操作；
 * - 头像：button open-type="chooseAvatar" 由用户显式选择；
 * - 昵称：input type="nickname" 调起微信昵称选择。
 * 三者齐备才允许确认，确认后回写本地会话并向上抛 login 事件。
 */
Component({
  options: { addGlobalClass: true },

  properties: {
    show: { type: Boolean, value: false },
  },

  /**
   * 半屏必须盖住底部菜单，但 tabBar 在独立渲染层、遮罩压不住它，
   * 所以弹层开合时让 tabBar 跟着显隐（见 utils/tabbar）。
   */
  observers: {
    async show(val: boolean) {
      setTabBarHidden(val);
      if (!val) return;
      // 打开即先用 openid 查云端是否已注册：
      // 已注册 -> 直接回写本地会话并登录成功，不再弹授权表单；
      // 未注册 / 查库失败 -> 显示表单，引导用户授权头像昵称建档。
      this.setData({ checking: true });
      try {
        const res = await checkUser();
        if (res.exists && res.user) {
          saveUser(res.user);
          this.triggerEvent('login', res.user);
          this.triggerEvent('close');
          return;
        }
      } catch {
        // 查库异常降级：本地已有完整会话则直接恢复登录（不弹表单，避免重复上传头像）；
        // 真正未注册的用户才显示授权表单
        const local = getUser();
        if (local && local.openid && local.avatarFileID) {
          saveUser(local);
          this.triggerEvent('login', local);
          this.triggerEvent('close');
          return;
        }
      } finally {
        this.setData({ checking: false });
      }
    },
  },

  lifetimes: {
    detached() {
      // 卸载兜底：弹层开着时切走页面，避免 tabBar 停留在隐藏态
      setTabBarHidden(false);
    },
  },

  data: {
    avatarUrl: '',
    nickname: '',
    /** 隐私协议必须显式勾选，符合微信小程序用户信息收集规范 */
    agreed: false,
    loading: false,
    /** 打开时先用 openid 查云端注册状态的加载态 */
    checking: false,
  },

  methods: {
    /** chooseAvatar 给的是临时文件路径，真实环境应上传后换成 CDN 地址 */
    onChooseAvatar(e: { detail: { avatarUrl?: string } }) {
      const url = e.detail?.avatarUrl;
      if (url) this.setData({ avatarUrl: url });
    },

    onNicknameInput(e: { detail: { value?: string } }) {
      this.setData({ nickname: (e.detail?.value ?? '').trim() });
    },

    onToggleAgree() {
      this.setData({ agreed: !this.data.agreed });
    },

    /** 隐私保护指引：真实项目应替换为正式页面或链接 */
    onOpenPrivacy() {
      wx.showModal({
        title: '用户隐私保护指引',
        content: '我们仅收集微信 openid、头像与昵称用于账户识别与展示；不会将你的信息用于本服务以外的用途，处理完成后服务端不保留原始照片。',
        showCancel: false,
      });
    },

    /** 免责协议：复用已有免责声明，或替换为正式协议页面 */
    onOpenTerms() {
      wx.showModal({
        title: '用户免责协议',
        content: '本服务为 AI 风格化演示工具，生成结果仅供参考；用户需确保上传照片不侵犯他人权益，详见「我的-免责声明」。',
        showCancel: false,
      });
    },

    onClose() {
      this.reset();
      this.triggerEvent('close');
    },

    async onConfirm() {
      if (this.data.loading) return;
      if (!this.data.avatarUrl || !this.data.nickname) {
        wx.showToast({ title: '请先授权头像并填写昵称', icon: 'none' });
        return;
      }
      if (!this.data.agreed) {
        wx.showToast({ title: '请先阅读并同意协议', icon: 'none' });
        return;
      }
      this.setData({ loading: true });
      try {
        // 确认前复检云端档案：表单可能是 checkUser 网络失败降级出现的，档案其实已存在 ——
        // 直接恢复登录，绝不再上传一份头像（防云存储堆积同一个人的重复头像）
        const recheck = await checkUser();
        if (recheck.exists && recheck.user) {
          saveUser(recheck.user);
          this.triggerEvent('login', recheck.user);
          this.reset();
          return;
        }
        // 微信给的头像是临时路径，先上传云存储换 fileID 再存库，避免失效
        const avatarFileID = await uploadAvatar(this.data.avatarUrl);
        const { openid } = await login({
          nickname: this.data.nickname,
          avatarFileID,
        });
        const user: WxUser = {
          openid,
          nickname: this.data.nickname,
          avatarFileID,
        };
        saveUser(user);
        this.triggerEvent('login', user);
        this.reset();
      } catch (err) {
        wx.showToast({ title: (err as Error)?.message || '授权失败，请重试', icon: 'none' });
      } finally {
        this.setData({ loading: false });
      }
    },

    noop() {},

    reset() {
      this.setData({ avatarUrl: '', nickname: '', agreed: false });
    },
  },
});
