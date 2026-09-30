# 功能地图

本页回答三个问题：**这个产品有哪些功能、分别在哪个页面、走哪条数据链路。**

- 页面清单唯一来源：`src/pages.json`（共注册 **36** 个页面，其中 4 个是 tab 页）。页面文件位于 `src/pages/<name>/<name>.vue`。
- 后端：`src/config/index.js` 的 `BACKEND` 当前为 `'cloud'`（微信云开发）；Supabase 版实现保留，通过 `src/services/api.js` 统一切换。**AI 相关功能只在云开发后端可用**（`capabilities.aiChat`，见 `src/services/cloud/index.js` 与 `src/services/supabase/index.js`）。
- 数据表名以代码里实际的 `api.db.select/insert/upsert/remove('表名')` 为准（见 `src/services/*.js`）。
- 相关文档：[`./architecture.md`](./architecture.md)、[`./data-model.md`](./data-model.md)、[`../ai/README.md`](../ai/README.md)、[`../product/phase1.md`](../product/phase1.md)、[`../backend/README.md`](../backend/README.md)

---

## 1. 功能总览表

| 功能模块 | 一句话说明 | 入口页面 | 依赖的服务层文件 |
| --- | --- | --- | --- |
| 登录与账号 | 微信一键登录 / 手机号登录注册（仅 Supabase 后端） | `src/pages/login/login.vue` | `src/stores/auth.js`、`src/services/api.js` |
| 找回密码 | 输入绑定邮箱发重置邮件 | `src/pkg/forgot-password/forgot-password.vue` | `src/stores/auth.js` |
| 账号与安全 | 绑定真实邮箱、导出全部数据、注销账号 | `src/pkg/account/account.vue` | `src/pkg/services/account.js`、`src/services/api.js` |
| 合规文档 | 隐私政策、用户协议（静态文案，未登录可看） | `src/pages/privacy/privacy.vue`、`src/pages/terms/terms.vue` | 无（纯静态） |
| 创建家庭 | 建家庭 → 建宝宝档案两步引导 | `src/pages/setup/setup.vue` | `src/services/family.js`、`src/services/baby.js` |
| 加入家庭 | 输入 6 位邀请码加入（也支持分享链接带入） | `src/pages/join-family/join-family.vue` | `src/services/family.js` |
| 家庭成员管理 | 邀请码生成/撤销、改角色、改昵称、移除成员、退出家庭 | `src/pkg/family/family.vue` | `src/services/family.js` |
| 家庭/宝宝切换 | 一个用户多家庭、一个家庭多宝宝的选择与切换 | `src/pages/profile/profile.vue` | `src/stores/auth.js` |
| 宝宝档案 | 昵称、生日、性别、头像的编辑与新增 | `src/pkg/baby-edit/baby-edit.vue` | `src/services/baby.js` |
| 时光相册 | 照片/视频上传、文件夹（相册）分类、按月分组或瀑布流浏览、片家人环绕动画 | `src/pages/index/index.vue` | `src/services/photo.js`、`src/services/ai-insight.js` |
| 照片详情 | 大图/视频查看、改拍摄时间、**改所在文件夹**、改备注、删除 | `src/pkg/photo-detail/photo-detail.vue` | `src/services/photo.js` |
| 日常记录入口 | 今日小结 + 九宫格记录项（喂养/睡眠/便便/生长/疫苗/里程碑/生病/体检/照片） | `src/pages/record/record.vue` | `src/services/summary.js`、`src/services/feeding.js` |
| 喂养记录 | 母乳/配方奶/辅食/水的记录与今日列表 | `src/pkg/feeding-edit/feeding-edit.vue` | `src/services/feeding.js` |
| 睡眠记录 | 入睡/醒来/正在睡、结束睡眠 | `src/pkg/sleep-edit/sleep-edit.vue` | `src/services/sleep.js` |
| 便便记录 | 尿/便/混合 + 性状 + 颜色（异常色提示） | `src/pkg/diaper-edit/diaper-edit.vue` | `src/services/diaper.js` |
| 生长记录 | 身高/体重/头围折线图 + 录入与历史 | `src/pkg/growth/growth.vue` | `src/services/growth.js` |
| 疫苗记录 | 待办/已接种、疫苗推荐库、一键排期、微信提醒 | `src/pkg/vaccine/vaccine.vue` | `src/services/vaccine.js`、`src/pkg/services/vaccine-library.js` |
| 喂奶提醒 | 按宝宝月龄算间隔上限、订阅消息推送设置 | `src/pkg/feeding-reminder/feeding-reminder.vue` | `src/services/feeding.js`、`src/utils/subscribe.js` |
| 成长里程碑 | 预设/自定义里程碑时间线，可带照片 | `src/pkg/milestone/milestone.vue`、`src/pkg/milestone-edit/milestone-edit.vue` | `src/services/milestone.js` |
| 生病记录 | 症状/体温/用药/就诊/照片 | `src/pkg/illness/illness.vue`、`src/pkg/illness-edit/illness-edit.vue` | `src/services/illness.js` |
| 儿保体检 | 体检记录 + 体格测量同步到生长记录 | `src/pkg/checkup/checkup.vue`、`src/pkg/checkup-edit/checkup-edit.vue` | `src/services/checkup.js`、`src/services/growth.js` |
| 今日/每日小结 | 实时聚合当日数据、历史每日卡片与增减对比 | `src/pages/record/record.vue`、`src/pkg/daily/daily.vue` | `src/services/summary.js` |
| 成长报告 | 月度/年度报告生成分享图并保存相册 | `src/pkg/report/report.vue` | `src/pkg/services/report.js` |
| AI 照护助手 | 结合宝宝记录流式问答，附「依据」小字 | `src/pkg/ai-chat/ai-chat.vue` | `src/services/ai.js`、`src/services/parenting-knowledge.js` |
| AI 一句话记一笔 | 自然语言解析成六类记录，确认后写库 | `src/pkg/ai-quick-record/ai-quick-record.vue` | `src/services/ai.js` |
| AI 每日小结 | 当日记录让 AI 写一段小结，可复制/重新生成 | `src/pages/record/record.vue` | `src/services/ai.js` |
| AI 首页观察 | 规则判断出一条值得留意的事（不是模型） | `src/pages/index/index.vue` | `src/services/ai-insight.js` |
| 辅食资料库 | 按月龄/食材筛选食谱，看食材、做法、注意点 | `src/pkg/solid-food/solid-food.vue`、`src/pkg/solid-food-detail/solid-food-detail.vue` | `src/pkg/services/solid-food.js` |
| 育儿工具页 | 查/看/设置类入口的聚合页（含疫苗与喂奶实时状态） | `src/pages/tools/tools.vue` | `src/services/vaccine.js`、`src/services/feeding.js` |
| 意见反馈 | 提交反馈（可带截图）、查看自己提交过的，以及管理员写的一句回复 | `src/pkg/feedback/feedback.vue` | `src/pkg/services/feedback.js` |
| 新手引导 | 六屏功能介绍（记录 / AI / 时光 / 工具 / 提醒 / 家人），可随时回看 | `src/pkg/onboarding/onboarding.vue` | `src/components/OnboardingGuide/index.vue` |
| 会员 | 会员权益对照 + 开通码兑换（按家庭开通，创建者操作）；会员制未上线时只显示状态卡 | `src/pkg/membership/membership.vue` | `src/services/membership.js`、`src/services/cloud/membership.js` |
| 运维后台 | 站内管理：运维概览 / 家庭与权限 / 成员与管理员 / 意见反馈（仅超级管理员） | `src/pkg/admin/admin.vue` | `src/services/cloud/admin.js`、`src/services/flags.js` |

