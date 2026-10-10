import { STORAGE_KEYS } from '../constants/keys';

/**
 * 剩余次数（配额）本地占位实现。
 *
 * 真实配额由后端「我的」接口返回，这里先用本地 storage 模拟，
 * 以便前端在后端 / 支付接口就绪前就能把付费墙流程跑通。
 * —— 文件上传与配额 / 支付 API 对接均暂作预留。
 */

/** 新用户赠送的免费次数 */
const DEFAULT_QUOTA = 1;

export function getQuota(): number {
  try {
    const v = wx.getStorageSync(STORAGE_KEYS.quota);
    return typeof v === 'number' && v >= 0 ? v : DEFAULT_QUOTA;
  } catch {
    return DEFAULT_QUOTA;
  }
}

export function setQuota(n: number): void {
  try {
    wx.setStorageSync(STORAGE_KEYS.quota, Math.max(0, Math.floor(n)));
  } catch {
    /* 忽略：仅本地占位 */
  }
}

/** 生成成功后扣减一次（仅占位，真实扣减以后端为准） */
export function consumeQuota(): void {
  setQuota(getQuota() - 1);
}
