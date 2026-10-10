# 风格选择器收敛为「单一强调色」

Written against: commit unavailable (working tree)

## Evidence chain

- Surface: `pages/index/index.wxml` 的 `step:style` 网格，渲染自 `components/style-card`
- Problem: 「挑一个画风」网格为 4 个风格各渲染一块独立色块（`styleItem.swatch`），整屏同时出现多种颜色；而全站其余表面（上传 / 成片 / 生成中 / 我的 / 付费弹层 /  FAQ / 免责声明）均为暖白 + 墨色 + 单一陶土强调色（terracotta）的近单色调性。该步骤是全站唯一多色块并列处，与整体风格脱节。
- Design evidence: `miniprogram/app.wxss` L10–12 注释——“颜色只用在真正需要强调的地方（当前步骤、当前画风、进度），一次只出现一个强调色，多了就俗”；以及该文件整体的近单色、用线不用阴影原则。`miniprogram/types/index.ts` `StyleMeta.swatch` 注释说明色块是为去除「渐变+emoji」的 AI 生成感而设。
- Owner: `components/style-card/index.{wxml,wxss}`；色值来自 `miniprogram/constants/styles.ts`（占位，后端 `loadStyles` 下发）。
- Scope and affected surfaces: 仅 `components/style-card` 两个文件；首页 `step:style` 的消费者结构不变。
- Uncertainty: 无。修正不改数据模型、不改交互、不引入资源。

## Design decision

保留「色块区分画风」的意图，但把颜色的使用收敛到契约明确允许的「当前画风」场景：**只有被选中的卡片着色，未选中的卡片用中性占位块**。这样既消除「多色并存」与全局单强调色原则的冲突，又让选中态更突出（恰是契约允许的用色点），且无需预览图等新增资源。

具体：`.swatch` 默认背景改为中性 `--surface-2`（浅暖灰），去掉「每个卡片都上色」；`wxml` 仅当 `active` 时用内联 `style` 注入该风格色。既有的 `.card.is-active`（边框 + 名称转为 `--accent`）保持不变，选中卡片同时具备：中性色块→风格色、边框强调、名称强调，层次清晰。

## Reuse

- 令牌：`--surface-2`（定义于 `app.wxss` L20，`#f0eee9` 浅暖灰），用作未选中占位；`--accent` 已由 `.card.is-active` 复用。
- 既有模式：`.card.is-active` 边框 + 名称着色逻辑（`style-card/index.wxss` L16–18、L40–42），本次不改动。
- 无需新增 primitive；若后续要「风格预览图」替代色块，需引入 `StyleMeta.placeholder` 与后端资源，属另一方案，不在本范围。

## Changes

1. `miniprogram/components/style-card/index.wxss`
   - Change: `.swatch { height: 168rpx; }` 改为 `.swatch { height: 168rpx; background: var(--surface-2); transition: background 0.15s ease; }`
   - Preserve: `.card` / `.card.is-active` 边框与名称着色、`.meta` / `.name` / `.subtitle` 排版不变。
   - Verify: 未选中卡片色块呈浅暖灰，选中卡片色块显示其风格色，过渡平滑。

2. `miniprogram/components/style-card/index.wxml`
   - Change: `<view class="swatch" style="background: {{styleItem.swatch}};"></view>` 改为
     `<view class="swatch" style="{{active ? 'background: ' + styleItem.swatch : ''}}"></view>`
   - Preserve: 外层 `.card` 的 `data-id`、名称/副标题文本、点击 `bindtap` 不变。
   - Verify: 仅 `active` 卡片带内联色；非 active 卡片无内联色，回落到 `.swatch` 的中性背景（内联 style 空串不覆盖 class）。

## Scope

- Inherit: 首页 `step:style` 的 `.grid` 消费者结构不变；`StyleMeta.swatch` 字段仍被使用（仅限 active）。
- Verify: `pay-modal`、`profile`、`faq`、`disclaimer`、`upload` 步骤均不受影响。
- Exclude: 上传步骤的 `pill-dot`（同样引用 `swatch` 作小色点）属同一配色模式但用户明确只针对「挑一个画风」；如希望全局一致可另行处理，本方案不动。

## Validation

- Product: 进入「挑一个画风」步——四张卡片初始为统一中性浅灰块；点选某风格后仅该卡片着色并显示其色相，其余回落中性；切换选择时颜色随选中态平滑迁移。
- Interface: 选中/未选中切换、两列 `.grid` 布局、四种风格色相（苔绿/藕荷/灰蓝/棕褐）、窄屏与常规屏。
- System: 确认未引入新的并行配色模式；`--surface-2` 已在全局令牌定义，被复用而非新建。
- Repository: `npm run typecheck` → 0 errors（wxml 变动不触及 tsc，但确认无回归）。

## Stop conditions

- 若产品决定「风格必须用预览图而非色块」来传达画风，则本方案范围需扩大（需 `StyleMeta.placeholder` + 后端资源），应停止并重新评估。

## Design documentation

- 接受并验证后：在 `types/index.ts` 的 `StyleMeta.swatch` 注释中补充「色块仅在选中态着色，未选中为中性占位，以符合全局单一强调色原则」，落点 `miniprogram/types/index.ts`。