---

## 2. 按页面组织的功能清单

### 2.1 时光 Tab

#### `pages/index/index` — 导航栏标题「时光」（tab 页）

- 顶部宝宝信息头：点整块弹出「守护家人」环绕动画（成员取自 `store.members`，不再发请求）。
- 「AI 观察」卡片：规则算出的观察文案，点击带问题跳到 AI 助手（`?q=` 预填输入框）。
- 顶部幻灯片：进入本页自动轮播最近 6 条媒体（视频显示封面；原先取 20 条，弱网下首屏要等一串大图）。
- 照片墙三种视图，**从左到右依次是 `全部`（三列瀑布流，按原图比例）/ `按月`（三列方格，本地时区归月）/ `文件管理`（相册，见下）**。视图选择存本机 `babyup.timelineView`，默认仍是「按月」。
  - 切换视图只改了标签顺序与「文件管理」这个名字，底层的 `key` 仍是 `all` / `month` / `album`，所以老用户存下来的偏好不需要迁移。
- **「文件管理」视图是两级的**：第一层列文件夹（缩略图 + 名字 + 张数）+ 固定的「未分类」入口 + 「+ 新建文件夹」；点进去才是那一叠照片（三列方格，顶部标题条左侧是「‹ 文件管理」返回，右上角「多选」）。
  - 长按文件夹行 → 进入排序模式，上下拖动调整顺序（`sort_order`），松手即落库；点「完成」退出。拖动的目标位置按「手指位移 ÷ 行高」算，行高常量 `ALBUM_ROW_RPX` 必须与样式里 `.album-row` 的 height 一致。
  - 文件夹行右侧「⋯」→ 重命名 / 删除。**删除时明确提示「里面的 N 张照片不会被删除，会回到未分类」**（服务端也是这么做的）。
  - 长按照片 → 直接弹「移动到…」；多选后底部操作条也能「移动到…」/「移出文件夹」。弹层是自绘的，因为 `uni.showActionSheet` 最多只列 6 项而文件夹上限 50。
- 悬浮「+」按钮：可拖动换位，轻点弹「照片（可多选）/ 视频」，位置存本机 `home_fab_pos`；多选模式下自动收起。
- 下拉刷新、触底加载更多（每页 20 条，`CACHE_TTL` 30 分钟复用上次结果）。

| 项 | 内容 |
| --- | --- |
| 读写数据 | 读 `baby_photos`（分页 + 覆盖只写权限）；读 `photo_albums`（文件夹清单）并为每个文件夹统计张数与封面（`summarizeAlbums`）；读喂养/睡眠/便便/疫苗（只经 `ai-insight` 聚合） |
| 依赖组件 | `src/components/PhotoComposer/index.vue`、`src/components/FamilyOrbit/index.vue`、`src/components/AppTabBar/index.vue` |
| 关键变量 | `canWrite`（`src/pages/index/index.vue`，来自 `store.canWrite`，控制 `PhotoComposer`、「+」与文件夹编辑入口是否渲染） |

### 2.2 记录 Tab

#### `pages/record/record` — 导航栏标题「记录」（tab 页）

- 「今日小结」卡：实时聚合当日喂养/睡眠/便便/照片/生长/疫苗，可展开当日明细时间线。
- 喂奶提醒横幅：宝宝开启提醒且距上次喂养超过间隔上限时置顶提示。
- 「生成分享图」：把今日小结画成 canvas 卡片，可保存到相册或转发给家人。
- 「AI 小结」：让 AI 说一句今天怎么样，可复制/重新生成，同一天只成功生成一次（本机缓存）。
- 「一句话记一笔」入口：仅 `canWrite && aiReady` 时渲染。
- 九宫格记录项（9 项）+ 右侧「记录项」工具栏：本机开关控制显示哪些，存 `babyup.recordEntryHidden`。
- 下拉刷新：重新聚合今日小结与 AI 观察（`src/pages.json` 里本页开了 `enablePullDownRefresh`）。刻意**不**在这里补生成 AI 小结 —— 那要花模型额度，且一天只补一次。
- 首次进入的轻引导（`babyup.recordGuideSeen`，只显示一次）；只读成员显示只读说明卡。

| 项 | 内容 |
| --- | --- |
| 读写数据 | 读 `feeding_records`/`sleep_records`/`diaper_records`/`baby_photos`/`growth_records`/`vaccinations`（经 `buildDailySummary`）；写照片经 `PhotoComposer` |
| 依赖组件 | `src/components/PhotoComposer/index.vue`、`src/components/AppTabBar/index.vue` |
| 关键变量 | `canWrite`、`aiReady = isAiChatAvailable()`、`visibleEntries` |

#### `pkg/daily/daily` — 导航栏标题「每日小结」

