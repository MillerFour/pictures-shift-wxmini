import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { randomUUID } from 'node:crypto';

import { config } from './config.js';
import { findStyle, listStyleMeta } from './catalog.js';
import { ErrorCode, fail, ok } from './envelope.js';
import { TaskStore } from './task-store.js';
import { createProvider } from './providers/index.js';
import { ProviderError, type ConvertInput, type PollResult } from './providers/types.js';
import type { RuntimeConfig, TaskDetail } from './types.js';

type AppEnv = { Variables: { requestId: string } };

const provider = createProvider();
const store = new TaskStore();
const app = new Hono<AppEnv>();

/** 每个请求一个短追踪号，出问题时用户截图里能看到它 */
app.use('*', async (c, next) => {
  c.set('requestId', randomUUID().slice(0, 8));
  await next();
});

/**
 * 凭魔数判断图片类型。
 *
 * 不能信 photo.type —— 它来自客户端，攻击者可以随便填。
 * 厂商拿到非图片字节会返回一堆看不懂的错误，这里提前拦掉。
 */
function detectImageType(bytes: Buffer): string | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(png)) return 'image/png';
  if (
    bytes.length >= 12 &&
    bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
    bytes.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp';
  }
  return null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 后台执行一次转换。
 *
 * 不 await 是刻意的：HTTP 请求只负责收图并立刻回执，
 * 出图是分钟级操作，挂在请求上会让小程序上传超时。
 */
async function runConversion(input: ConvertInput): Promise<void> {
  const { taskId } = input;
  store.patch(taskId, { status: 'RUNNING' });

  try {
    let state: PollResult = await provider.submit(input);
    const deadline = Date.now() + config.vendorPollTimeoutMs;

    while (state.state !== 'SUCCEEDED' && state.state !== 'FAILED') {
      const vendorTaskId = state.vendorTaskId;
      if (!vendorTaskId) throw new ProviderError(provider.name, '厂商既没返回图片，也没返回任务 id');
      store.patch(taskId, { vendorTaskId });
      if (Date.now() > deadline) throw new ProviderError(provider.name, '厂商出图超时');
      await sleep(config.vendorPollIntervalMs);
      state = await provider.poll(vendorTaskId);
    }

    if (state.state === 'FAILED') {
      store.patch(taskId, {
        status: 'FAILED',
        errorMessage: state.message,
        finishedAt: Date.now(),
      });
      return;
    }
    store.patch(taskId, { status: 'SUCCEEDED', result: state.image, finishedAt: Date.now() });
  } catch (err) {
    console.error(`[convert:${taskId}] 失败`, err);
    store.patch(taskId, {
      status: 'FAILED',
      errorMessage: err instanceof Error ? err.message : '未知错误',
      finishedAt: Date.now(),
    });
  }
}
/* ============================ 读接口 ============================ */

app.get('/healthz', (c) =>
  c.json({ ok: true, provider: provider.name, tasks: store.size }),
);

app.get('/api/config', (c) => {
  const payload: RuntimeConfig = {
    maxFileSizeMB: config.maxFileSizeMB,
    recommendedLongEdge: config.recommendedLongEdge,
    ...(config.notice ? { notice: config.notice } : {}),
  };
  return c.json(ok(payload, c.get('requestId')));
});

app.get('/api/styles', (c) => c.json(ok(listStyleMeta(), c.get('requestId'))));

app.get('/api/tasks/:taskId', (c) => {
  const requestId = c.get('requestId');
  const task = store.get(c.req.param('taskId'));
  if (!task) return c.json(fail(ErrorCode.TASK_NOT_FOUND, '任务不存在或已过期', requestId));

  const detail: TaskDetail = {
    taskId: task.taskId,
    status: task.status,
    ...(task.status === 'SUCCEEDED' && task.result
      ? { resultUrl: `/api/files/result/${task.taskId}` }
      : {}),
    ...(task.status === 'FAILED' ? { errorMessage: task.errorMessage ?? '生成失败' } : {}),
    ...(task.finishedAt ? { costMs: task.finishedAt - task.createdAt } : {}),
  };
  return c.json(ok(detail, requestId));
});

/* ============================ 写接口 ============================ */

