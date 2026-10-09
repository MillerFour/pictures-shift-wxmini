import { randomUUID } from 'node:crypto';
import type { TaskStatus } from './types.js';

export interface SourceImage {
  bytes: Buffer;
  contentType: string;
}

export interface TaskRecord {
  taskId: string;
  status: TaskStatus;
  styleId: string;
  /** 厂商侧任务 id，用于跨请求续轮询 */
  vendorTaskId?: string;
  /** 原图字节：供 mock / 支持 base64 直传的厂商使用 */
  source: SourceImage;
  /**
   * 结果图字节。
   *
   * 放内存而不是把厂商 URL 直接转发给小程序，有两个原因：
   * 1. 厂商返回的图 URL 普遍 24 小时就过期，转发出去用户第二天看到的是裂图；
   * 2. 小程序只需要一个自有域名下的稳定地址，不必把厂商域名加进合法域名白名单。
   * 代价是占用内存，所以由 TTL 清理兜底。
   */
  result?: SourceImage;
  errorMessage?: string;
  createdAt: number;
  finishedAt?: number;
}

/**
 * 内存任务表。
 *
 * 「不落库」是产品刻意选择，所以这里没有数据库，也没有分布式锁。
 * 代价是单实例、重启丢任务 —— 对「十几秒出一张图」的短任务可接受，
 * 上量后应换成 Redis。
 */
export class TaskStore {
  private readonly tasks = new Map<string, TaskRecord>();

  create(styleId: string, source: SourceImage): TaskRecord {
    const record: TaskRecord = {
      taskId: randomUUID(),
      status: 'PENDING',
      styleId,
      source,
      createdAt: Date.now(),
    };
    this.tasks.set(record.taskId, record);
    return record;
  }

  get(taskId: string): TaskRecord | undefined {
    return this.tasks.get(taskId);
  }

  patch(taskId: string, patch: Partial<TaskRecord>): TaskRecord | undefined {
    const current = this.tasks.get(taskId);
    if (!current) return undefined;
    Object.assign(current, patch);
    return current;
  }

  /** 抹掉过期任务，返回清理条数 */
  sweep(ttlMs: number, now = Date.now()): number {
    let removed = 0;
    for (const [id, task] of this.tasks) {
      const terminal = task.status === 'SUCCEEDED' || task.status === 'FAILED';
      // 未结束的任务给 2 倍宽限，避免出图高峰期被误删导致小程序永远轮询不到结果
      const budget = terminal ? ttlMs : ttlMs * 2;
      if (now - task.createdAt > budget) {
        this.tasks.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  get size(): number {
    return this.tasks.size;
  }
}