- 每天一张卡：喂养/配方奶/母乳/睡眠/尿布 五项指标，右侧显示与前一天相比的增减。
- 点日期行展开当日明细时间线（喂养/睡眠/便便按时间正序合成一条）。
- 「查看更早的小结」每次多取 7 天，最多回看 31 天（受单次查询 500 条上限约束）。

| 项 | 内容 |
| --- | --- |
| 读写数据 | 读 `feeding_records`/`sleep_records`/`diaper_records`（经 `buildDailySummaries`），不写 |
| 依赖组件 | 无 |

#### 记录项对应的表单页

| 页面 | 标题 | 能做什么 | 读写数据 |
| --- | --- | --- | --- |
| `src/pkg/feeding-edit/feeding-edit.vue` | 喂养记录 | 选母乳/配方奶/辅食/水，填数量或时长、时间、备注；今日记录列表可编辑删除；保存时顺带攒一条提醒订阅额度 | 读/写 `feeding_records` |
| `src/pkg/sleep-edit/sleep-edit.vue` | 睡眠记录 | 记入睡/醒来时间，支持「正在睡」与弹层「结束睡眠」；最近 20 条可编辑删除 | 读/写 `sleep_records` |
| `src/pkg/diaper-edit/diaper-edit.vue` | 便便记录 | 选类型（尿/便/混合）、性状、颜色；红/黑颜色给出咨询医生提示（不阻断保存） | 读/写 `diaper_records` |
| `src/pkg/growth/growth.vue` | 生长记录 | uCharts 折线图（体重/身高/头围切换，可点看数值）；录入与编辑历史；`?mode=entry` 进入自动展开表单 | 读/写 `growth_records` |
| `src/pkg/vaccine/vaccine.vue` | 疫苗记录 | 待办/已接种分区；从疫苗推荐库添加；「按出生日期生成计划」批量排期；标记已接种；微信订阅提醒开启状态 | 读/写 `vaccinations`，读 `vaccine_library` |
| `src/pkg/milestone/milestone.vue` | 成长里程碑 | 里程碑时间线（倒序，带照片、备注、记录人）；可编辑/删除 | 读 `milestones`（删除经 `removeMilestone`） |
| `src/pkg/milestone-edit/milestone-edit.vue` | 里程碑打卡 | 预设 8 类 + 自定义名称、日期、照片、备注；先传文件再写库，失败清理孤儿文件 | 读/写 `milestones` + 对象存储 |
| `src/pkg/illness/illness.vue` | 生病记录 | 列表（症状、体温、用药摘要、就诊、照片缩略图）；可编辑/删除 | 读 `illness_records` |
| `src/pkg/illness-edit/illness-edit.vue` | 记录生病 | 发病时间、症状多选、体温、多行用药、医院/医生/诊断、过敏反应、最多 N 张照片、备注 | 读/写 `illness_records` + 对象存储 |
| `src/pkg/checkup/checkup.vue` | 儿保体检 | 列表（身高/体重/头围/血红蛋白、发育评估、医生建议、「距下次体检还有 N 天」）；删除时可选择是否连带删除关联生长记录 | 读 `checkup_records` |
| `src/pkg/checkup-edit/checkup-edit.vue` | 记录体检 | 体检日期 + 自动月龄；体格测量（填了身高/体重会同步一条生长记录）；体检机构、发育评估、医生建议、下次体检日期、体检本照片 | 读/写 `checkup_records`（联动 `growth_records`） |
| `src/pkg/photo-detail/photo-detail.vue` | 照片详情 | 大图/视频播放；改拍摄时间（按绝对时刻重存）；改备注；删除 | 读写 `baby_photos` |

### 2.3 工具 Tab

#### `pages/tools/tools` — 导航栏标题「育儿工具」（tab 页）

- 7 张工具卡：辅食资料库、AI 照护助手、生长曲线、成长报告、每日小结、疫苗与提醒、喂奶参考与提醒。
- AI 卡按 `isAiChatAvailable()` 过滤，不可用时整项不渲染。
- 疫苗卡显示实时状态「待接种 N · 已逾期 N」（`loadVaccineBadge`：只取 `id / scheduled_date / vaccinated_date` 三列，窄字段、不排序）。
- 喂奶卡显示「未开启提醒」或「每 X 小时 Y 分」（纯计算，不发请求）。

| 项 | 内容 |
| --- | --- |
| 读写数据 | 读 `vaccinations`（状态）；其余为导航 |
| 依赖组件 | `src/components/AppTabBar/index.vue` |

#### 工具页背后的页面

| 页面 | 标题 | 能做什么 |
| --- | --- | --- |
| `src/pkg/report/report.vue` | 成长报告 | 月度/年度切换 + 周期选择 → 生成报告图（照片九宫格 + 数据卡 + 里程碑 + 品牌落款）→ 保存到相册；支持 `?range=year&period=2026` 直达 |
| `src/pkg/solid-food/solid-food.vue` | 辅食资料库 | 按宝宝月龄默认选档、月龄与食材两组筛选、搜索计数；点进食谱详情 |
| `src/pkg/solid-food-detail/solid-food-detail.vue` | 食谱详情 | 食材、做法步骤、注意点（本地内置数据，`recipeById`） |
| `src/pkg/feeding-reminder/feeding-reminder.vue` | 喂奶参考与提醒 | 本月龄喂养参考 + 近 7 天摄入统计；开关提醒、加减间隔上限（步长 15 分钟）、「恢复月龄推荐」、微信推送订阅状态与最近推送结果 |
| `src/pkg/ai-chat/ai-chat.vue` | AI 照护助手 | 欢迎语 + 快速提问、流式回答、回答下方「依据」、清空对话（对话只存本机） |
| `src/pkg/ai-quick-record/ai-quick-record.vue` | 一句话记一笔 | 文字/语音输入 → AI 解析 → 确认卡（可改每个字段）→ 确认后写库 |

### 2.4 我的 Tab

#### `pages/profile/profile` — 导航栏标题「我的」（tab 页）