app.post('/api/convert', async (c) => {
  const requestId = c.get('requestId');
  const maxBytes = config.maxFileSizeMB * 1024 * 1024;

  // 先看 Content-Length，能在解析前就拒掉超大请求，
  // 否则 multipart 会被完整读进内存，白白吃一次内存峰值
  const declared = Number(c.req.header('content-length') ?? 0);
  if (declared > maxBytes + 64 * 1024) {
    return c.json(fail(ErrorCode.PAYLOAD_TOO_LARGE, `照片不能超过 ${config.maxFileSizeMB}MB`, requestId));
  }

  let form: Record<string, string | File>;
  try {
    form = await c.req.parseBody();
  } catch {
    return c.json(fail(ErrorCode.BAD_REQUEST, '请求格式错误，应为 multipart/form-data', requestId));
  }

  const photo = form.photo;
  const styleId = String(form.styleId ?? '');
  const rawStrength = Number(form.strength ?? 60);

  if (!(photo instanceof File)) {
    return c.json(fail(ErrorCode.BAD_REQUEST, '缺少名为 photo 的文件字段', requestId));
  }
  if (photo.size === 0) {
    return c.json(fail(ErrorCode.BAD_REQUEST, '照片内容为空', requestId));
  }
  if (photo.size > maxBytes) {
    return c.json(fail(ErrorCode.PAYLOAD_TOO_LARGE, `照片不能超过 ${config.maxFileSizeMB}MB`, requestId));
  }

  const style = findStyle(styleId);
  if (!style) return c.json(fail(ErrorCode.STYLE_NOT_FOUND, `风格 ${styleId} 不存在`, requestId));

  const bytes = Buffer.from(await photo.arrayBuffer());
  const contentType = detectImageType(bytes);
  if (!contentType) {
    return c.json(fail(ErrorCode.UNSUPPORTED_MEDIA, '只支持 JPG / PNG / WebP 图片', requestId));
  }

  const task = store.create(style.id, { bytes, contentType });

  const origin = config.publicBaseUrl || new URL(c.req.url).origin;
  const input: ConvertInput = {
    taskId: task.taskId,
    style,
    strength: Number.isFinite(rawStrength) ? Math.min(100, Math.max(0, rawStrength)) : 60,
    source: { bytes, contentType },
    publicSourceUrl: `${origin}/api/files/source/${task.taskId}`,
  };
  void runConversion(input);

  return c.json(ok({ taskId: task.taskId, status: task.status }, requestId), 202);
});

/* ============================ 图片回源 ============================ */

/** 结果图。小程序 <image> 和 wx.downloadFile 都走这里 */
app.get('/api/files/result/:taskId', (c) => {
  const task = store.get(c.req.param('taskId'));
  if (!task?.result) return c.notFound();
  return c.body(new Uint8Array(task.result.bytes), 200, {
    'Content-Type': task.result.contentType,
    'Cache-Control': 'private, max-age=3600',
  });
});

/**
 * 原图回源。
 *
 * 存在的唯一理由：百炼这类「只能用公网 URL 取图」的厂商需要一个能被外网访问的地址。
 * 短期暴露原图有隐私风险，所以 TTL 较短，且绝不能把域名直接公开给用户。
 */
app.get('/api/files/source/:taskId', (c) => {
  const task = store.get(c.req.param('taskId'));
  if (!task) return c.notFound();
  return c.body(new Uint8Array(task.source.bytes), 200, {
    'Content-Type': task.source.contentType,
    'Cache-Control': 'public, max-age=600',
  });
});

/* ============================ 兜底 ============================ */

app.notFound((c) => c.json(fail(ErrorCode.BAD_REQUEST, '接口不存在', c.get('requestId')), 404));

app.onError((err, c) => {
  console.error(`[http] ${c.get('requestId')} 未捕获异常`, err);
  return c.json(fail(ErrorCode.INTERNAL, '服务内部错误', c.get('requestId')), 500);
});

/* ============================ 启动 ============================ */

// unref: 不让这个定时器吊住进程，测试里 import 本模块也能正常退出
setInterval(() => {
  const removed = store.sweep(config.taskTtlMs);
  if (removed > 0) console.log(`[sweep] 清理 ${removed} 个过期任务，当前存量 ${store.size}`);
}, config.sweepIntervalMs).unref();

serve({ fetch: app.fetch, port: config.port }, (info) => {
  console.log(`[bff] 已启动  引擎=${provider.name}  端口=${info.port}`);
  if (provider.name === 'mock') {
    console.warn('[bff] 当前为 mock 引擎：不做真实风格化，结果图与原图一致。');
    console.warn('[bff] 接入真引擎请在 server/.env 里配置 STYLE_PROVIDER 与对应密钥。');
  }
});