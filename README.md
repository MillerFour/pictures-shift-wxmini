# 照片百变 · pictures-shift-wxmini

上传一张照片，选一个画风，十几秒后拿回一张可直接发朋友圈的成片。
首批风格：**吉卜力 / 日系动漫 / 3D 皮克斯 / 复古胶片**。

技术选型：**原生微信小程序（TypeScript）** + **BFF（Node 20 + Hono + TypeScript）** + **第三方图生图 API**。

---

## 为什么必须有 BFF

微信小程序不能自己跑图像模型，「上传照片 → 吉卜力头像」必然要落到云端厂商。
但**厂商 API Key 绝不能进小程序包体** —— 包体可被任意反编译，Key 一旦下发就等于公开，额度会被别人刷光。

所以架构固定为：

```
┌──────────────────────────────┐
│  微信小程序 (原生 TS · 单页向导) │
│  ① 上传（压缩后 wx.uploadFile）   │
│  ② 选画风 + 强度 → 提交 → 轮询   │
│  ③ 展示 / 长按看原图 / 存相册     │
└───────────────┬──────────────┘
                │ wx.request / wx.uploadFile / wx.downloadFile
                │ （只配一个自有域名）
┌───────────────▼──────────────┐
│  BFF (server/)               │
│  · 持有厂商密钥，不下发给小程序   │
│  · 适配各厂商协议差异            │
│  · 任务表 + 轮询调度 + TTL 清理  │
│  · 结果图落内存，转成自有域名地址 │
└───────────────┬──────────────┘
                │ HTTPS
        ┌───────┴────────┐
    腾讯云 TokenHub   火山方舟 / 百炼
   （混元生图同步）   （prompt 驱动）
```

BFF 本身**无状态、不落库**：不建数据库、不存用户照片、不存作品，只在内存里保留任务直到出图完成（默认 30 分钟）。

---

## 用户流程

单页三步，不跳页，状态收在一处（`miniprogram/pages/index/index.ts` 的 `step` 字段）：

| 步骤 | 界面 | 用户能做什么 |
|---|---|---|
| ① 上传 | 大标题 + 描边上传区 + 画风色点列表 | 选图 / 拍照，选完自动进入 ② |
| ② 选画风 | 照片缩略条 + 画风网格（选中态描边）+ 强度滑块 | 换图 / 选画风 / 调强度 / 点「生成吉卜力风格」 |
| ③ 成片 | 成片大图 + 画风与耗时 | 长按对比原图 / 保存相册 / 换个画风 / 分享 / 换张照片 |

顶部**步骤条**三步共用，永远告诉用户「走到哪了、还剩几步」：当前步是强调色实心圆点，已完成的是灰色实心，未到达的是空心。

**做单页而不是三页的理由**：这是一条线性引导流程，跳页会让用户丢掉「已经选好的东西」，
跨页传数据又得靠 storage 中转。单页让「再来一张」只是 `step = 'upload'` 一行。

两个细节：

- **失败时停在第 ② 步**，不退回第 ① 步 —— 用户换张图或换个风格就能重试，不用从头再来。
- **出图进度条会爬到 90% 停住**，成功瞬间跳满。厂商不给真实百分比，干等不动会让人以为卡死，
  但爬到 100% 再慢慢跳也是骗人。

### 引导设计

单页向导的引导不靠「用户自己看懂」，每一步都给出明确的下一步：

- **主按钮文案跟着选择走** —— 选完吉卜力，按钮就是「生成吉卜力风格」，不是含糊的「生成这张风格」。
- **滑块必须给建议值** —— 光标一个「画风强度 60」没人知道什么意思，所以下面写死一句
  「头像建议 60-75，整张人像可以再高一点」。
- **重试分三级**，按用户满意度从高到低排：
  「换个画风」（照片留着，最常用）→ 「换张照片」（彻底重开）→ 生成失败时直接停在第 ② 步。
- **上传区写清三件事**：能干什么（选或拍）、要什么格式、体积上限；
  下面再补一句「正脸、光线均匀、背景简单的照片出片最好看」，这是在管理预期，
  避免用户拿一张糊图进来然后怪效果差。
### 视觉：为什么不用「AI 味」的那套

界面刻意避开下面这几样 —— 它们几乎只出现在 AI 生成的界面里：