- 当前宝宝卡（点头像切换宝宝）与当前家庭卡（点击切换家庭）。
- 「编辑宝宝档案」「添加宝宝」（`canWrite` 时才渲染）。
- 「家庭」入口 → 家庭成员页，右侧显示我的角色。
- 会员卡：**会员制上线后**（`membershipState.enabled` 由服务端下发）才渲染，点进 `pkg/membership/membership`。
- 账号卡：账号与安全、数据与备份、意见反馈。
- 「帮助与法律」卡：隐私政策、用户协议、新手引导（→ `pkg/onboarding/onboarding`）；底部退出登录（二次确认）。
- 运维卡：仅 `capabilities.admin && isSuperAdmin()` 为真时渲染，点进 `pkg/admin/admin`（前端藏入口只是 UX，真门在云函数）。
- 选择宝宝 / 选择家庭的底部弹层，含「创建新家庭」「加入已有家庭」。

| 项 | 内容 |
| --- | --- |
| 读写数据 | 读 `family_members`/`families`/`babies`（经 `store`）；改名等写操作在子页面 |
| 依赖组件 | `src/components/AppTabBar/index.vue` |
| 关键变量 | `canWrite`、`isOwner`、`adminVisible`、`membershipState.enabled`、`accountValue`（后端能力决定显示「微信账号 / 已绑定邮箱 / 未绑定邮箱」） |

### 2.5 登录、引导与账号

| 页面 | 标题 | 能做什么 | 依据文件 |
| --- | --- | --- | --- |
| `src/pages/login/login.vue` | 登录 | 微信一键登录（`#ifdef MP-WEIXIN`）；`capabilities.phoneLogin` 时显示手机号注册/登录与忘记密码；首次登录弹协议确认层；登录后优先回到分享带来的邀请码 | `src/stores/auth.js`、`src/utils/legal.js` |
| `src/pkg/forgot-password/forgot-password.vue` | 找回密码 | 输入绑定邮箱发送重置邮件；输入手机号时给出绑定引导 | `src/stores/auth.js` |
| `src/pages/setup/setup.vue` | 开始使用 | 第一步建家庭（或跳「加入已有家庭」），第二步建宝宝档案（昵称/生日/性别，可跳过） | `src/services/family.js`、`src/services/baby.js` |
| `src/pages/join-family/join-family.vue` | 加入家庭 | 输入 6 位邀请码加入，大写归一并过滤非法字符；从分享链接 `?code=` 带入 | `src/services/family.js` |
| `src/pkg/family/family.vue` | 家庭成员 | 家庭改名（仅 owner）、按角色/有效期生成邀请码并复制/分享、改我的昵称、成员列表改角色/移除、邀请码记录与撤销、退出家庭（owner 不可退出） | `src/services/family.js` |
| `src/pkg/baby-edit/baby-edit.vue` | 宝宝档案 / 添加宝宝 | 选头像、昵称、生日、性别；新增模式 `?mode=create`；头像先建宝宝再传到 `{family}/{baby}/avatar` 并回写 | `src/services/baby.js` |
| `src/pkg/account/account.vue` | 账号与安全 | 展示账号类型与找回邮箱绑定状态；绑定真实邮箱（需点邮件确认，可手动刷新）；导出全部数据（小程序写沙箱并转发/ H5 下载）；照片备份（**仅微信小程序**：选范围 → 逐张下载写入相册，可中断）；注销账号（双确认，必须输入「删除」） | `src/pkg/services/account.js`、`src/services/photo.js` |
| `src/pages/privacy/privacy.vue` | 隐私政策 | 静态六节文案（2026-09-28 按「只保留微信一键登录」校正过收集范围，并补了剪贴板声明）；底部展示开发者名称与联系方式（书遥贝贝开发者 / 邮箱 / 微信） | 纯静态 |
| `src/pages/terms/terms.vue` | 用户协议 | 静态六节文案（同日校正过账号规则）；底部同样的联系方式 | 纯静态 |
| `src/pkg/onboarding/onboarding.vue` | 新手引导 | 六屏功能导览（记录 → AI → 时光 → 工具 → 提醒 → 家人），看完原路返回；本页不写「已看过」标记，所以随时能再看 | `src/components/OnboardingGuide/index.vue` |
| `src/pkg/feedback/feedback.vue` | 意见反馈 | 选类型、写描述、可选截图、可选联系方式；下方列出「我的反馈」及处理状态，已处理的会显示管理员写的一句回复 | `src/pkg/services/feedback.js` |

### 2.6 会员与运维后台

#### `pkg/membership/membership` — 导航栏标题「会员」

- 顶部状态卡：会员制**没上线**时这里也是唯一的内容。
- 会员制上线后（`state.enabled` 由服务端下发）多出两张卡：
  - 权益对照表：数字全部来自服务端（`data` 云函数的 `MEMBERSHIP_PLANS`），前端不写死；只有 AI 问答按会员分级。
  - 开通码兑换：按**家庭**开通（一个人开通全家共享），创建者操作；到期时间在原有基础上顺延，不吃掉剩余天数。

| 项 | 内容 |
| --- | --- |
| 读写数据 | 读写 `families` 的 `member_tier` / `member_until`（经 `membershipStatus` / `membershipRedeem`） |
| 依赖文件 | `src/services/membership.js`、`src/services/cloud/membership.js` |

##### 会员制的完整逻辑走向

一句话：**一个开关 + 两档 + 只卡 AI**。开关和档位判定全在服务端的 `data` 云函数里，前端只负责显示。

```text
MEMBERSHIP_ENABLED（data 云函数里写死的唯一真源）
   │
   ├─ false ─► 所有人一律按「会员档」：全功能 + AI 50 次/天
   │           前端不渲染任何会员入口（现在的「正常使用」形态）
   │
   └─ true  ─► 按家庭分档，前端出现会员入口与开通流程
                 │
                 ▼
        resolveTier(familyId)   ← 档位的唯一裁决者
                 │
                 ├─ 没传 familyId（还没建家庭） → member
                 ├─ families.member_tier ≠ 'member'      → free
                 ├─ families.member_until 已过期（≤ 现在） → free  ← 只在读时判，不回写库
                 └─ 其余                                 → member
                 │
                 ▼
        两档权益（MEMBERSHIP_PLANS，服务端下发给前端做对照表）
                 │
                 ├─ free    → AI 问答 5 次/天、AI 上下文近 7 天
                 └─ member  → AI 问答 50 次/天、AI 上下文近 30 天
```

**1）只有 AI 问答按档位限额**（它是唯一实打实烧 token 的功能）：

