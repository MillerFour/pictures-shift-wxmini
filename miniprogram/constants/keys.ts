/** 本地存储 key 集中管理，避免各处硬编码字符串拼错 */
export const STORAGE_KEYS = {
  /** 风格列表缓存 */
  styles: 'ps:cache:styles',
  /** 运行期配置缓存 */
  runtimeConfig: 'ps:cache:runtime-config',
  /** 剩余次数（本地占位，真实值来自后端） */
  quota: 'ps:cache:quota',
} as const;