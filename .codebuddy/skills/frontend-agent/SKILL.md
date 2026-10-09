---
name: frontend-agent
description: 听潮 Vue2 通用中后台前端基础模板（tingchao-front-template）开发专家 - Vue 2.6 + ElementUI + 动态路由 + 多语言 + 主题色 + CURD 能力
created: 2026-08-19
updated: 2026-08-19
---

# 🎨 听潮前端基础模板开发专家 (tingchao-front-template)

## 🎯 模板定位

一套**通用 Vue2 中后台前端基础模板**（听潮后台管理系统 `tingchao-front-template`）：新开项目 → 复制本模板 → 删 demo → 开箱即用。

它是一套"壳"，内置权限、登录、布局、多语言、主题色、CURD、文件上传、图表、富文本等通用能力。

**技术栈**：Vue 2.6.10（Options API）/ Vuex 3 / Vue Router 3 / ElementUI 2.15.7 / SCSS / Axios（封装 `c2s`/`http`/`httpFun`）/ vue-i18n 8 / ECharts 5 / tinymce / svg-sprite-loader。构建：Vue CLI 4，`npm run dev` / `npm run build`。

> 🎯 **本 Skill 的核心使命（约束 AI 代码生成）**：AI 生成前端代码时**默认优先复用模板已有能力**；除非命中「组件使用约束协议」放行条件，否则不得引入模板之外的组件/库/写法。

---

## 📋 核心开发规范

### 1. 页面开发（Options API + curd mixin）
列表/增删改查页统一继承 `curd` mixin，禁止重复造轮子：

```vue
<template>
  <div class="page-container">
    <div class="search-main">
      <div class="search-left-btn">
        <el-button type="primary" @click="addAction">新增</el-button>
      </div>
      <div class="search-right-form">
        <el-input v-model="searchData.key" placeholder="搜索" clearable></el-input>
      </div>
    </div>
    <data-table :data="tableData" :columns="columnDatas.columns"
      :showSelect="columnDatas.showSelect" :showIndex="columnDatas.showIndex"
      @selection-change="setcheckRows" />
  </div>
</template>

<script>
import curd from '@/mixins/curd'
export default {
  name: 'PageName',
  mixins: [curd],
  data() {
    return {
      request: { getPage: getPageApi, add: addApi, edit: editApi, delete: deleteApi },
      searchData: { key: '', pageNo: 1, pageSize: 10 },
      columnDatas: {
        showIndex: true, showSelect: true,
        columns: [
          { label: '名称', prop: 'name', render: (h, { row }) => h('span', row.name || '--') },
          { label: '操作', width: 200, fixed: 'right',
            render: (h, { row }) => h('div', [
              h('el-button', { props: { type: 'text', size: 'small' }, on: { click: (e) => { e.stopPropagation(); this.viewDetail(row) } } }, '查看'),
              h('el-button', { props: { type: 'text', size: 'small' }, on: { click: (e) => { e.stopPropagation(); this.dialogEdit(row) } } }, '编辑')
            ]) }
        ]
      }
    }
  }
}
</script>
```

### 2. API 接口（统一 httpFun）
禁止裸 axios：`import { httpFun } from '@/utils'`，`httpFun({ url: './api/xxx/list', data, methods: 'post' })`。约定 `res.code === 0` 成功；下载用 `responseType:'blob'`，上传用 `common.js` 的 `uploadFileApi`。

### 3. CURD Mixin 速查（`@/mixins/curd`）
- 数据：`tableData`/`totalCount`/`searchData`/`loading`/`dialogShow`/`editData`/`infoDrawerShow`/`infoData`
- 方法：`doSearch()`/`resetPage()`/`dialogEdit(item)`/`addAction()`/`deleteBtn()`/`setcheckRows(rows)`/`viewDetail(row)`/`openInfoDrawer({title,size,data})`
- 详情：`infoDataKeys`（分组 + `infoDataKey` 数组，每项 `{label,key,type}`），`type` 支持 `text`/`file`/`tag`/`html`/`img`/`mutl-img`/`text-array`/`cascader`

### 4. 组件注册
公共组件在 `src/components/index.js` 导出并由 `main.js` 全局注册，**业务页直接用全局组件名，无需 import**。

### 5. 多语言 (vue-i18n)
文案放 `src/locales/lang/`，用 `this.$t()`；菜单/标题走 `filters` 的 `menuTitle`/`viewTitle`；新增中文文案同步各语种文件。

---

## 🎨 样式与主题约束（防样式屎山的核心防线）

本模板是**多主题框架**，视觉 token 集中在 `src/style/theme-*/variable.scss`（4 套：`theme-default`/`theme-blue`/`theme-dark`/`theme-light`，由 `src/style/index.scss` 统一 `@import`）。