| 避开的 | 换成的 |
|---|---|
| 紫蓝青霓虹渐变按钮、发光阴影 | 墨色实心按钮，无阴影 |
| 深色底 + 半透明玻璃拟态 | 暖白底（`#f7f6f3`）+ 发丝线分隔区块 |
| 全站胶囊圆角（`--r-full`） | 6 / 10 / 14rpx 三档直角 |
| emoji 当图标（🌿🎨⚡🔒） | 纯色色块 + 文字；没有图标就不画图标 |
| 高饱和渐变色卡 | 单一低饱和 `swatch` 色（苔绿 / 藕荷 / 灰蓝 / 棕褐） |
| 「零基础 / 十几秒出图 / 不留存」三件套 | 一行陈述句（隐私说明），排版上给足留白 |

判断标准很简单：**颜色只用来标注「当前选中 / 进行中」这类状态**，一次只出现一个强调色（`--accent`）。
去掉装饰后剩下的空间，靠字重和留白分层 —— 这是专业工具和模板页面的分界线。

结果上反而更合适：这是个看照片的应用，暖白底比深色底更接近纸质相册，成片颜色也更接近真实。

### 文案原则

营销位不能编数字。所有陈述都要与实现对齐：

| 文案 | 依据 |
|---|---|
| 十几秒后换一种画风 | 实测 13-24 秒；写「十几秒」而非承诺秒数 |
| 照片只用于本次风格化，处理完即从服务端内存清除 | BFF 确实不落库，TTL 到期即清 |

**不要写「已有 12,843 人使用」这类没有数据支撑的数字，也不要编用户评价。** 文案一旦失真就是虚假宣传，审核和用户信任都会受损。

---

## 目录结构

```
pictures-shift-wxmini/
├── miniprogram/                  小程序端
│   ├── app.ts / app.json / app.wxss
│   ├── types/index.ts            与 BFF 共享的传输契约
│   ├── config/env.ts             按 develop / release 切后端地址
│   ├── constants/                风格与 storage key 的本地兜底
│   ├── utils/                    request / image / cache / error
│   ├── services/api.ts           风格、配置、提交任务、轮询
│   ├── components/style-card/    风格卡片
│   └── pages/
│       └── index/                ★ 单页三步向导
│                                  upload → style → result
│
└── server/                       BFF
    ├── src/
    │   ├── index.ts              Hono 路由 + 后台转换任务
    │   ├── config.ts             配置 + 零依赖 .env 解析
    │   ├── catalog.ts            ★ 风格目录与提示词（产品核心资产）
    │   ├── task-store.ts         内存任务表 + TTL 清理
    │   ├── envelope.ts           信封与业务错误码
    │   ├── types.ts              与小程序端对齐的 DTO
    │   └── providers/
    │       ├── types.ts          StyleProvider 抽象 + 错误提取
    │       ├── mock.ts           零配置跑通全流程
    │       ├── tokenhub.ts       腾讯云 TokenHub（当前使用）
    │       ├── volcengine.ts     火山方舟（已实测出图）
    │       ├── dashscope.ts      阿里百炼
    │       └── index.ts          引擎工厂
    └── .env.example
```

---

## 快速开始（零配置，5 分钟跑通全流程）

### 1. 启动 BFF（mock 引擎，不需要任何密钥）

```bash
cd server
npm install
npm run dev
```

看到这两行就是好了：

```
[bff] 已启动  引擎=mock  端口=8787
[bff] 当前为 mock 引擎：不做真实风格化，结果图与原图一致。
```

### 2. 用微信开发者工具打开**仓库根目录**

`project.config.json` 已配好 `miniprogramRoot`，直接打开即可。
详情 → 本地设置 → 勾上 **不校验合法域名、web-view、TLS 版本以及 HTTPS 证书**（本地调试用，发布前务必关掉）。

### 3. 真机预览要改地址

`miniprogram/config/env.ts` 里 `DEV_API_BASE` 现在是 `http://127.0.0.1:8787`，
手机连不到。改成你电脑的局域网 IP（如 `http://192.168.1.10:8787`），或用内网穿透工具。

### 4. 自己验证接口

```bash
# 拉风格列表
curl http://127.0.0.1:8787/api/styles

# 提交一张图
curl -F "photo=@test.jpg" -F "styleId=ghibli" -F "strength=70" \
     http://127.0.0.1:8787/api/convert
# -> {"code":0,"data":{"taskId":"...","status":"RUNNING"}}

# 轮询
curl http://127.0.0.1:8787/api/tasks/<taskId>
# -> {"code":0,"data":{"status":"SUCCEEDED","resultUrl":"/api/files/result/...","costMs":23864}}

# 取图
curl -o out.jpg http://127.0.0.1:8787/api/files/result/<taskId>
```
---

## 接入真实引擎

