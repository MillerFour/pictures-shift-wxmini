# 云环境配置手册（清空重建版）

> 适用场景：云开发环境清空（云存储 + 云数据库全部删除）后，从零手动重建并验证工程标准化。
> 代码侧前置：`cloudfunctions/` 下 7 个云函数目录、`miniprogram/` 前端已按当前设计实现。
>
> 当前设计要点：
> - **画风真源** = 云数据库 `styles` 集合（控制台改文档即上架/下架/调参，无需发版）
> - **模型真源** = 云数据库 `models` 集合（控制台改文档即上线/下线生图模型，无需发版）
> - **任务档案** = 云存储 `task/{openid}/` 目录（原图与成图按时间戳配对）+ `tasks` 集合
> - **免费次数** = `users.quota`（注册赠送 / 活动派发共用余额池，`free-quota` 函数发放）

---

## 1. 架构总览

### 1.1 云函数（7 个）

| 函数 | 职责 | 接口（action） | 关键环境变量 |
|---|---|---|---|
| `wx-identity` | 微信登录身份（项目无关复用件） | `login` / `getUserInfo` | `USERS_COLLECTION`（可选） |
| `app-config` | 应用配置：画风目录 + 运行参数 | `styles` / `config` | `MAX_FILE_SIZE_MB` / `RECOMMENDED_LONG_EDGE` / `NOTICE` |
| `free-quota` | 免费次数发放与查询 | `getFreeQuota` | `FREE_QUOTA` |
| `pay` | 交易域：订单状态机 + 定时兜底 | `payPackages` / `createOrder` / `queryOrder` / `listOrders` | `XPAY_OFFER_ID` / `XPAY_APP_KEY` / `WX_APPID` / `WX_APPSECRET` / `NEED_PAY` 等 |
| `records` | 用户内容记录 | `savePhoto` / `listPhotos` / `listTasks` | 无 |
| `generate-image` | 同步生图（服务端扣次数）+ 模型目录下发 | `generate` / `models` | `STYLE_PROVIDER` / 厂商密钥 / `FREE_QUOTA` |
| `xpayNotify` | 虚拟支付发货推送回调（HTTP 接入） | 平台推送事件 | `XPAY_APP_KEY` / `XPAY_NOTIFY_PATH` |

> 完整变量清单、默认值与联调建议见 §2「环境变量」表。

### 1.2 数据库集合（7 个）

| 集合 | 写入方 | 用途 | 初始化方式 |
|---|---|---|---|
| `styles` | app-config（播种）/ 控制台 | 画风真源 | **手动导入**（见 §3.1–3.3） |
| `models` | generate-image（播种）/ 控制台 | 生图模型真源 | **手动导入**（见 §3.4） |
| `users` | wx-identity / free-quota / pay | 用户档案 + 次数余额 | 自动 |
| `tasks` | generate-image | 任务档案（原/成图溯源） | 自动 |
| `userPhotos` | records | 照片素材记录 | 自动 |
| `orders` | pay | 订单状态机 | 自动 |
| `tokens` | pay（xpay.js） | 平台 stable_token 缓存 | 自动 |

### 1.3 云存储目录

```
云存储根
├── example/                         ← 手动：示例素材（§4.2），与业务目录分离
│   ├── original.jpg                 ← 共用示例原图（全风格同一张）
│   └── {key}.jpg                    ← 画风效果图：以画风 key 命名，每画风一张
└── task/                            ← 任务归档（§4.3 命名规则）
    └── {openid}/                    ← 每个用户一个文件夹：登录成功后即时创建
        ├── .keep                    ← 登录成功即上传的占位文件（0 字节）
        ├── {stamp}_original.jpg     ← 任务原图
        └── {stamp}_result.png       ← 任务成片（同 stamp 配对）
```

---

## 2. 第一步：部署云函数

清空环境后，在微信开发者工具左侧 `cloudfunctions` 目录下，**逐个右键 → 上传并部署：云端安装依赖（不上传 node_modules）**：

```
wx-identity → app-config → free-quota → pay → records → generate-image → xpayNotify
```

`pay` 的每分钟定时触发器（`config.json`）随部署自动创建，部署后到「云开发控制台 → 云函数 → pay → 触发器」确认存在 `worker`。

**超时配置**（云函数详情 → 修改）：

| 函数 | 超时 | 原因 |
|---|---|---|
| `generate-image` | ≥ 120s（建议 150s） | 生图含厂商轮询，需远超默认值 |
| 其余 | 默认（20s） | 快查询 |

**环境变量**（云函数详情 → 环境变量，逐函数配置）：