| 功能 | 是否按档位限制 | 说明 |
| --- | --- | --- |
| AI 问答 | ✅ | 免费 5 次/天、会员 50 次/天 |
| AI 明细上下文天数 | ✅ | 免费 7 天、会员 30 天（`contextDays()`） |
| 记录 / 时光 / 工具 / 疫苗 / 辅食 / 报告 / 每日小结 / 一句话记一笔 / 首页观察 | ❌ | 一律不限次 |

额度由 `actionAiUsage` 裁决：**额度按「家庭档位」取，记账按「人」**（`ai_usage` 集合，key = `user_id` + 北京日期）。两条约定：先扣后调、失败不退（否则「刷失败」就能把额度刷回来）；`peek = true` 只读不扣（AI 页顶部显示「今天还能问几次」不能反过来吃掉一次）。

**2）开通 / 续期只有两条路**（没有支付通道 —— 个人主体开不了微信支付商户号）：

| 路径 | 谁能做 | 行为 |
| --- | --- | --- |
| 超管改档位 | 超级管理员 | 运维后台 →「家庭」→「改档位」（`adminSetTier`）：选免费/会员 + 到期日（留空 = 永久），`member_code` 记为 `ADMIN`。**要收回某家的会员就走这条路** |
| 开通码兑换 | **家庭创建者**（`assertOwner`） | 会员页输入码（`membershipRedeem`）：已有到期时间就从到期时间**往后顺延**，否则从今天起算；0 天的码 = 永久（`member_until` 存 `null`）。**已经是永久会员的家庭会被直接拦住**（`ALREADY_PERMANENT`），不消耗码 |

> 为什么永久会员要拦住：永久的 `member_until` 是 `null`，**拿不到「顺延基准」**。如果放行，一个 7 天的码会从今天重新起算，等于把「永久」降成「7 天」（曾经的真实 bug）。与其「保住永久但白瞎一个码」，不如直接拒绝并说清原因 —— 前端也会把兑换框换成一段说明（`isPermanent`）。

开通结果全部落在 `families` 上：`member_tier` / `member_until` / `member_code` / `member_redeemed_at`。**会员按家庭计，一个家庭开通全家共享。**

**2.1）开通码台账 `membership_codes`（一码一用、可作废）**

发给人用的码不在代码里，而在集合 `membership_codes` 里，由运维后台的「开通码」页签生成：

| 字段 | 说明 |
| --- | --- |
| `code` | 码值，形如 `SHY-XXXX-XXXX`；字符集与邀请码一致（去掉易混淆的 I/O/0/1）。有**唯一索引** |
| `days` | 有效天数；`0` = 永久 |
| `status` | `unused` / `used` / `void` |
| `note` | 备注（发给谁），只用于对账 |
| `used_by_family` / `used_by_user` / `used_at` | 谁兑的、什么时候兑的 |
| `created_at` / `updated_at` / `created_by` | 生成信息 |

**一码一用怎么做到的**：云开发没有跨文档事务，「先查 → 再判 → 再写」两个并发请求会同时查到 `unused`，同一个码就开了两家。所以 `claimCodeFromLedger()` 把判断塞进 `where` 里做**条件更新**（只改 `status === 'unused'` 的那一行），改完再读一次确认「拿到手的确实是自己」—— 读一次比赌不同 SDK 版本 `update` 的返回形状稳。抢不到就报「这个开通码已经被使用过了」。

兑换时的码**先查台账、再回退兜底码**：台账里没有，才去看写死在 `MEMBERSHIP_CODES` 里的固定码（只留 `SHUYAO-FAMILY` 这种自己家用的）。

⚠️ **作废只拦得住「还没被兑换」的码**。已经兑出去的权益已经落在 `families` 上，把那个码改成 `void` **收不回**已开通的会员 —— 要收回请去「家庭」页签改那一家的档位（服务端对已兑的码会直接报错并这么提示）。

**发码的实操流程**（运维后台 →「开通码」页签）：

1. 点「生成新码」→ 填**数量** / **天数**（0 = 永久）/ **备注**（写给谁看，只用于对账）→「生成并复制」，码会整批进剪贴板；
2. 微信私聊把码发给对方的**家庭创建者** —— 只有创建者能兑换（`assertOwner`），发给普通成员他兑不了，页面会提示；
3. 对方在「我的 → 会员」输入码即可。**一个码只能开一个家**，兑完台账里那行会变成「已兑换」并记下是谁兑的；
4. 发错了或不想发了：在台账里「作废」（只对未兑换的码有效；作废后还能「恢复」）。

> ⚠️ 目标家庭如果是**永久会员**，兑换会被服务端拦住（`ALREADY_PERMANENT`）—— 想发码给它，先去「家庭」页签用「改档位」把它改成免费版或带到期日的会员。
> 兜底码 `MEMBERSHIP_CODES`（写死在代码里那些）**不做台账**：它们能被任意多个家庭兑换、也没法作废（要改只能重传云函数）。所以只留给自己家，发给别人一律用上面生成的码。

**3）前端只做显示，不做裁决**：`src/services/membership.js` 维护一份 `membershipState` 快照（5 分钟 TTL），`enabled` 决定「我的」页会员卡与会员页两张卡是否渲染，`superAdmin` 决定运维入口是否显示。加载失败时按「会员档」兜底渲染 —— 宁可多给，也不在加载失败时把家人挡在外面（真正的额度仍在服务端）。

**4）上线 / 下线操作**：只改 `src/cloudfunctions/data/index.js` 里 `MEMBERSHIP_ENABLED` 那一行 + 重新上传 `data` 云函数。**不要在前端补第二份配置**。

> ⚠️ 打开开关不是「多一个入口」，而是**立刻收紧所有未开通家庭的 AI 额度**（50 → 5 次/天、上下文 30 → 7 天）。打开前先想清楚，并且准备好用一个永久码把自己家恢复。
>
> 📌 **当前线上状态（2026-09-28）**：`MEMBERSHIP_ENABLED = true`，是为了走一遍真实流程临时打开的。`MEMBERSHIP_CODES` 里只剩一个自己家用的永久码 `SHUYAO-FAMILY`（0 天）；验证用的 7 天码已删除，需要短期码请去「开通码」页签生成（有台账、一码一用、能作废）。

#### `pkg/admin/admin` — 导航栏标题「运维后台」（仅超级管理员）

