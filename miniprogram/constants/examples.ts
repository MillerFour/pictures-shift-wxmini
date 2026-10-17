/**
 * 云端示例素材的 fileID（云存储根目录 example/ 文件夹）。
 *
 * 路径直接写死、不走配置：示例素材极少变动，替换素材时在控制台
 * 覆盖上传同名文件（路径不变 → fileID 不变），代码无需任何改动。
 *
 * fileID 格式：cloud://<环境ID>.<存储桶>/<路径>（注意环境与桶之间是「.」）。
 * 换云环境时才需要改 FILE_ID_HOST —— 从控制台任一文件详情的 fileID 里
 * 复制 cloud://xxx.yyy 整段替换。
 */

/** fileID 前缀：cloud://<环境ID>.<存储桶> */
const FILE_ID_HOST =
  'cloud://piture-shift-d9gy1p5tnf310cf3f.7069-piture-shift-d9gy1p5tnf310cf3f-1505601365';

/** 全风格共用的示例原图（example/original.jpg，各画风效果图都由它生成） */
export const EXAMPLE_ORIGINAL_FILE_ID = `${FILE_ID_HOST}/example/original.jpg`;

/** 各画风效果图：example/{key}.jpg，键 = styles._id；新增画风要配示例图时在此补一条 */
export const EXAMPLE_AFTER_FILE_IDS: Record<string, string> = {
  ghibli: `${FILE_ID_HOST}/example/ghibli.jpg`,
  anime: `${FILE_ID_HOST}/example/anime.jpg`,
  pixar: `${FILE_ID_HOST}/example/pixar.jpg`,
  film: `${FILE_ID_HOST}/example/film.jpg`,
};

/** 全部示例素材 fileID（共用原图 + 各画风效果图）：进入首页时一次性预热到本地 */
export const ALL_EXAMPLE_FILE_IDS: string[] = [
  EXAMPLE_ORIGINAL_FILE_ID,
  ...Object.values(EXAMPLE_AFTER_FILE_IDS),
];