| 函数 | 变量 | 说明 |
|---|---|---|
| `wx-identity` | `USERS_COLLECTION`（可选） | 档案集合名，默认 `users` |
| `app-config` | `MAX_FILE_SIZE_MB`、`RECOMMENDED_LONG_EDGE`、`NOTICE` | 建议值 8 / 1280 / 运营公告文案 |
| `free-quota` | `FREE_QUOTA` | 免费次数单次发放额度，默认 1 |
| `generate-image` | `FREE_QUOTA`、`STYLE_PROVIDER` | 次数额度；引擎：`hunyuan`（默认，免密钥）/ `volcengine` / `tokenhub` |
| `generate-image` | 按 `STYLE_PROVIDER` 配对应密钥 | hunyuan 免；volcengine: `VOLCENGINE_API_KEY`；tokenhub: `TOKENHUB_API_KEY` |
| `pay` | `XPAY_OFFER_ID`、`XPAY_APP_KEY`、`WX_APPID`、`WX_APPSECRET`、`XPAY_ENV` | 虚拟支付四件套 + 环境（0 现网 / 1 沙箱） |
| `pay` | `NEED_PAY`、`PAY_AMOUNT`、`XPAY_TEST_PRODUCT_ID`、`XPAY_PRODUCTS`、`XPAY_SWEEP_DELAY_MS`、`FREE_QUOTA` | `NEED_PAY=false` 为演示模式（模拟发货，无需密钥） |
| `xpayNotify` | `XPAY_APP_KEY`、`XPAY_NOTIFY_PATH` | 与 pay 的 AppKey 一致；路径默认 `/xpay-notify` |

> 联调建议：先用 `STYLE_PROVIDER=hunyuan`（或 mock 逻辑）+ `NEED_PAY=false` 跑通全流程，再切真实引擎与真实支付。

---

## 3. 第二步：数据库初始化（styles / models 集合）

其余 5 个集合（users / tasks / userPhotos / orders / tokens）由云函数自动懒创建，**无需手动建**。`styles` 与 `models` 需要手动初始化：

### 3.1 创建集合

云开发控制台 → 数据库 → 「+」新建集合 → 名称 `styles`。权限保持默认（云函数走管理端不受限，小程序端不直读此集合）。

### 3.2 字段结构

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `_id` | string | ✅ | **唯一 Key**（前端生图传它），英文小写 |
| `name` | string | ✅ | 画风名称 |
| `subtitle` | string | ✅ | 副标题 |
| `swatch` | string | ✅ | 色板 `#rrggbb` |
| `prompt` | string | ✅ | 正向提示词（绝不下发前端） |
| `negativePrompt` | string | ✅ | 反向提示词 |
| `guidance` | array | ✅ | `[min, max]` 强度区间，滑块 0-100 线性映射 |
| `ipStyle` | boolean | ✅ | 是否角色化风格 |
| `enabled` | boolean | 可选 | 不写=上架；`false`=下架 |
| `sort` | number | 可选 | 越小越靠前；不写排最后 |
| `createdAt` / `updatedAt` | number | 建议 | 毫秒时间戳 |

### 3.3 初始化数据（JSON 导入，每行一条记录）

控制台的「JSON 格式」即**每行一条 JSON 记录**（不是整个文件一个大 JSON 对象，也不是 JSON 数组）。复制下方代码块全部内容，粘贴到本地新文件保存为 `styles.json`。

**复制与保存要求**（不满足则控制台报格式错误）：UTF-8 无 BOM 编码、每行一个完整 JSON 对象、不能合并成一行、不能带行号前缀、中文引号不能被编辑器替换。

操作：控制台 → styles 集合 → 「导入」→ 选择保存的 `styles.json` → 冲突处理选 **Insert or Update**（重复导入幂等）→ 完成后核对 4 条。

> 也可以不用导入：用「添加记录 → JSON 模式」从下方代码块**一次粘一行**逐条添加（该入口一次只接受一条记录，整块多行一起粘必报「非法数字符串」类解析错误）。

