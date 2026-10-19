# 照片百变 · pictures-shift-wxmini

上传一张照片，选一个画风，十几秒后拿回一张可直接发朋友圈的成片。
首批画风：**吉卜力 / 日系动漫 / 3D 皮克斯 / 复古胶片**（云数据库 `styles` 集合配置，控制台改文档即上新/下架，无需发版）。

技术选型：**原生微信小程序（TypeScript）+ 微信云开发（云函数 / 云数据库 / 云存储）+ 第三方图生图 API**。无自有服务器，prompt 与密钥全在云端，绝不下发前端。

---

## 架构

- **7 个云函数**（`cloudfunctions/`，能力域拆分）：`wx-identity`（登录身份）/ `app-config`（画风目录 + 运行参数）/ `free-quota`（免费次数）/ `pay`（交易状态机）/ `records`（内容记录）/ `generate-image`（同步生图 + 模型目录）/ `xpayNotify`（支付发货推送）
- **云数据库真源**：`styles`（画风，控制台改文档即生效）/ `models`（生图模型，可见性 = 已上架且引擎密钥就绪）/ `users`（档案 + 次数）/ `tasks`（任务档案）/ `orders` / `tokens` / `userPhotos`
- **云存储**：`example/`（示例素材，fileID 写死在前端常量）+ `task/{openid}/`（任务归档，原/成图按时间戳配对，全自动产生）
- **生图链路**：前端压缩原图上传 `task/{openid}/` → `generate-image` 服务端原子扣次数 → 按画风 prompt + 所选模型轮询厂商 API → 成图落 `{stamp}_result.*` → 返回临时直链
- **计费**：`users.quota` 服务端扣减（失败返还）；购买走微信虚拟支付，`NEED_PAY=false` 可全程演示（mock 发货）

---

## 目录结构

```
pictures-shift-wxmini/
├── miniprogram/              小程序端（TypeScript）
│   ├── pages/                index（三步向导）/ profile / history / pay-success / disclaimer / faq
│   ├── components/           style-card / compare-slider / login-modal / pay-modal / custom-tab-bar
│   ├── services/             api / auth / pay —— wx.cloud.callFunction 封装
│   ├── constants/            示例素材 fileID、画风与配置的本地兜底、storage key
│   └── utils/                cloud（云函数/云存储/本地缓存）/ image / auth / quota / cache / error
├── cloudfunctions/           7 个云函数（目录名即函数名，逐个上传部署）
└── docs/
    └── cloud-setup-guide.md  ★ 云环境配置手册（清空重建版：部署 / 种子数据 / 示例素材 / 环境变量 / 验证清单 / 排查）
```

---

## 开发

```bash
npm run typecheck     # 小程序端类型检查（wxss/wxml 在微信开发者工具里看）
```

微信开发者工具打开仓库根目录（`project.config.json` 已配好 `miniprogramRoot` / `cloudfunctionRoot`）。

**云环境首次搭建或清空重建**：照着 `docs/cloud-setup-guide.md` 一步步执行——部署云函数、导入 `styles` / `models` 种子数据、上传 `example/` 示例素材、逐函数配置环境变量、跑端到端验证清单；出问题先查手册 §8 排查速查表。

---

## 设计要点

- **画风与模型都是数据库真源**：控制台改文档即上架/下架/调参，无需发版；引擎密钥就绪是第二道门槛（未配置的模型不下发，防选中后必然失败）
- **服务端兜底一切**：openid 由 `cloud.getWXContext()` 取（前端不可伪造）、次数原子扣减、订单状态机幂等发货（前端查单 / 平台推送 / 定时兜底三条互备路径）
- **登录防重复**：云端已有档案直接静默恢复登录，头像只在首次建档上传一次
- **文案不编数字**：营销位陈述必须与实现对齐，禁用无数据支撑的数字与虚构用户评价
