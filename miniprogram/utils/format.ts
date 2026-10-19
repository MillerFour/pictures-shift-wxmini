/**
 * 展示格式化工具：耗时与时间的统一文案。
 * index（结果页耗时）与 history（列表时间/耗时）共用，避免两份近似的实现漂移。
 */

/** 耗时展示：1000ms 以内按毫秒，否则按秒保留一位小数 */
export function formatCost(ms: number): string {
  return ms < 1000 ? `${ms} 毫秒` : `${(ms / 1000).toFixed(1)} 秒`;
}

/** 创作时间展示：同年省略年份，跨年补全 */
export function formatTime(ts: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  const now = new Date();
  const md = `${d.getMonth() + 1}月${d.getDate()}日 ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return d.getFullYear() === now.getFullYear() ? md : `${d.getFullYear()}年${md}`;
}