```jsonl
{"_id":"ghibli","name":"吉卜力","subtitle":"手绘动画 · 治愈光影","swatch":"#6f8a5f","prompt":"吉卜力工作室风格的手绘动画插画，严格保留原图人物的五官特征、发型、年龄与表情，不改变人物身份，赛璐璐平涂上色，清晰的色块边界，柔和的自然光，温暖的午后色调，通透的空气感，背景替换为郁郁葱葱的乡野、层叠的山丘与棉花糖般的积云，细腻的线条，胶片颗粒质感，画面干净，高细节","negativePrompt":"照片质感，写实皮肤纹理，塑料感，过度磨皮，浓妆，现代服饰，现代建筑，汽车，文字，水印，畸变，多余手指，低分辨率，噪点","guidance":[3,9],"ipStyle":true,"enabled":true,"sort":1,"createdAt":1760000000000,"updatedAt":1760000000000}
{"_id":"anime","name":"日系动漫","subtitle":"清透上色 · 大眼萌","swatch":"#c08a93","prompt":"日系赛璐璐动漫插画风格，保留原图人物的五官特征与发型，整体向动漫比例适度夸张，干净锐利的线稿，明亮的大眼睛，柔和的睫毛高光，淡雅通透的水彩色调，柔和渐变上色，樱花与晴空的简洁背景，高分辨率，精细线稿","negativePrompt":"照片质感，写实皮肤，油腻高光，浓重阴影，3D 渲染感，文字，水印，畸变，多余手指，模糊，低分辨率","guidance":[4,10],"ipStyle":false,"enabled":true,"sort":2,"createdAt":1760000000000,"updatedAt":1760000000000}
{"_id":"pixar","name":"3D 皮克斯","subtitle":"立体毛发 · 电影打光","swatch":"#5f7f96","prompt":"皮克斯风格的三维动画角色，保留原图人物的五官特征与发型特征，做成大头身比例的动画角色，精细的毛发与次表面散射皮肤质感，电影级三点布光，柔和的轮廓光，浅景深虚化背景，明快饱和的色彩，温暖的画面氛围，高细节，专业渲染","negativePrompt":"照片质感，恐怖谷，写实人像，扁平插画，文字，水印，畸变，多余手指，噪点，低分辨率","guidance":[3,9],"ipStyle":true,"enabled":true,"sort":3,"createdAt":1760000000000,"updatedAt":1760000000000}
{"_id":"film","name":"复古胶片","subtitle":"胶片颗粒 · 褪色暖调","swatch":"#8b7455","prompt":"1990 年代胶片摄影质感，保留原图人物的五官、发型与姿态，柯达 Gold 风格的暖黄偏色，褪色的高光与偏青的阴影，细腻的胶片颗粒，轻微漏光，柔和的暗角，低对比度，轻微色差，自然光，真实生活感","negativePrompt":"数字锐化，HDR，过饱和，塑料感，文字，水印，畸变，多余手指，画面过亮，低分辨率","guidance":[2,7],"ipStyle":false,"enabled":true,"sort":4,"createdAt":1760000000000,"updatedAt":1760000000000}
```

> 播种兜底：即使不导入，`app-config` 首次被调用时也会自动播种以上 4 条（集合为空才播，幂等）。手动导入与自动播种互不冲突。

### 3.4 models 集合（生图模型真源）

与 styles 同构：控制台改文档即可上线/下线生图模型，无需发版。`generate-image` 首次被调用时也会自动播种内置 5 条（幂等），手动导入与播种互不冲突。

**创建集合**：数据库 → 「+」新建集合 → 名称 `models`（权限默认即可，云函数走管理端）。

**字段结构**：

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `_id` | string | ✅ | 模型 id（前端生图传它），英文小写 |
| `name` | string | ✅ | 展示名 |
| `provider` | string | ✅ | 引擎路由：`hunyuan` / `volcengine` / `tokenhub` |
| `model` | string | 可选 | 厂商模型名；缺省取该引擎的环境变量默认值 |
| `size` | string | 可选 | 出图尺寸（如 `1K` / `2K`）；缺省取引擎环境变量 |
| `guidance` | boolean | 可选 | `true` = 支持 guidance_scale，画风强度滑块生效（缺省不支持） |
| `default` | boolean | 可选 | `true` = 未选模型时的缺省回退项（建议整个目录只有一个） |
| `desc` | string | 建议 | 选择器副标题文案 |
| `enabled` | boolean | 可选 | 不写=上架；`false`=下架 |
| `sort` | number | 可选 | 越小越靠前；不写排最后 |
| `createdAt` / `updatedAt` | number | 建议 | 毫秒时间戳 |

**初始化数据**（复制下方 4 行保存为 `models.json` 后走「导入」，或用「添加记录」一次粘一行；hunyuan / tokenhub 省略 `model` 即取环境变量默认）：