五个页签（底栏是 5 等分 flex，所以标签用短词，完整名字写在各页的标题上），数据全部走 `data` 云函数的 `admin*` action，服务端按**写死的 openid 白名单**鉴权（前端藏入口只是 UX）：

| 页签 | 能做什么 |
| --- | --- |
| 概览 | 近 N 天记录 / AI 用量 / 行为埋点 / 报错分组 + 规模统计；顶部有「待处理意见反馈 N 条」提示卡（`pendingFeedbackCount`），可一键跳到反馈页签 |
| 家庭 | 全局功能开关（总闸）、每家的权益档位（改档位）、每家的功能开关例外（跟随全局 / 开 / 关） |
| 开通码 | 台账列表（未用 / 已用 / 已作废 / 全部）+ 批量生成（数量 / 天数 / 备注，生成后**整批复制到剪贴板**）+ 复制码 / 作废 / 恢复 |
| 成员 | 全部成员一览（谁在用、在哪几个家、什么角色）；可进任意家庭管成员（改角色 / 移出 / 转移创建者） |
| 反馈 | 待处理 / 已处理 / 全部筛选；看提交人、内容、截图（可点开大图）、联系方式；「处理」可改状态并写一句回复 |

| 项 | 内容 |
| --- | --- |
| 读写数据 | 经 `admin*` action 读写 `families`（含 `feature_flags`）/ `family_members` / `app_config` / `feedbacks` / `membership_codes` 等 |
| 依赖文件 | `src/services/cloud/admin.js`、`src/services/cloud/index.js` 的 `admin` 白名单 |
| ⚠️ 加新 action 时 | 必须同时挂进 `src/services/cloud/index.js` 的 `admin` 对象。那里是**逐个列举**的白名单，与 supabase 版不同、没有 `import * as`，漏挂会被打包时 tree-shaking 掉，页面调用直接是 undefined（踩过） |

---

## 3. 四个 tab 的信息架构

`src/pages.json` 的 `tabBar.list` 只有 4 项；实际底栏由 `src/components/AppTabBar/index.vue` 接管渲染，并在中间额外放了一个**凸起的 AI 按钮**（它不是 tab，走 `navigateTo` 到 AI 助手）。

| 顺序 | tab 名 | 页面 | 页面里放了哪些入口 |
| --- | --- | --- | --- |
| 1 | 时光 | `pages/index/index` | 宝宝信息头（家人环绕动画）、AI 观察卡、照片幻灯片、照片墙（全部/按月/文件管理）、文件夹的增删改与拖拽排序、可拖动「+」上传、照片详情 |
| 2 | 记录 | `pages/record/record` | 今日小结 + 明细、喂奶提醒横幅、生成分享图、AI 小结、一句话记一笔、9 项记录宫格、记录项显隐工具栏、历史→每日小结 |
| — | （中间 AI 按钮） | `pkg/ai-chat/ai-chat` | 非 tab，`navigateTo` 打开；后端不支持时 toast 提示 |
| 3 | 工具 | `pages/tools/tools` | 辅食资料库、AI 照护助手、生长曲线、成长报告、每日小结、疫苗与提醒、喂奶参考与提醒 |
| 4 | 我的 | `pages/profile/profile` | 切换宝宝/家庭、编辑宝宝档案、添加宝宝、家庭成员、会员（会员制上线后）、账号与安全、数据与备份、意见反馈、隐私政策、用户协议、新手引导、运维后台（仅超管）、退出登录 |

---

## 4. 端到端主流程

### 4.1 首次进入 → 微信一键登录 → 建家庭 / 建宝宝

1. 冷启动进入 `pages/index/index`（`src/pages.json` 的 `pages` 第一项），`onShow` 调 `ensurePageAccess('pages/index/index')`。
2. `src/utils/routeGuard.js` 判定未登录 → `redirectTo('/pages/login/login')`。
3. 登录页点「微信一键登录」：`requireConsent` 检查协议 → `store.signInWithWechat(code)`（`src/stores/auth.js`；云开发下前端不取 code，由 `src/cloudfunctions/login` 注入 openid）。
4. 登录成功 `goAfterLogin()`：本地有分享带来的邀请码 → 去 `pages/join-family`；否则有家庭去时光页、没家庭去 `pages/setup/setup`。
5. `pages/setup/setup.vue` 第一步 `createFamily()` → `store.refreshContext()` → `switchFamily()`；第二步 `createBaby()` → `store.refreshContext()` → 回时光页。

### 4.2 日常记一笔（喂养 / 睡眠 / 便便 / 生长 / 生病 / 里程碑）

1. 记录 Tab（`src/pages/record/record.vue`）的宫格项来自 `entries` 数组，`onEntry(entry)` 按 `key` 分派：`feeding`→`feeding-edit`、`sleep`→`sleep-edit`、`diaper`→`diaper-edit`、`growth`→`growth?mode=entry`、`vaccine`→`vaccine?mode=entry`、`milestone`→`milestone`、`illness`→`illness`、`checkup`→`checkup`、`photo`→`PhotoComposer`。
2. 各表单页在 `onShow` 里 `store.bootstrap()` 取当前家庭/宝宝，加载当日或历史列表。
3. 保存走各自服务层：`src/services/feeding.js` / `sleep.js` / `diaper.js` / `growth.js` / `illness.js` / `milestone.js` / `checkup.js`，写入对应表（`feeding_records` 等）。
4. 有照片的记录（里程碑/生病/体检）先 `uploadXxxPhoto()` 传对象存储，写库失败再 `discardXxxPhoto()` 清理。
5. 回到记录页 `onShow` 会重新 `buildDailySummary()`，从表单页返回即可看到最新数字。
6. 记录页拍完照片（`PhotoComposer` 的 `saved` 事件）会 `store.markTimelineDirty()` 并 `switchTab` 回时光页刷新。

### 4.3 家人加入家庭（邀请码）

1. owner 在 `src/pkg/family/family.vue` 选角色（`member`/`viewer`）与有效期（7 天 / 30 天 / 永久）→ `createInvitation()` 生成 6 位邀请码，可复制或经 `open-type="share"` 分享。
2. 家人打开分享卡片 → `src/App.vue` 在未登录时把邀请码暂存到本地；登录页 `goAfterLogin()` 取出邀请码并跳到 `pages/join-family/join-family?code=...`。
3. 也可手动输入邀请码，`normalizeInviteCode` 统一大写并过滤非法字符，必须 6 位。
4. 点「加入家庭」→ `joinFamilyByInvite(code)`（服务端函数，见 `src/services/family.js`）→ `store.refreshContext()` → `store.switchFamily(新家庭)` → 回时光页。
5. 加入后 owner 可在成员列表 `setMemberRole()` 改角色或 `removeMember()` 移除。

