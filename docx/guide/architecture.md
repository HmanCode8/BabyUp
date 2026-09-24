# 代码架构说明

面向后续接手者，说明「书遥贝贝」小程序的代码怎么分层、请求怎么走、后端怎么切、启动时发生了什么，以及那些踩过坑的约定。

技术栈：uni-app + Vue 3 `<script setup>` + Pinia + Vite，主要发布端是微信小程序（`npm run build:mp-weixin`），H5 可跑但只作兜底（见 `package.json` 的 scripts）。

## 全局图

请求的主干是单向的：页面只跟业务服务层打交道，业务服务层只跟 `src/services/api.js` 打交道，由后者决定底下是云开发还是 Supabase。

```text
src/pages/*.vue（页面）
  │  · 展示与交互
  │  · 读全局状态用 stores/auth.js 的 getters
  │  · 查询/写入调 services/*.js 的业务函数
  ▼
src/services/*.js（业务服务层）
  photo.js / feeding.js / sleep.js / family.js / baby.js / account.js / ai.js ...
  │  · 表名、字段白名单、常量表（枚举、上下限）、上传删除顺序都在这一层
  │  · 统一 import { api } from './api'，不感知后端
  ▼
src/services/api.js（后端切换点）
  │  · 读 src/config/index.js 的 BACKEND
  │  · #ifndef H5 时 active = BACKEND === 'cloud' ? cloud : supabase
  │  · 导出 api / capabilities / backendName / isRecoveryEmailBound
  │
  ├── BACKEND === 'cloud' ─► src/services/cloud/index.js
  │                            ├─ db          → wx.cloud.callFunction('data')  → 云数据库集合
  │                            ├─ auth        → wx.cloud.callFunction('login') → 微信一键登录
  │                            ├─ functions   → wx.cloud.callFunction(<name>)  → 云函数
  │                            ├─ storage     → wx.cloud.uploadFile 上传；
  │                            │                换链接/删文件走 data 云函数代理
  │                            └─ ai          → wx.cloud.extend.AI（模型直调，仅云开发有）
  │
  └── 其他（含 H5） ────────► src/services/supabase/index.js
                               ├─ db          → PostgREST   /rest/v1/<table>
                               ├─ auth        → GoTrue      /auth/v1/*
                               ├─ storage     → Storage     私有桶 baby-photos，走 signed URL
                               └─ functions   → Edge Functions
                                                wechat-login / phone-login /
                                                export-data / delete-account

支撑物：
  src/cloudfunctions/     微信云函数源码（data / login / export-data / delete-account / init-db / reminder / feeding-reminder）
  supabase/migrations/    Supabase 建表与 RLS 策略 SQL
  supabase/functions/     Supabase Edge Functions 源码
```

## 分层职责

| 层 | 位置 | 放什么 | 禁止 |
| --- | --- | --- | --- |
| 页面 | `src/pages/` | 模板与交互、`onShow` 里的权限校验与按需刷新、调用业务服务函数、读写 store | 不直接调 `wx.cloud.*`；不 import `@/services/cloud/*` 或 `@/services/supabase/*`；不自己拼表名与 SQL 式查询（`api.db` 只在服务层用） |
| 组件 | `src/components/` | 可复用的展示/交互组件（`AppTabBar`、`PhotoComposer`、`VaccineItem`、`FamilyOrbit`、`PagePlaceholder`） | 不承担页面级路由与权限判断 |
| 业务服务层 | `src/services/*.js` | 表名与字段、业务语义（如照片「先传文件再插记录」的顺序）、枚举与上下限常量、跨模块聚合（如 `ai.js` 汇总各记录模块） | 不出现平台判断（`#ifdef MP-WEIXIN` 这类只在 `services/cloud/` 里）；不抛非 `ApiError` 的错误 |
| 后端切换点 | `src/services/api.js` | 唯一读取 `BACKEND` 的地方、唯一的平台条件编译回落、导出 `api` / `capabilities` / `backendName` | 不写任何具体业务逻辑 |
| 后端实现层 | `src/services/cloud/`、`src/services/supabase/` | 两套「同形」实现，导出结构一致：`project` / `capabilities` / `auth` / `functions` / `session` / `db` / `storage`（cloud 另有 `ai`） | 不被页面直接引用；两侧导出的方法名与签名必须保持同形 |
| 云函数 / Edge Functions | `src/cloudfunctions/`、`supabase/functions/` | 服务端逻辑（登录换 openid、导出、注销、定时提醒等） | 前端密钥（`service_role`、数据库密码、AppSecret）只存在于这一侧 |
| 全局状态 | `src/stores/` | 登录态、家庭/宝宝上下文、角色权限 getters | 不直接查库，一律经 `services/*.js` |
| 工具 | `src/utils/` | 无状态工具：日期、月龄、路由守卫、tabBar 状态、分享、埋点、隐私、订阅、媒体、语音 | 不持有业务实体，不发业务请求（`utils/tracker` 的上报除外，且全程静默降级） |