```jsonl
{"_id":"seedream-4","name":"Seedream 4.0","provider":"volcengine","model":"doubao-seedream-4-0-20260415","size":"1K","desc":"出图快 · 性价比高","guidance":true,"default":true,"enabled":true,"sort":1,"createdAt":1760000000000,"updatedAt":1760000000000}

{"_id":"seedream-5","name":"Seedream 5.0","provider":"volcengine","model":"doubao-seedream-5-0-260128","size":"2K","desc":"细节更细腻 · 2K 高清","enabled":true,"sort":2,"createdAt":1760000000000,"updatedAt":1760000000000}

{"_id":"hunyuan","name":"混元生图","provider":"hunyuan","desc":"腾讯云原生 · 免密钥","enabled":true,"sort":3,"createdAt":1760000000000,"updatedAt":1760000000000}

```

**日常运维**：

- **下线模型**：`enabled: false` → 模型选择器即消失（下次拉取列表生效）
- **上线新模型**：新增文档（`provider` + 厂商模型名），并确认对应引擎密钥已配置（§2）——模型可见性 = 已上架 **且** 密钥就绪，双重门槛
- **切换默认模型**：把 `default: true` 从旧项挪到新项（保持只有一个 default）
- **排序**：改 `sort`，越小越靠前

---

## 4. 第三步：云存储初始化

### 4.1 需要手动做的只有示例素材

`task/{openid}/` 任务目录**不需要手动创建**——首次生成时由前端上传原图自动产生，成图由云函数落盘。

### 4.2 示例素材上传（根目录 example/ 文件夹 + 前端常量）

示例素材统一放根目录 `example/` 文件夹（与 styles / task 业务目录分离），fileID 前缀**写死在前端常量** `miniprogram/constants/examples.ts`，不走数据库 / 环境变量配置。

1. **先查权限**：控制台 → 云存储 → 权限设置 → 选 **「所有用户可读，仅写者可读写」**。控制台上传的文件属于管理员，其他任何权限模式下小程序端 `getTempFileURL` 都会报 `STORAGE_EXCEED_AUTHORITY`（示例图、历史记录图全部裂掉）
2. 控制台 → 云存储 → 上传文件，路径填 `example/original.jpg`（路径前缀即"建"出文件夹）—— 全风格共用这一张
3. 对每个画风上传效果图，路径填 `example/ghibli.jpg`、`example/anime.jpg`、`example/pixar.jpg`、`example/film.jpg`（文件名 = 画风 key）
4. 控制台 → 云存储 → 任一文件详情复制 fileID，形如 `cloud://<环境ID>.<存储桶>/...`，取 `cloud://<环境ID>.<存储桶>` 整段 → 替换 `constants/examples.ts` 里 `FILE_ID_HOST` → 小程序重新编译

素材规格：效果图与 original **同尺寸同构图**（用同一张原图生成）；比例 3:4 或 1:1，长边 ≥ 750px；JPG，单张 ≤ 300KB；权限保持默认「所有用户可读」。

> 日常替换素材：控制台**覆盖上传同名文件**（路径不变 → fileID 不变），无需改代码、无需发版。新增画风要配示例图时，上传 `example/{key}.jpg` 并在 `EXAMPLE_AFTER_FILE_IDS` 常量表补一条（随小程序发版生效）。素材未就绪时示例预览显示占位文案，不阻塞画风选择与生成。
>
> 小程序端进入首页时会把 `example/` 下全部图片一次性下载到本地用户目录（后台静默预热），之后无论切到哪个画风都用本地路径渲染（零网络、无闪动）；每次冷启动重新预热覆盖 —— **替换素材后用户下次进入生效**。

### 4.3 任务文件命名规则（自动，无需操作）

前端与云函数共同保证：

```
task/{openid}/{stamp}_original.{ext}   ← 前端上传原图时命名
task/{openid}/{stamp}_result.{ext}     ← 云函数生成后落盘
```

- **目录即时生成**：登录成功后，前端立即上传 `task/{openid}/.keep` 占位文件（0 字节），用户任务文件夹随即在控制台可见；占位失败静默，首次生成时目录仍会自动产生
- `stamp = YYYY_MM_DD_HH_MM_SS_SSS`（如 `2026_10_17_14_30_05_123`），由前端在上传原图时生成并随生图请求下发给云函数（服务端校验格式，非法则用服务端时间兜底）
- 同一任务的原/成图共用同一 stamp，在用户目录下天然配对
- 每次成功生成同时写一条 `tasks` 档案：`{ openid, styleId, styleName, modelId, modelName, strength, originalFileID, resultFileID, costMs, createdAt }`

---

## 5. 第四步：xpayNotify 的 HTTP 接入（真实支付才需要）