### 4.4 照片上传 → 时光页 → 成长报告分享图

1. 时光页点「+」→ `PhotoComposer.open()`（照片多选，最多 `PHOTO_MAX_COUNT`）或 `openVideo()`（单段，时长上限 `VIDEO_MAX_DURATION_SEC`）。
2. 备注确认后 `onSave()`：逐张压缩 → `uploadPhotoFile()`/`uploadVideoFile()` → `createPhoto()` 写 `baby_photos` → 触发 `saved` 事件。
3. 时光页 `onPhotoSaved()` 重新拉取；照片按 `taken_at` 倒序分页展示，图片地址是签名的临时链接（`CACHE_TTL` 内复用）。
4. 点任一照片进 `pages/photo-detail`，可改拍摄时间（`updatePhotoTakenAt`，会重新归月排序）或备注、删除。
5. 工具页进 `pkg/report/report.vue`，选月度或年度 → `buildMonthlyReport()`/`buildYearlyReport()` → canvas 绘制报告图 → 「保存到相册」（`ensurePrivacyAuthorized` + `uni.saveImageToPhotosAlbum`）。

### 4.5 AI 三个触点

| 触点 | 入口 | 链路 |
| --- | --- | --- |
| 照护助手问答 | 工具页 AI 卡 / 底栏中间 AI 按钮 / 首页 AI 观察卡 / `pages/ai-chat` | `askAssistant()` → 内部 `buildBabyContext()`（拉近 7 天明细 + 近 30 天汇总 + 生病/生长/疫苗/体检/里程碑）→ 拼 `parenting-knowledge` 知识 → 流式返回；前端自己数出「依据：…共 N 条原始记录」显示在回答下 |
| 一句话记一笔 | 记录页 `canWrite && aiReady` 时显示 | `parseQuickRecord({ text })` 解析成 `kind` + 字段 → `assertQuickRecord()` 校验 → 确认卡按 `KIND_HANDLERS` 分派到 `createFeeding`/`createSleep`/`createDiaper`/`createGrowthRecord`/`createIllnessRecord`/`createMilestone`。喂养支持「剩余多少」（`leftoverMl`），实际摄入按 `amount_ml - leftover_ml` 算 |
| 每日小结与首页观察 | 记录页「AI 小结」；首页「AI 观察」卡 | 小结：`summarizeDay()` + 本机缓存 `loadDailySummary`/`saveDailySummary`（按账号+宝宝+日期，同一天只成功一次）。观察：**规则**而非模型，`buildInsight()` 读喂养/睡眠/便便/疫苗后给出一条文案与追问问题 |

---

## 5. 角色权限

### 5.1 两层授权（先看这个）

| 层 | 是谁 | 依据 | 能做什么 |
| --- | --- | --- | --- |
| 超级管理员 | 开发者本人 | `src/cloudfunctions/data/index.js` 里写死的 `SUPER_ADMIN_OPENIDS`（当前 1 个 openid），走 `assertSuperAdmin` | 运维后台的一切：看概览、进**任意**家庭管成员、改全局开关与权益档位、删家庭、转移创建者、处理意见反馈 |
| 家庭管理员 | 每个家的创建者 | `family_members.role === 'owner'`，走 `assertOwner` | 只管自己那一个家：改家庭名、发邀请码、改成员角色与移除成员、改本家的功能开关 |
| 普通成员 / 只读 | — | 走 `assertMember(userId, familyId, needWrite)` | 见 5.2 那张表 |

几个容易踩的点：

- 「家庭管理员」在代码里**就等于创建者（`owner`）**，所以「换家庭管理员」= 转移创建者（`adminTransferOwner`），没有单独的字段。
- **「全局管理员」这一层已经撤掉**。早先在 `app_config.admins` 里能任命全局管理员，现在只剩「超管 + 家庭创建者」两层。
- `data` 云函数的鉴权原语：`currentUserId()`（取自 `cloud.getWXContext().OPENID`）、`findMembership()` / `listActiveFamilyIds()`（**请求级缓存**）、`assertMember(needWrite)`、`assertOwner`、`assertSuperAdmin`。
- 请求级缓存必须在每个请求开头清空（`resetAuthCache()`）：云函数热实例会复用模块变量，跨请求留着上一次的结论就是越权漏洞。

### 5.2 家庭内部的三种角色

角色共三种，中文标签定义在 `src/services/family.js` 的 `FAMILY_ROLE_LABEL`：`owner`=创建者、`member`=成员、`viewer`=只读。可邀请的角色只有 `member` 与 `viewer`（`INVITE_ROLES`，不开放邀请 owner）。

| 角色 | 写权限 | 页面表现（代码里真实存在的差异） |
| --- | --- | --- |
| owner | 可写 | 家庭页可改家庭名称、生成/撤销邀请码；可改成员角色与移除成员；不可退出家庭（显示「你是家庭创建者，暂时不能退出家庭」） |
| member | 可写 | 与 owner 相同的记录读写；家庭页看不到「邀请成员」「邀请码记录」，也不会渲染「改角色」「移除」 |
| viewer | 只读 | 隐藏全部写入口，只能看 |

**判断依据**：`src/stores/auth.js` 的 getter `canWrite`：

```js
canWrite() {
  return Boolean(this.myRole) && this.myRole !== 'viewer'
}
```

它由 `myRole` 推出，`myRole` 取当前家庭的成员关系 `membership.role`。页面里统一写成 `const canWrite = computed(() => store.canWrite)`。

