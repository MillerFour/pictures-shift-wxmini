/**
 * 生成首屏示例素材：同一张原图 × 各画风的成片。
 *
 * 走的是正式链路（catalog 的 prompt + volcengine 引擎），保证示例图和用户
 * 实际生成出来的效果一致；新增画风后跑一遍就能把素材补齐：
 *
 *   npm --prefix server run examples          # 只补 assets 里缺的
 *   npm --prefix server run examples -- --force # 全部重出
 *
 * 注意：花的是真实厂商额度，一张图几十秒。
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { STYLES } from '../src/catalog.js';
import { config } from '../src/config.js';
import { createVolcengineProvider } from '../src/providers/volcengine.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const assetsDir = resolve(root, 'miniprogram', 'assets');
const sourcePath = resolve(assetsDir, 'example-panda.jpg');

/** 示例统一用滑块默认强度 60 出图，和用户进第二步看到的默认值一致 */
const STRENGTH = 60;
const force = process.argv.includes('--force');

async function main(): Promise<void> {
  if (!config.volcengine.apiKey) throw new Error('缺少 VOLCENGINE_API_KEY（server/.env）');

  const source = { bytes: readFileSync(sourcePath), contentType: 'image/jpeg' };
  const provider = createVolcengineProvider(config.volcengine);

  for (const style of STYLES) {
    // 厂商返回的是 JPEG 字节，扩展名如实用 .jpg；打包前已另行压到 900px 宽，
    // 这里不压：脚本产物是素材源，质量优先，体积由发布流程管
    const target = resolve(assetsDir, `example-panda-${style.id}.jpg`);
    if (!force && existsSync(target)) {
      console.log(`跳过 ${style.id}（已存在，--force 可重出）`);
      continue;
    }

    const started = Date.now();
    let result = await provider.submit({
      taskId: `example-${style.id}`,
      style,
      strength: STRENGTH,
      source,
      publicSourceUrl: '',
    });

    // 方舟目前同步返回 b64；万一改成异步任务 id，这里按同一套 poll 兜底
    const deadline = Date.now() + config.vendorPollTimeoutMs;
    while (result.state === 'RUNNING' || result.state === 'PENDING') {
      if (Date.now() > deadline) throw new Error(`${style.id} 轮询超时`);
      await new Promise((r) => setTimeout(r, config.vendorPollIntervalMs));
      result = await provider.poll(result.vendorTaskId ?? '');
    }

    if (result.state === 'FAILED') throw new Error(`${style.id} 生成失败：${result.message}`);
    writeFileSync(target, result.image.bytes);
    console.log(
      `${style.id} -> ${target}（${Math.round((Date.now() - started) / 1000)}s，${result.image.bytes.length} bytes）`,
    );
  }
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