1. 云开发控制台 → 云函数 → `xpayNotify` → HTTP 访问服务（云接入）→ 开启路径 `/xpay-notify`
2. MP 后台 → 虚拟支付 → 基本配置 → 发货推送 URL 填：`https://<接入域名>/xpay-notify`
3. 确认 `xpayNotify` 环境变量 `XPAY_APP_KEY` 与 `pay` 一致、`XPAY_NOTIFY_PATH=/xpay-notify`

> 演示模式（`NEED_PAY=false`）可跳过本节；发货有三条互备路径（前端查单 / 平台推送 / 定时兜底），推送缺失不阻塞发货。

---

## 6. 第五步：小程序端发版

- 开发者工具导入项目（`project.config.json` 已含 cloudfunctionRoot / miniprogramRoot）
- 真机预览或上传体验版：`miniprogram/` 前端含云函数名注册表（`utils/cloud.ts` 的 `CLOUD_FUNCTIONS`），与本手册函数名一一对应

---

## 7. 端到端验证清单

| # | 操作 | 预期 |
|---|---|---|
| 1 | 打开小程序 | 静默拉取画风列表；styles 集合被写入 4 条（若未手动导入则被播种） |
| 2 | 「我的」→ 微信登录 | `users` 集合出现档案，`quota` = FREE_QUOTA |
| 3 | 登录成功后立即看云存储 | 出现 `task/{openid}/.keep` 占位文件，用户任务文件夹已生成 |
| 4 | 上传照片 → 选画风 → 生成 | `task/{openid}/` 下出现 `{stamp}_original.*` 与 `{stamp}_result.*`；`tasks` 集合新增一条含两个 fileID 的档案；`users.quota` 减 1 |
| 5 | 「我的」→ 历史创作 | 列表出现刚才的记录，缩略图可预览/保存 |
| 6 | 控制台把某画风 `enabled: false` | 重开小程序卡片消失；直接传该 key 生图报「风格不存在」 |
| 7 | 控制台新增画风文档（不配素材） | 重开小程序出现新卡片，示例预览显示占位文案 |
| 8 | 控制台把某模型 `enabled: false` | 重开小程序模型选择器少一项；带该 modelId 生图报「模型 xxx 不可用」（400） |
| 9 | 购买次数包（NEED_PAY=false） | 下单即模拟发货，`orders` 出现 MOCK 单，`users.quota` 增加 |
| 10 | 历史创作菜单 | 未登录不显示，登录后显示 |
| 11 | 退出登录 → 再次登录 | 直接恢复登录态（不弹授权表单）；云存储 `avatar/` 下不新增文件（同一个人只有一份头像） |

---

## 8. 故障排查速查

| 现象 | 排查点 |
|---|---|
| 冷启动报 `Cloud API isn't enabled` | 云函数未部署成功，重新上传 |
| 生图报「风格 xxx 不存在」 | styles 集合无此 `_id` 或 `enabled: false` |
| 导入报「非法数字符串」类解析错误 | 把多条记录粘进了「添加记录」（一次只收一条）；批量走集合页「导入」上传保存好的 `.json` 文件，或用「添加记录」逐条粘 |
| 生图报 40200 | `users.quota` 为 0，走购买或调 `FREE_QUOTA` |
| 画风列表空 | app-config 日志查 `[app-config]`；确认 styles 集合有 `enabled ≠ false` 的文档 |
| 模型选择器为空 | 确认 models 集合有 `enabled ≠ false` 的文档，且对应引擎密钥已配置（§2 环境变量）——两者缺一不可 |
| 生图报「模型 xxx 不可用」 | models 集合无此 `_id`、已 `enabled: false`，或对应引擎密钥未配置 |
| 任务文件没落到 task/{openid}/ | 确认部署的是最新 `generate-image`（含 taskStamp 逻辑） |
| 示例预览不显示云端图 | ① 云存储权限须为「所有用户可读」（报 `STORAGE_EXCEED_AUTHORITY` 即此项）；② 确认 `constants/examples.ts` 的 `FILE_ID_HOST` 是真实存储前缀；③ `example/` 下有对应文件（原图与效果图缺一整组不显示） |
| 支付报「虚拟支付未配置」 | `NEED_PAY=true` 时 XPAY_* 环境变量缺失；`NEED_PAY=false` 演示模式还报此错 = 部署的是旧版 `pay`（未含 mock 查单豁免），重新上传部署 |
| 推送验签失败 | `xpayNotify` 的 `XPAY_APP_KEY` 与 MP 后台不一致，或 path 与 `XPAY_NOTIFY_PATH` 不一致 |