| 页面 | 只读时被隐藏/改变的东西 |
| --- | --- |
| `src/pages/record/record.vue` | 整个记录宫格换成只读说明卡；「一句话记一笔」不渲染；轻引导不显示；空态文案改为「家人记下后会显示在这里」 |
| `src/pages/index/index.vue` | `PhotoComposer` 与悬浮「+」不渲染；空态文案改为「家人记录的照片会出现在这里」 |
| `src/pkg/growth/growth.vue` | 录入表单整块不渲染；历史行的「编辑/删除」不渲染；空态文案改为「家人录入记录后就能看到曲线」 |
| `src/pkg/vaccine/vaccine.vue` | 「添加疫苗」「从推荐库添加」「按出生日期生成计划」整块不渲染；`VaccineItem` 传 `readonly`，隐藏「编辑/删除/标记已接种」 |
| `src/pkg/milestone/milestone.vue`、`src/pkg/illness/illness.vue`、`src/pkg/checkup/checkup.vue` | 右上「打卡 / 记录」与每条记录的「编辑/删除」不渲染 |
| `src/pkg/photo-detail/photo-detail.vue` | 不显示「编辑拍摄时间」、备注输入框换成纯文本、不显示删除按钮 |
| `src/pages/profile/profile.vue` | 不渲染「编辑宝宝档案」「添加宝宝」；宝宝选择弹层里的「添加宝宝」也不渲染 |
| `src/pkg/ai-quick-record/ai-quick-record.vue` | 整页换成「你是这个家庭的只读成员，不能新增记录」 |
| `src/pkg/feeding-reminder/feeding-reminder.vue` | 开关与加减仍可点，但 `onSave` 会拦下并提示「你在这个家庭里是只读成员，不能修改提醒设置」 |

注意：页面隐藏只是体验层，代码注释多处写明「真正的拦截靠 RLS / 服务端鉴权」（如 `src/pkg/growth/growth.vue`、`src/pkg/vaccine/vaccine.vue`）。

---

## 6. 未实现 / 占位 / 未确认

| 条目 | 说明 | 依据 |
| --- | --- | --- |
| `PagePlaceholder` 组件未被使用 | 组件存在（显示「功能正在开发中…」），但全仓库没有任何页面/组件 import 它 | `src/components/PagePlaceholder/index.vue`；全库检索 `PagePlaceholder` 无匹配 |
| 记录项分派的兜底提示不可达 | `onEntry()` 末尾有一条「XX 将在后续步骤实现」的 toast，但 `entries` 里 9 个 key 每个都有对应分支，正常走不到 | `src/pages/record/record.vue` |
| 手机号登录 / 注册 / 找回密码 | 仅 Supabase 后端可用，当前 `BACKEND='cloud'` 下这些入口整块不渲染 | `src/pages/login/login.vue` 的 `capabilities.phoneLogin`；`src/services/cloud/index.js` 中 `phoneLogin:false` |
| 绑定邮箱与数据导出 / 注销 | 云开发下没有邮箱体系（`emailBinding:false`），绑定邮箱整块隐藏；导出与注销改走云函数 `export-data`、`delete-account` | `src/pkg/account/account.vue`、`src/cloudfunctions/export-data/index.js`、`src/cloudfunctions/delete-account/index.js` |
| AI 相关功能 | 仅微信小程序 + 云开发后端可用；否则提示「AI 助手只在微信小程序端（云开发后端）提供」，入口不渲染 | `src/services/ai.js` 的 `isAiChatAvailable()`、`capabilities.aiChat` |
| 微信推送订阅模板 | **一次性订阅**：一次授权只换 1 条额度，勾了「总是保持以上选择」也只是不再弹窗，不等于永久订阅。未配置模板 ID 时整块订阅 UI 不渲染（`v-if="FEED_TEMPLATE_ID"`）。两个模板 ID 写在 `src/utils/subscribe.js`（`FEED_TEMPLATE_ID` / `VACCINE_TEMPLATE_ID`），必须与两个云函数里的 `TEMPLATE_ID` 保持一致 | `src/utils/subscribe.js`、`src/cloudfunctions/feeding-reminder/index.js`、`src/cloudfunctions/reminder/index.js` |
| 云函数定时推送 | **触发配置已确认**：`feeding-reminder` 的 `config.json` 是 `0 0 * * * * *`（每小时整点，单日最多推 3 轮，按「最近一条喂养记录」算超时）；`reminder` 的 `config.json` 是 `0 0 9 * * * *`（每天 09:00，只推「接种当天且未接种」的记录 —— **不提前、也不推逾期**，逾期只在站内标红）。发送失败且返回 43101（无额度）时归类为 `no_quota` 跳过，不中断其他家人 | `src/cloudfunctions/*/config.json`、`src/cloudfunctions/feeding-reminder/index.js`、`src/cloudfunctions/reminder/index.js` |
| 导出的 JSON 不含照片原件 | `export-data` 导出 **13 张表**（12 张家庭维度 + 账号维度的 `feedbacks`），并带 `schema_version`（当前 `1`，改结构时两侧一起 +1）；照片只有云存储相对路径，不含图片二进制。「备份照片原件」由账号页的「照片备份」承担（批量存相册） | `src/cloudfunctions/export-data/index.js` 的 `TABLES` / `ACCOUNT_TABLES`、`supabase/functions/export-data/index.ts` |
| 隐私政策 / 用户协议正文 | 文案为静态硬编码（改文案要重新发版）。开发者信息已填：书遥贝贝开发者 / `1530829770@qq.com` / 微信 `shihenghe`；2026-09-28 已按「只保留微信一键登录」校正收集范围与账号规则两节，并补了剪贴板声明。⚠️ 文末「政策更新后会在小程序内提示你重新阅读」这句**尚未实现** | `src/pages/privacy/privacy.vue`、`src/pages/terms/terms.vue` |
| 语音录入 | 依赖「同声传译」插件，插件未配好或非微信端时隐藏麦克风按钮，退化为键盘语音 | `src/pkg/ai-quick-record/ai-quick-record.vue`、`src/pkg/utils/voice.js` |
| 对话与 AI 小结的本地存储 | 对话历史、每日小结文案只存本机 storage，不落库，换设备看不到 | `src/services/ai.js` 的 `loadChatHistory`/`loadDailySummary` |
| 年度报告没有直达链接 | 报告页顶部本来就有「月度报告 / 年度报告」切换（`RANGES`），功能不缺；只是工具页 / 记录页都只链到默认的月度报告，`?range=year[&period=2026]` 这个参数目前没有入口在用 | `src/pkg/report/report.vue` 的 `onLoad`、`src/pages/tools/tools.vue` |
