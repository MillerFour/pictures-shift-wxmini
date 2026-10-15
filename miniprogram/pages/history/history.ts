import { fetchCreations } from '../../services/api';
import { resolveTempUrls } from '../../utils/cloud';
import { saveToAlbum } from '../../utils/image';
import { toFriendlyMessage } from '../../utils/error';
import type { Creation } from '../../types';

/**
 * 历史创作：生图成功后由服务端落库（creations 集合），这里分页读取。
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

function formatTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const md = `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return sameYear ? md : `${d.getFullYear()}年${md}`;
}

function formatCost(ms: number): string {
  if (!ms) return '';
  return ms < 1000 ? `${ms} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`;
}

Page({
  data: {
    items: [] as HistoryItem[],
    loading: false,
    hasMore: true,
  },

  /** 游标：已加载条数，作为下一页 skip */
  skip: 0,
  loadingMore: false,

  onLoad() {
    void this.reload();
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
      const list = await fetchCreations(PAGE_SIZE, 0);
      const items = await this.decorate(list);
      this.skip = list.length;
      this.setData({ items, hasMore: list.length >= PAGE_SIZE, loading: false });
    } catch (err) {
      this.setData({ loading: false });
      wx.showToast({ title: toFriendlyMessage(err, '加载失败'), icon: 'none' });
    }
  },

  async loadMore(): Promise<void> {
    if (this.loadingMore) return;
    this.loadingMore = true;
    try {
      const list = await fetchCreations(PAGE_SIZE, this.skip);
      const decorated = await this.decorate(list);
      this.skip += list.length;
      this.setData({
        items: this.data.items.concat(decorated),
        hasMore: list.length >= PAGE_SIZE,
      });
    } catch (err) {
      wx.showToast({ title: toFriendlyMessage(err, '加载失败'), icon: 'none' });
    } finally {
      this.loadingMore = false;
    }
  },

  /** 组装展示数据：批量换直链 + 时间/耗时格式化 */
  async decorate(list: Creation[]): Promise<HistoryItem[]> {
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