「同形」具体长什么样，可比对两份实现：

- `src/services/cloud/index.js`
- `src/services/supabase/index.js`

两者都导出 `project` / `capabilities` / `auth` / `session` / `db` / `storage` / `functions` / `ApiError`。云开发版额外导出 `ai`，且 `src/services/cloud/index.js` 复用了 Supabase 侧的 `ApiError`（`../supabase/http`）与登录态读写（`../supabase/session`）——登录态是本地存储、与后端无关，所以不重复实现。

## 后端切换点

### 改哪个常量

只有一处：`src/config/index.js` 的 `BACKEND`（当前值 `'cloud'`，即微信云开发）。

```js
// src/config/index.js
export const BACKEND = 'cloud'
```

注释里写明的约束：默认值在「阶段 7 决策（2026-09-21）」定为 `'cloud'`；Supabase 版实现永远保留，整体回滚只需把它改回 `'supabase'`，不用动其他任何代码。

### `api.js` 怎么选后端

```js
// src/services/api.js
import { BACKEND } from '@/config'
import { supabase } from './supabase'
import { cloud } from './cloud'

let active = supabase
// H5 平台没有 wx.cloud，无论 BACKEND 配成什么都强制走 Supabase，
// 保证网页端不被云开发方案破坏。
// #ifndef H5
active = BACKEND === 'cloud' ? cloud : supabase
// #endif

/** 当前生效的数据层客户端 */
export const api = active
```

要点：先默认 `supabase`，再用 `#ifndef H5` 覆盖。于是 H5 端无论 `BACKEND` 配成什么，都停在 Supabase 上——这就是「H5 强回落」。

### `capabilities` 的作用

页面据此隐藏后端不支持的入口，而不是自己判断 `BACKEND`：

```js
// src/services/api.js
export const capabilities = active.capabilities
```

两套后端的能力开关对照（源码位置：`src/services/cloud/index.js`、`src/services/supabase/index.js`）：

| 能力 | cloud | supabase | 用途 |
| --- | --- | --- | --- |
| `phoneLogin` | `false` | `true` | 手机号账号密码登录入口 |
| `emailRecovery` | `false` | `true` | 邮箱找回密码入口 |
| `emailBinding` | `false` | `true` | 绑定真实邮箱入口 |
| `wechatLoginCode` | `false` | `true` | 微信登录前是否需前端 `uni.login` 换 code |
| `aiChat` | `true` | `false` | AI 助手入口 |

实际用法举例：`src/pages/login/login.vue`、`src/pages/account/account.vue`、`src/pages/profile/profile.vue`、`src/pages/ai-chat/ai-chat.vue` 都从 `@/services/api` import `capabilities`，用 `v-if` 控制入口显隐。

关键约束（`api.js` 注释原文）：取的是 `active.capabilities` 而非按 `BACKEND` 分支——H5 端会被强制回落 Supabase，能力判断必须与真正生效的后端一致。因此 `cloud/auth.js` 里被禁用方法调用即抛 `NOT_SUPPORTED`，`src/services/ai.js` 的 `isAiChatAvailable()` 也以 `capabilities.aiChat` 为准。

`backendName`（`'supabase' | 'cloud'`）只用于文案与日志区分，注释明确写了「勿用作业务分支」。

## 目录导览

`src/` 下的目录职责：