> ⚠️ **唯一事实来源**：具体 token 名称/数值以 `src/style/theme-default/variable.scss` 为准。**AI 生成任何样式前，必须先 `read_file` 读取该文件获取当前 token 列表**，不得凭记忆或本 Skill 旧副本硬编码值。本 Skill 不罗列具体 token（避免与 scss 不同步）。

**强制规则：**
1. ❌ 禁止硬编码颜色（`#xxx`/`rgb()`/`rgba()` 字面量）与尺寸（`font-size`/`padding`/`margin`/`border-radius` 的 px 值）。一律 `var(--xxx)` 引用主题变量。
2. 颜色/字号/间距/圆角 token 取最接近的档位使用；确需新值先提建议让用户增补到 `variable.scss`，不自创 `--my-*` 游离变量。
3. 业务页样式加 `scoped`；复用框架已有类（`.page-container`/`.search-main`/`.search-left-btn`/`.search-right-form`）。
4. ❌ 禁止 `!important` 硬改 ElementUI/主题样式（框架级 bug 除外）。
5. 改 ElementUI 内部样式用 `::v-deep` 且限定最窄作用域。
6. 语义色优先 ElementUI `type`（primary/success/warning/danger/info），已与主题变量联动；动态换肤用 `utils` 的 `createThemeColor`/`ThemeColor`，勿改 ElementUI 主题编译产物。

---

## ⚠️ 强制规则

1. **Options API** —— 不使用 Composition API / `<script setup>`。
2. **curd mixin** —— 表格增删改查页统一继承 `curd`。
3. **httpFun** —— 接口统一封装，禁止裸 axios。
4. **主题 token** —— 样式必须引用 `theme-*/variable.scss` 变量，禁止硬编码（见上节）。
5. **图片/文件封装** —— 图片用 `el-image`，上传用 `common.js` 上传接口。
6. **组件优先复用** —— 见「组件使用约束协议」。
7. **去业务化** —— 新项目先删 `src/view/test`、清理 `baseConfig.js` 业务示例，再写真实业务。

---

## 🔒 组件使用约束协议（AI 代码生成必须遵守）

默认站在"模板已有能力"之上，**不得凭空引入模板外的组件/库/方案**，除非命中放行条件。

### 模板能力清单（已内置，直接复用，勿触发超框询问）
| 类别 | 能力 | 用法 |
|------|------|------|
| 表格 | `<data-table>`（`@/components/table/data-table.vue`） | 配 `curd` 的 `tableData`/`columnDatas` |
| 详情 | `<info-drawer>` + `curd.openInfoDrawer({title,size,data})` + `infoDataKeys` | — |
| 菜单/右键 | `<context-menu>`、`menuComs/leftMenu.vue` | 由 `layout` 装配 |
| 图标 | `<svg-icon>`（资源放 `src/icons/*.svg`）、`<loading-icon>` | — |
| 错误页 | `ErrorPage/404` | 已挂路由 |
| 图表 | `this.$echarts`（已挂 `Vue.prototype.$echarts`） | 无需引包 |
| 富文本 | `<vue-tinymce>` / `this.$tinymce` | — |
| 上传/下载 | `el-upload`+`common.js` 的 `uploadFileApi` / `downloadFileApi`+`utils.downloadFile` | 勿另引库 |
| 级联/树 | ElementUI `el-cascader` / `el-tree` | 样式已适配主题 |
| 字典/区划 | `common/baseConfig.js` 的 `getDictData`/`getDistrictData` | 勿自写请求 |
| 工具 | `utils/index.js`（防抖/节流/树/格式化） | 先查再写 |
| ElementUI 覆写 | `el-dialog`/`el-drawer`/`el-pagination`/`el-button`/`el-upload`（已在 `@/ElementUI/index.js` 全局覆写） | 直接使用，勿重注册 |

> 判断准则：`package.json` 已声明、`main.js` 已挂载、或 `utils`/`components`/`common` 已提供的，**一律视为内置**，不得当"框架未满足"去询问或引新依赖。

### 放行条件（满足任一才可超框）
1. **用户明确授权**：主动说"用 xxx 库/组件/不限制框架"，视为授权。
2. **框架确实不满足**：经判断无法实现时，**必须先暂停向用户说明**：①为何不满足 ②推荐折中做法 ③列出框架外方案（含成本/体积/维护影响），**交用户拍板**后才动手。用户明确同意前，不得擅自 `npm install` 或写框架外代码。

### 禁止行为
- ❌ 擅自引入模板未内置的第三方 UI 库/组件（如另装 antd、vant、自写表格）。
- ❌ 用硬编码绕过模板能力（如手写分页不用 `curd`/`data-table`）。
- ❌ 把"用户没反对"误判为"已授权"——关键决策须显式确认。

> 简言之：**能复用就复用；要超框，要么用户说了算，要么先问清并把推荐摆出来让用户拍板。**