改 `server/.env`（照抄 `.env.example`），把 `STYLE_PROVIDER` 换成对应厂商即可。
四个 Provider 实现同一个 `StyleProvider` 接口，互不干扰。

### 当前使用：腾讯云 TokenHub / 混元生图

```dotenv
STYLE_PROVIDER=tokenhub
TOKENHUB_API_KEY=你的 TokenHub API Key
TOKENHUB_IMAGE_MODEL=hy-image-v3.5-preview
# 原图传法：base64 | url。base64 不需要公网域名
TOKENHUB_IMAGE_INPUT=base64
```

走 OpenAI 兼容的 messages 结构（一个 user 消息里「文本 prompt + image_url」），
混元生图是**同步**接口，一次请求直接返回图。

已实测（2026-10）：endpoint 与 model 名正确，请求体通过了网关参数校验，
但被计费闸门拦下 —— `HTTP 402 / code 401007`
「服务无可用免费体验额度，且未开启后付费」。
**开通后付费后需要一次性确认两件事**，代码里已标注：

- **`image_url.url` 收不收 base64 data URI。** 官方请求示例给的是公网 URL。
  若被拒，改成 `TOKENHUB_IMAGE_INPUT=url` 并配好 `PUBLIC_BASE_URL` ——
  BFF 已经为百炼建好了 `GET /api/files/source/<taskId>` 回源端点。
- **响应体结构。** 官方只有请求示例、没有响应示例，`extractImage()` 按几种常见形态依次尝试，
  都匹配不上就把真实响应原样抛出，一次就能定位。

### 备选一：火山引擎方舟（已完整跑通并看过出图）

prompt 驱动，不需要风格索引表，加风格只改 `catalog.ts`。

```dotenv
STYLE_PROVIDER=volcengine
VOLCENGINE_API_KEY=你的方舟 API Key
VOLCENGINE_MODEL=doubao-seedream-4-0-20260415
VOLCENGINE_SIZE=1k
```

实测结论：

- `image` 接受 base64 data URI，不需要公网地址；`negative_prompt` 与 `guidance_scale` 都被接受。
- `size` 只接受 `WIDTHxHEIGHT` 或 `1k` / `2k` / `4k`。旧文档里的 `adaptive` 会报 `InvalidParameter`。
- 同耗时下 `1k` 约 600KB、`2k` 约 1.7MB，分享场景 `1k` 足够。
- 吉卜力风格实测：背景换成乡野层叠山丘与积云，主体构图保留，赛璐璐平涂 —— prompt 意图被正确执行。
- 胶片风格实测：保留原背景，加胶片颗粒与暗角青绿色偏 —— 与吉卜力的差异化行为正确。
- 同账号的 `seedream-5-0-pro` / `5-0-flash` 返回 `429 SetLimitExceeded`，
  报错原文提示需在方舟控制台关闭「安全体验模式」。
- 尚未验证：`seededit` 系列支持多张垫图。吉卜力这类 IP 风格靠垫图锁定效果会明显更好，
  但入参结构不同，要接必须同时改 `buildRequest` 和 `ConvertInput.source`。

### 备选二：阿里云百炼 / 通亿万相（内置风格库，含吉卜力）

`wanx-style-repaint-v1` 自带上百种风格，IP 风格还原度更好，但有两个额外要求：

```dotenv
STYLE_PROVIDER=dashscope
DASHSCOPE_API_KEY=你的百炼 API Key
# 风格 id = 风格索引，索引值以百炼控制台的风格列表为准，填错会直接报错
DASHSCOPE_STYLE_INDEX_MAP=ghibli=1,anime=2,pixar=3,film=4
# 必须配公网 HTTPS 域名：百炼只能用 URL 取原图
PUBLIC_BASE_URL=https://api.你的域名.com
```

`PUBLIC_BASE_URL` 指向的 BFF 会通过 `GET /api/files/source/<taskId>` 把原图暴露给百炼拉取。
这意味着**原图在短期内对外可访问**，TTL 只有任务存活期；正式上线前建议换成 OSS 预签名 URL。

`dashscope.ts` 里 `parameters.strength` 的方向也标了：首次接入请用 0.2 / 0.6 / 0.95 三档实测，
方向反了只改那一行。
### 不要踩的坑：Moonshot / DeepSeek 都不能生图

实测确认（2026-10）：

- **Kimi**：`kimi-k3` 能「看图」（vision 可用），但明确回复「我无法直接生成或编辑图片」。
  `/images/generations` 端点存在，返回 `403 The API you are accessing is not open`（需申请开通）。