| 目录 | 放什么 | 举例文件 |
| --- | --- | --- |
| `src/pages/` | 全部页面，一页一目录；页面路径在 `src/pages.json` 注册 | `pages/index/index.vue`、`pages/record/record.vue`、`pages/ai-chat/ai-chat.vue` |
| `src/components/` | 跨页复用组件 | `components/AppTabBar/index.vue`、`components/PhotoComposer/index.vue` |
| `src/services/` | 业务服务层（与后端无关的语义层） | `services/photo.js`、`services/feeding.js`、`services/family.js`、`services/ai.js` |
| `src/services/cloud/` | 云开发后端实现 | `cloud/index.js`、`cloud/db.js`、`cloud/storage.js`、`cloud/ai.js`、`cloud/init.js` |
| `src/services/supabase/` | Supabase 后端实现 | `supabase/index.js`、`supabase/db.js`、`supabase/auth.js`、`supabase/http.js`、`supabase/session.js` |
| `src/stores/` | Pinia 全局状态 | `stores/auth.js`（当前唯一 store） |
| `src/utils/` | 无状态工具 | `utils/routeGuard.js`、`utils/tabbar.js`、`utils/date.js`、`utils/age.js`、`utils/tracker.js` |
| `src/config/` | 项目级常量与安全边界 | `config/index.js` |
| `src/cloudfunctions/` | 微信云函数源码（另有 `supabase/functions/`） | `cloudfunctions/data/index.js`、`cloudfunctions/login/index.js` |
| `src/static/` | 图片等静态资源 | `static/tabbar/time.png`、`static/avatar/male.png` |

⚠️ 未确认：任务描述里提到的 `src/services/index.js` 在仓库中不存在，服务层的统一入口只有 `src/services/api.js`。

## 启动链路

### `src/main.js`

`createApp()` 用 `createSSRApp` 建应用、挂 Pinia，并注册 Vue 运行时异常上报：

```js
// src/main.js
app.config.errorHandler = (err, instance, info) => {
  console.error('[App] 未捕获的组件异常', info, err)
  trackError('vue_error', err)
}
```

### `src/App.vue` 的 `onLaunch`

按源码顺序：

1. `initCloud()` —— 见 `src/services/cloud/init.js`，内部 `#ifdef MP-WEIXIN`，H5 上是空操作；`wx.cloud.init` 用 `config` 的 `CLOUD_ENV_ID`，且幂等。
2. `hideNativeTabBar()` —— `uni.hideTabBar({ animation: false })`。
3. `installRouteGuard(store)` —— 给 `navigateTo` / `redirectTo` / `switchTab` / `reLaunch` 挂拦截器。
4. `loadSubscribeStatus()` —— 预热订阅状态缓存，失败只记日志。
5. `readInviteFromLaunch(options)` —— 读启动链接里的邀请码。
6. `await store.bootstrap()` —— 恢复登录态并拉家庭上下文。
7. `decideRedirect(store, launchPageOf(options))` —— 按「启动时打开的那个页面」算改道目标。
8. 视情况 `rememberInviteCode` / `forgetInviteCode`，最后 `redirectTo(target)`。

`launchPageOf` 会把 `options.path` 去掉 `?` 后截断，取不到时按 `pages/index/index` 处理。

### `App.vue` 的 `onShow`

首次 `onShow` 与 `onLaunch` 里的 `bootstrap` 同一时刻，用模块级 `shownOnce` 跳过避免重复请求；之后每次回到前台，若已初始化且已登录，调 `store.refreshContextIfStale()`（store 内有 30s 冷却，见 `CONTEXT_REFRESH_TTL`）。

### 页面 `onShow` 的约定

以 `src/pages/index/index.vue` 为例：

```js
// src/pages/index/index.vue
onShow(async () => {
  ensurePageAccess(PAGE_PATH)
  // 同步自定义底栏的高亮（底栏组件见 components/AppTabBar）
  syncActiveTabFromRoute()
  // 冷启动时 onShow 会早于 bootstrap 完成，这里确保家庭/宝宝上下文已就绪
  await store.bootstrap()
  // 数据没变就复用上次结果 ...
  if (!contextKey()) return
  if (shouldReload()) await loadPage({ reset: true })
  // AI 观察：跟照片用同一套 TTL 复用
  await loadInsight()
})
```

约定拆开看：

