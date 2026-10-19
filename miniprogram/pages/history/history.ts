import { fetchTasks } from '../../services/api';
import { resolveTempUrls } from '../../utils/cloud';
import { saveToAlbum } from '../../utils/image';
import { toFriendlyMessage } from '../../utils/error';
import { formatCost, formatTime } from '../../utils/format';
import type { TaskRecord } from '../../types';

/**
 * 历史创作：生图成功后由服务端落库（tasks 集合），这里分页读取。
 *
 * 直链策略：结果图存的是云存储 fileID（永久有效），列表渲染前按页批量
 * getTempFileURL 换临时直链 —— 单条逐个换在几十条列表下开销太大。
 * 点图片看大图（previewImage），「保存」把当前直链下载写入相册。
 */

const PAGE_SIZE = 20;

interface HistoryItem {
  id: string;
  styleName: string;
  modelName: string;
  timeText: string;
  costText: string;
  /** 临时直链；换取失败为空串，渲染走占位底色 */
  url: string;
  saving: boolean;
}

Page({
  data: {
    items: [] as HistoryItem[],
    loading: false,
    hasMore: true,
  },

  /** 分页请求是异步的，页面可能中途退出；卸载后 setData 会抛错，异步回调先判断 */
  alive: true,

  /** 游标：已加载条数，作为下一页 skip */
  skip: 0,
  loadingMore: false,

  onLoad() {
    this.alive = true;
    void this.reload();
  },

  onUnload() {
    this.alive = false;
  },

  onPullDownRefresh() {
    this.reload().finally(() => wx.stopPullDownRefresh());
  },

  onReachBottom() {
    if (this.data.hasMore && !this.loadingMore) void this.loadMore();
  },

  /** 下拉刷新：回到第一页 */
  async reload(): Promise<void> {
    this.setData({ loading: true });
    try {
      const list = await fetchTasks(PAGE_SIZE, 0);
      if (!this.alive) return;
      const items = await this.decorate(list);
      if (!this.alive) return;
      this.skip = list.length;
      this.setData({ items, hasMore: list.length >= PAGE_SIZE, loading: false });
    } catch (err) {
      if (this.alive) {
        this.setData({ loading: false });
        wx.showToast({ title: toFriendlyMessage(err, '加载失败'), icon: 'none' });
      }
    }
  },

  async loadMore(): Promise<void> {
    if (this.loadingMore) return;
    this.loadingMore = true;
    try {
      const list = await fetchTasks(PAGE_SIZE, this.skip);
      if (!this.alive) return;
      const decorated = await this.decorate(list);
      if (!this.alive) return;
      this.skip += list.length;
      this.setData({
        items: this.data.items.concat(decorated),
        hasMore: list.length >= PAGE_SIZE,
      });
    } catch (err) {
      if (this.alive) wx.showToast({ title: toFriendlyMessage(err, '加载失败'), icon: 'none' });
    } finally {
      this.loadingMore = false;
    }
  },

  /** 组装展示数据：批量换直链 + 时间/耗时格式化 */
  async decorate(list: TaskRecord[]): Promise<HistoryItem[]> {
    if (!list.length) return [];
    const urls = await resolveTempUrls(list.map((c) => c.resultFileID));
    return list.map((c) => ({
      id: c.id,
      styleName: c.styleName || '风格化',
      modelName: c.modelName || '默认模型',
      timeText: formatTime(c.createdAt),
      costText: formatCost(c.costMs),
      url: urls[c.resultFileID] || '',
      saving: false,
    }));
  },

  /** 点缩略图看大图 */
  onPreview(e: { currentTarget: { dataset: { url?: string } } }): void {
    const url = e.currentTarget.dataset.url;
    if (url) wx.previewImage({ urls: [url] });
  },

  /** 保存结果图到相册 */
  async onSave(e: { currentTarget: { dataset: { index?: number } } }): Promise<void> {
    const index = e.currentTarget.dataset.index;
    if (index === undefined) return;
    const item = this.data.items[index];
    if (!item || !item.url || item.saving) return;

    this.setData({ [`items[${index}].saving`]: true });
    try {
      await saveToAlbum(item.url);
      wx.showToast({ title: '已保存到相册', icon: 'success' });
    } catch (err) {
      wx.showToast({ title: toFriendlyMessage(err, '保存失败'), icon: 'none' });
    } finally {
      this.setData({ [`items[${index}].saving`]: false });
    }
  },
});