- **DeepSeek**：官方模型列表只有 `deepseek-flash` 与 `deepseek-v4-pro`，
  前者支持图像输入，**没有任何图像生成模型**。

这两家都是「输入侧」模型（能看不能画），做不了风格转换。接进来只会让每次生成都失败，
或把一段文字当成图片地址存进任务表。

---

## 微信后台必配项（不做会白屏 / 上不了线）

| 位置 | 配置什么 |
|---|---|
| 开发管理 → 开发设置 → **服务器域名** | 你的域名分别加入 `request` / `uploadFile` / `downloadFile` 三个合法域名 |
| 开发管理 → 开发设置 → **隐私保护指引** | 声明 `chooseMedia`（选照片）、`saveImageToPhotosAlbum`（存相册）的用途 |
| 设置 → 基本设置 → AppID | 正式发布前把 `project.config.json` 里的 `touristappid` 换成真实 AppID |

补充说明：

- `<image>` 组件渲染**网络地址不需要**配合法域名，`wx.downloadFile` 才需要 —— 所以结果图走自有域名是对的。
- 开发者工具里的「不校验合法域名」只在调试时有用，真机和审核一律按域名白名单执行。
- 结果图在 BFF 内存里，**服务重启后历史图片立即失效**。当前是「不落库」的刻意取舍，见下方 TODO。

---

## API 契约

统一信封，业务失败一律 HTTP 200 + 非 0 code（小程序只判断 `code === 0` 一次）：

```ts
{ code: number, message: string, data: T, requestId?: string }
```

| 接口 | 说明 |
|---|---|
| `GET /api/config` | 体积上限、建议长边、运营提示语 |
| `GET /api/styles` | 风格展示元数据（**不含** prompt / 模型参数） |
| `POST /api/convert` | multipart：`photo` + `styleId` + `strength(0-100)` → `202 {taskId,status}` |
| `GET /api/tasks/:id` | 轮询；成功带 `resultUrl`，失败带 `errorMessage` |
| `GET /api/files/result/:id` | 结果图字节 |
| `GET /api/files/source/:id` | 原图字节（供「只能用 URL 取图」的厂商回源） |
| `GET /healthz` | 存活 + 当前引擎 + 内存任务数 |

错误码：`40000` 参数 / `40400` 风格不存在 / `40401` 任务不存在 / `41300` 超大 / `41500` 非图片 / `5001x` 厂商异常。
---

## 风格怎么改

**全部风格定义集中在 `server/src/catalog.ts` 一个文件**，改完重启 BFF 生效，小程序不用发版。
每条 prompt 都遵循两条铁律：

1. **显式写「保留原图人物的五官特征、发型、年龄与表情，不改变人物身份」** ——
   图生图模型最容易出的问题就是把人画成陌生人，这条约束比任何美术描述都重要。
2. **`negativePrompt` 里重点压制「照片质感」** —— 不给负向约束，模型会保留写实光影，
   风格化就只剩下「加了个滤镜」。

`guidance: [min, max]` 是「画风强度」滑块的映射区间，不同风格可用的区间不同：
胶片类需要大幅偏移，3D 卡通类可以更极端。

---

## 上线前必须补的 TODO

按优先级排：

1. **错误信息脱敏** —— `errorMessage` 目前直接透传厂商原文（含 request id 等内部信息），
   上线前要在 BFF 侧映射成用户能懂的文案，详细堆栈只进日志。
2. **限流与配额** —— 现在完全开放。一个恶意用户可以循环刷爆你的厂商额度。
   至少要加 IP/设备维度的日配额 + 并发上限。
3. **任务表换 Redis** —— 现在是单实例内存，重启丢任务、多实例不共享。
   「不落库」指的是**不落业务数据库**（不存用户照片和作品），
   但任务状态放 Redis 只是临时数据，不违背产品承诺。
4. **计费与免费额度** —— 生成是有真实成本的，现在任何人无限用。
5. **原图存储换 OSS 预签名 URL** —— 替代 `/api/files/source` 的公网暴露。
6. **吉卜力是注册 IP** —— Studio Ghibli 版权方对商用 AI 风格化有明确主张。
   商业化前务必做法务确认，或用 `ipStyle: false` 的原创风格替代。
   `catalog.ts` 里已用 `ipStyle` 字段标出哪些属于 IP 风格。
7. **内容安全** —— 生成图需要过审（`imgSecCheck`），人脸还需单独的合规评估。

---

## 开发命令

```bash
# 小程序端类型检查（wxss/wxml 需在微信开发者工具里看）
npm run typecheck

# BFF
cd server
npm run dev        # tsx watch
npm run typecheck
npm run build && npm start
```