- 受保护页在 `onShow` 调 `ensurePageAccess(页面路径常量)`（绝大多数页面都定义了 `PAGE_PATH`）。
- tab 页额外调 `syncActiveTabFromRoute()` 同步自定义底栏高亮。
- 需要家庭/宝宝上下文的页面再 `await store.bootstrap()`（幂等，冷启动兜底）。
- 数据刷新自己做 TTL/脏标记判断，不要每次进页都全量重拉。

### store 初始化

`src/stores/auth.js` 的 `bootstrap()` 是幂等的（`if (this.initialized) return`）：从 `api.session.get()` 取登录态，登录了就 `loadFamilyContext()`，`finally` 里置 `initialized = true`。

`loadFamilyContext()` 的顺序是：`listMyMemberships` → `listFamiliesByIds` → 决定当前家庭 → `loadBabies` → `loadMembers` → `loadBabyAvatar`。本地保存的家庭/宝宝若已失效会自动回退到第一个；`currentFamilyId` / `currentBabyId` 的选择持久化在 `SELECTION_STORAGE_KEY`。

## 关键约定与坑

- **自定义 tabBar 与原生 tabBar 并存**：`src/pages.json` 里保留完整的原生 `tabBar` 配置，但底栏实际由 `src/components/AppTabBar/index.vue` 渲染（带凹槽与凸起的 AI 按钮），启动时用 `uni.hideTabBar()` 把原生那条收起。组件注释写明了原因：uni-app 不会把微信原生 `custom-tab-bar` 目录下的 vue 文件编译成小程序需要的 js/json/wxml/wxss，整条底栏会直接不渲染（已实测），所以不用 `custom: true`，改用普通 Vue 组件接管底部。
- **`uni.hideTabBar()` 只在启动时调一次**：它的显隐是全局的，放到每个 tab 页的 `onShow` 会每次切换都闪一下。H5 上也要一起隐藏——那边框架同样会渲染一条，不隐藏就是两条底栏。
- **底栏高度两处同步**：`src/App.vue` 的 CSS 变量 `--tabbar-height: 130rpx` 与 `src/utils/tabbar.js` 的 `TAB_BAR_HEIGHT = 130`（CSS 读不到 JS 常量），改高度时两处一起改。
- **tab 高亮用模块级 `ref`，不是 `page.getTabBar().setData()`**：编译成小程序后拿不到稳定的 `getTabBar` 实例，页面与 tabBar 组件是两棵组件树；小程序里 JS 模块全局缓存，两边 import 到的是同一个 `ref`。`src/utils/tabbar.js` 的 `syncActiveTabFromRoute()` 按路由反查下标，所以调整 tab 顺序时不用改四个页面。
- **条件编译写在 `.js` 的 `//` 注释里也生效**：`src/services/api.js`（`// #ifndef H5`）、`src/services/cloud/init.js`（`// #ifdef MP-WEIXIN`）、`src/services/cloud/db.js`、`src/services/cloud/functions.js` 都用了这种写法。`cloud/` 侧在非 mp-weixin 平台被调用会抛 `CLOUD_UNAVAILABLE`，但正常路径上有 `api.js` 的 H5 回落挡在前面。
- **路由守卫的用法**：`src/utils/routeGuard.js` 页面对分五类——公开页（`PUBLIC_PAGES`：login / forgot-password）、免登录页（`OPEN_PAGES`：privacy / terms）、引导页（`GUIDE_PAGES`：setup / join-family，登录即可停留）、受保护页（需登录 + 已有家庭）、以及应用声明首页 `ENTRY_PAGE = 'pages/index/index'`。页面侧只需在 `onShow` 调 `ensurePageAccess(path)`；它内部做 `redirectTo(decideRedirect(...))`，并顺带 `store.refreshContextIfStale()`（不 `await`，静默刷新）。
- **引导页必须豁免改道**：否则会「自我改道」——还没建家庭的用户被送到 `/pages/setup/setup` 后，若对同一路径仍返回该路径，导航拦截器会误判为需要改道而取消这次导航，表现为注册/登录成功后卡在登录页。
- **`redirectTo` 的 `redirectInFlight` 兜底**：同一时刻只发一次 `reLaunch`；因为导航被拦截器取消时 `complete` 不一定触发，所以额外用 `setTimeout(..., 1000)` 解锁。否则一次被取消的导航会让之后所有改道被静默丢弃（页面再也跳不动）。
- **更新一律走 `upsert`，没有 `update`**：小程序 `uni.request` 支持的 method 里没有 `PATCH`，而 PostgREST 的部分更新走的正是 PATCH，因此 `src/services/supabase/db.js` 不提供 `update()`，更新统一 upsert 提交完整行（`src/services/cloud/db.js` 与之同形）。调用方要用 `api.db.pickColumns` 只保留真实存在的列——把前端算出来的 `url` 这类字段整行提交会被 PostgREST 拒绝（`PGRST204`）。
- **云存储的路径与文件 ID**：业务表里存的始终是相对路径（形如 `familyId/babyId/unique.jpg`），只在调用 `wx.cloud` 存储接口前由 `src/services/cloud/storage.js` 拼上 `src/config/index.js` 的 `CLOUD_FILE_ID_PREFIX`。该前缀留空则所有云存储调用直接抛 `STORAGE_NOT_CONFIGURED`，不静默失败。上传在客户端做（`wx.cloud.uploadFile`），换链接与删文件走 `data` 云函数代理——客户端调用受云存储安全规则约束，权限不是「公有读」时家人之间会互相看不到照片。
- **云开发不直连数据库**：客户端不直连集合，读写全部走通用云函数 `data`，因为云开发安全规则只认 `_openid`，做不了「必须是某家庭 active 成员」这类跨集合校验。集合里的 `_id` 由云函数透明映射成客户端看到的 `id`。
- **`capabilities` 判断要与真正生效的后端一致**（用 `active.capabilities`，不能按 `BACKEND` 分支），原因见上文「后端切换点」。
- **改 `APP_NAME` 要手动同步两处 JSON**：`src/manifest.json` 的 `name` 与 `src/pages.json` 的 `globalStyle.navigationBarTitleText`（JSON 读不到 JS 常量）。但 `SESSION_STORAGE_KEY`（`babyup.session`）与邮箱域名（`phone.babyup.app`）不要顺手改——会让老用户登录态丢失、老账号找不回。
- **云函数目录要在 Vite 里补一刀**：`vite.config.js` 的 `copyCloudFunctions` 插件把 `src/cloudfunctions` 拷进小程序产物；`manifest.json` 的 `cloudfunctionRoot` 只会透传成产物的 `project.config.json` 字段，uni-app 自己不会拷贝，不补的话微信开发者工具打开 dist 看不到云函数。
- **AI 助手只在微信小程序 + 云开发后端可用**：实现走 `wx.cloud.extend.AI`（要求基础库 >= 3.15.1），Supabase 版 `capabilities.aiChat` 恒为 `false`，`src/services/ai.js` 的 `isAiChatAvailable()` 以它为准；`AppTabBar` 的 AI 按钮在不可用时只弹提示，不跳转。AI 对话历史与每日小结缓存在本机（`uni.getStorageSync`），不上云。
- **登录态是本地存储、与后端无关**：`SESSION_STORAGE_KEY = 'babyup.session'`，云开发版复用 `src/services/supabase/session.js` 的读写实现。
- **退出登录故意不清本地家庭/宝宝选择**：一个用户可能同时属于多个家庭（先自建再被邀请加入），清空会让用户误以为「被退出家庭」；换账号登录也安全，因为那家的 id 不在新账号的成员关系里，会自动回退到第一家。
- **AI 上下文会带上宝宝记录**：喂养/睡眠/便便/生病/生长/疫苗/体检/里程碑会作为上下文发给大模型；当前是「只给家人用、不公开发布」的自用形态，注释写明若将来对外需先在 `src/services/ai.js` 加一层脱敏。

⚠️ 未确认：`src/cloudfunctions/` 下的 `init-db`、`reminder`、`feeding-reminder` 三个云函数的具体职责未逐一读源码确认（本文只列出目录存在），如需了解请直接看各自 `index.js`。

## 延伸阅读

- [快速开始](./quick-start.md)
- [数据模型](./data-model.md)
- [功能清单](./features.md)
- [后端说明](../backend/README.md)
- [AI 助手说明](../ai/README.md)
