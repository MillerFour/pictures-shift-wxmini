import { warmup } from './services/api'

App({
  onLaunch() {
    // 启动即预热风格列表与运行期配置。
    // 放在 onLaunch 而不是首页 onLoad：首页要立刻渲染出风格卡片，
    // 网络往返不能挡在首屏前面，页面自己读缓存即可。
    void warmup();
  },
});