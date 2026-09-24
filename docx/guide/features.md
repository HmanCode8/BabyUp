# 功能地图

本页回答三个问题：**这个产品有哪些功能、分别在哪个页面、走哪条数据链路。**

- 页面清单唯一来源：`src/pages.json`（共注册 **33** 个页面，其中 4 个是 tab 页）。页面文件位于 `src/pages/<name>/<name>.vue`。
- 后端：`src/config/index.js` 的 `BACKEND` 当前为 `'cloud'`（微信云开发）；Supabase 版实现保留，通过 `src/services/api.js` 统一切换。**AI 相关功能只在云开发后端可用**（`capabilities.aiChat`，见 `src/services/cloud/index.js` 与 `src/services/supabase/index.js`）。
- 数据表名以代码里实际的 `api.db.select/insert/upsert/remove('表名')` 为准（见 `src/services/*.js`）。
- 相关文档：[`./architecture.md`](./architecture.md)、[`./data-model.md`](./data-model.md)、[`../ai/README.md`](../ai/README.md)、[`../product/phase1.md`](../product/phase1.md)、[`../backend/README.md`](../backend/README.md)

---

## 1. 功能总览表

| 功能模块 | 一句话说明 | 入口页面 | 依赖的服务层文件 |
| --- | --- | --- | --- |
| 登录与账号 | 微信一键登录 / 手机号登录注册（仅 Supabase 后端） | `src/pages/login/login.vue` | `src/stores/auth.js`、`src/services/api.js` |
| 找回密码 | 输入绑定邮箱发重置邮件 | `src/pages/forgot-password/forgot-password.vue` | `src/stores/auth.js` |
| 账号与安全 | 绑定真实邮箱、导出全部数据、注销账号 | `src/pages/account/account.vue` | `src/services/account.js`、`src/services/api.js` |
| 合规文档 | 隐私政策、用户协议（静态文案，未登录可看） | `src/pages/privacy/privacy.vue`、`src/pages/terms/terms.vue` | 无（纯静态） |
| 创建家庭 | 建家庭 → 建宝宝档案两步引导 | `src/pages/setup/setup.vue` | `src/services/family.js`、`src/services/baby.js` |
| 加入家庭 | 输入 6 位邀请码加入（也支持分享链接带入） | `src/pages/join-family/join-family.vue` | `src/services/family.js` |
| 家庭成员管理 | 邀请码生成/撤销、改角色、改昵称、移除成员、退出家庭 | `src/pages/family/family.vue` | `src/services/family.js` |
| 家庭/宝宝切换 | 一个用户多家庭、一个家庭多宝宝的选择与切换 | `src/pages/profile/profile.vue` | `src/stores/auth.js` |
| 宝宝档案 | 昵称、生日、性别、头像的编辑与新增 | `src/pages/baby-edit/baby-edit.vue` | `src/services/baby.js` |
| 时光相册 | 照片/视频上传、按月分组或瀑布流浏览、片家人环绕动画 | `src/pages/index/index.vue` | `src/services/photo.js`、`src/services/ai-insight.js` |
| 照片详情 | 大图/视频查看、改拍摄时间、改备注、删除 | `src/pages/photo-detail/photo-detail.vue` | `src/services/photo.js` |
| 日常记录入口 | 今日小结 + 九宫格记录项（喂养/睡眠/便便/生长/疫苗/里程碑/生病/体检/照片） | `src/pages/record/record.vue` | `src/services/summary.js`、`src/services/feeding.js` |
| 喂养记录 | 母乳/配方奶/辅食/水的记录与今日列表 | `src/pages/feeding-edit/feeding-edit.vue` | `src/services/feeding.js` |
| 睡眠记录 | 入睡/醒来/正在睡、结束睡眠 | `src/pages/sleep-edit/sleep-edit.vue` | `src/services/sleep.js` |
| 便便记录 | 尿/便/混合 + 性状 + 颜色（异常色提示） | `src/pages/diaper-edit/diaper-edit.vue` | `src/services/diaper.js` |
| 生长记录 | 身高/体重/头围折线图 + 录入与历史 | `src/pages/growth/growth.vue` | `src/services/growth.js` |
| 疫苗记录 | 待办/已接种、疫苗推荐库、一键排期、微信提醒 | `src/pages/vaccine/vaccine.vue` | `src/services/vaccine.js`、`src/services/vaccine-library.js` |
| 喂奶提醒 | 按宝宝月龄算间隔上限、订阅消息推送设置 | `src/pages/feeding-reminder/feeding-reminder.vue` | `src/services/feeding.js`、`src/utils/subscribe.js` |
| 成长里程碑 | 预设/自定义里程碑时间线，可带照片 | `src/pages/milestone/milestone.vue`、`src/pages/milestone-edit/milestone-edit.vue` | `src/services/milestone.js` |
| 生病记录 | 症状/体温/用药/就诊/照片 | `src/pages/illness/illness.vue`、`src/pages/illness-edit/illness-edit.vue` | `src/services/illness.js` |
| 儿保体检 | 体检记录 + 体格测量同步到生长记录 | `src/pages/checkup/checkup.vue`、`src/pages/checkup-edit/checkup-edit.vue` | `src/services/checkup.js`、`src/services/growth.js` |
| 今日/每日小结 | 实时聚合当日数据、历史每日卡片与增减对比 | `src/pages/record/record.vue`、`src/pages/daily/daily.vue` | `src/services/summary.js` |
| 成长报告 | 月度/年度报告生成分享图并保存相册 | `src/pages/report/report.vue` | `src/services/report.js` |
| AI 照护助手 | 结合宝宝记录流式问答，附「依据」小字 | `src/pages/ai-chat/ai-chat.vue` | `src/services/ai.js`、`src/services/parenting-knowledge.js` |
| AI 一句话记一笔 | 自然语言解析成六类记录，确认后写库 | `src/pages/ai-quick-record/ai-quick-record.vue` | `src/services/ai.js` |
| AI 每日小结 | 当日记录让 AI 写一段小结，可复制/重新生成 | `src/pages/record/record.vue` | `src/services/ai.js` |
| AI 首页观察 | 规则判断出一条值得留意的事（不是模型） | `src/pages/index/index.vue` | `src/services/ai-insight.js` |
| 辅食资料库 | 按月龄/食材筛选食谱，看食材、做法、注意点 | `src/pages/solid-food/solid-food.vue`、`src/pages/solid-food-detail/solid-food-detail.vue` | `src/services/solid-food.js` |
| 育儿工具页 | 查/看/设置类入口的聚合页（含疫苗与喂奶实时状态） | `src/pages/tools/tools.vue` | `src/services/vaccine.js`、`src/services/feeding.js` |
| 意见反馈 | 提交反馈（可带截图）并查看自己提交过的 | `src/pages/feedback/feedback.vue` | `src/services/feedback.js` |

---

## 2. 按页面组织的功能清单

### 2.1 时光 Tab

#### `pages/index/index` — 导航栏标题「时光」（tab 页）

- 顶部宝宝信息头：点整块弹出「守护家人」环绕动画（成员取自 `store.members`，不再发请求）。
- 「AI 观察」卡片：规则算出的观察文案，点击带问题跳到 AI 助手（`?q=` 预填输入框）。
- 顶部幻灯片：进入本页自动轮播最近 20 条媒体（视频显示封面）。
- 照片墙两种视图：`按月`（三列方格，本地时区归月）/ `全部`（三列瀑布流，按原图比例）。
- 悬浮「+」按钮：可拖动换位，轻点弹「照片（可多选）/ 视频」，位置存本机 `home_fab_pos`。
- 下拉刷新、触底加载更多（每页 20 条，`CACHE_TTL` 30 分钟复用上次结果）。

| 项 | 内容 |
| --- | --- |
| 读写数据 | 读 `baby_photos`（分页 + 覆盖只写权限）；读喂养/睡眠/便便/疫苗（只经 `ai-insight` 聚合） |
| 依赖组件 | `src/components/PhotoComposer/index.vue`、`src/components/FamilyOrbit/index.vue`、`src/components/AppTabBar/index.vue` |
| 关键变量 | `canWrite`（`src/pages/index/index.vue`，来自 `store.canWrite`，控制 `PhotoComposer` 与「+」是否渲染） |

### 2.2 记录 Tab

#### `pages/record/record` — 导航栏标题「记录」（tab 页）

- 「今日小结」卡：实时聚合当日喂养/睡眠/便便/照片/生长/疫苗，可展开当日明细时间线。
- 喂奶提醒横幅：宝宝开启提醒且距上次喂养超过间隔上限时置顶提示。
- 「生成分享图」：把今日小结画成 canvas 卡片，可保存到相册或转发给家人。
- 「AI 小结」：让 AI 说一句今天怎么样，可复制/重新生成，同一天只成功生成一次（本机缓存）。
- 「一句话记一笔」入口：仅 `canWrite && aiReady` 时渲染。
- 九宫格记录项（9 项）+ 右侧「记录项」工具栏：本机开关控制显示哪些，存 `babyup.recordEntryHidden`。
- 首次进入的轻引导（`babyup.recordGuideSeen`，只显示一次）；只读成员显示只读说明卡。

| 项 | 内容 |
| --- | --- |
| 读写数据 | 读 `feeding_records`/`sleep_records`/`diaper_records`/`baby_photos`/`growth_records`/`vaccinations`（经 `buildDailySummary`）；写照片经 `PhotoComposer` |
| 依赖组件 | `src/components/PhotoComposer/index.vue`、`src/components/AppTabBar/index.vue` |
| 关键变量 | `canWrite`、`aiReady = isAiChatAvailable()`、`visibleEntries` |

#### `pages/daily/daily` — 导航栏标题「每日小结」

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
| `src/pages/feeding-edit/feeding-edit.vue` | 喂养记录 | 选母乳/配方奶/辅食/水，填数量或时长、时间、备注；今日记录列表可编辑删除；保存时顺带攒一条提醒订阅额度 | 读/写 `feeding_records` |
| `src/pages/sleep-edit/sleep-edit.vue` | 睡眠记录 | 记入睡/醒来时间，支持「正在睡」与弹层「结束睡眠」；最近 20 条可编辑删除 | 读/写 `sleep_records` |
| `src/pages/diaper-edit/diaper-edit.vue` | 便便记录 | 选类型（尿/便/混合）、性状、颜色；红/黑颜色给出咨询医生提示（不阻断保存） | 读/写 `diaper_records` |
| `src/pages/growth/growth.vue` | 生长记录 | uCharts 折线图（体重/身高/头围切换，可点看数值）；录入与编辑历史；`?mode=entry` 进入自动展开表单 | 读/写 `growth_records` |
| `src/pages/vaccine/vaccine.vue` | 疫苗记录 | 待办/已接种分区；从疫苗推荐库添加；「按出生日期生成计划」批量排期；标记已接种；微信订阅提醒开启状态 | 读/写 `vaccinations`，读 `vaccine_library` |
| `src/pages/milestone/milestone.vue` | 成长里程碑 | 里程碑时间线（倒序，带照片、备注、记录人）；可编辑/删除 | 读 `milestones`（删除经 `removeMilestone`） |
| `src/pages/milestone-edit/milestone-edit.vue` | 里程碑打卡 | 预设 8 类 + 自定义名称、日期、照片、备注；先传文件再写库，失败清理孤儿文件 | 读/写 `milestones` + 对象存储 |
| `src/pages/illness/illness.vue` | 生病记录 | 列表（症状、体温、用药摘要、就诊、照片缩略图）；可编辑/删除 | 读 `illness_records` |
| `src/pages/illness-edit/illness-edit.vue` | 记录生病 | 发病时间、症状多选、体温、多行用药、医院/医生/诊断、过敏反应、最多 N 张照片、备注 | 读/写 `illness_records` + 对象存储 |
| `src/pages/checkup/checkup.vue` | 儿保体检 | 列表（身高/体重/头围/血红蛋白、发育评估、医生建议、「距下次体检还有 N 天」）；删除时可选择是否连带删除关联生长记录 | 读 `checkup_records` |
| `src/pages/checkup-edit/checkup-edit.vue` | 记录体检 | 体检日期 + 自动月龄；体格测量（填了身高/体重会同步一条生长记录）；体检机构、发育评估、医生建议、下次体检日期、体检本照片 | 读/写 `checkup_records`（联动 `growth_records`） |
| `src/pages/photo-detail/photo-detail.vue` | 照片详情 | 大图/视频播放；改拍摄时间（按绝对时刻重存）；改备注；删除 | 读写 `baby_photos` |

### 2.3 工具 Tab

#### `pages/tools/tools` — 导航栏标题「育儿工具」（tab 页）

- 7 张工具卡：辅食资料库、AI 照护助手、生长曲线、成长报告、每日小结、疫苗与提醒、喂奶提醒。
- AI 卡按 `isAiChatAvailable()` 过滤，不可用时整项不渲染。
- 疫苗卡显示实时状态「待接种 N · 已逾期 N」（`listVaccinations` + `summarizeVaccinations`）。
- 喂奶卡显示「未开启提醒」或「每 X 小时 Y 分」（纯计算，不发请求）。

| 项 | 内容 |
| --- | --- |
| 读写数据 | 读 `vaccinations`（状态）；其余为导航 |
| 依赖组件 | `src/components/AppTabBar/index.vue` |

#### 工具页背后的页面

| 页面 | 标题 | 能做什么 |
| --- | --- | --- |
| `src/pages/report/report.vue` | 成长报告 | 月度/年度切换 + 周期选择 → 生成报告图（照片九宫格 + 数据卡 + 里程碑 + 品牌落款）→ 保存到相册；支持 `?range=year&period=2026` 直达 |
| `src/pages/solid-food/solid-food.vue` | 辅食资料库 | 按宝宝月龄默认选档、月龄与食材两组筛选、搜索计数；点进食谱详情 |
| `src/pages/solid-food-detail/solid-food-detail.vue` | 食谱详情 | 食材、做法步骤、注意点（本地内置数据，`recipeById`） |
| `src/pages/feeding-reminder/feeding-reminder.vue` | 喂奶提醒 | 开关提醒、加减间隔上限（步长 15 分钟）、「恢复月龄推荐」、微信推送订阅状态与最近推送结果 |
| `src/pages/ai-chat/ai-chat.vue` | AI 照护助手 | 欢迎语 + 快速提问、流式回答、回答下方「依据」、清空对话（对话只存本机） |
| `src/pages/ai-quick-record/ai-quick-record.vue` | 一句话记一笔 | 文字/语音输入 → AI 解析 → 确认卡（可改每个字段）→ 确认后写库 |

### 2.4 我的 Tab

#### `pages/profile/profile` — 导航栏标题「我的」（tab 页）

- 当前宝宝卡（点头像切换宝宝）与当前家庭卡（点击切换家庭）。
- 「编辑宝宝档案」「添加宝宝」（`canWrite` 时才渲染）。
- 「家庭」入口 → 家庭成员页，右侧显示我的角色。
- 账号卡：账号与安全、数据与备份、意见反馈。
- 「关于与法律」：隐私政策、用户协议；底部退出登录（二次确认）。
- 选择宝宝 / 选择家庭的底部弹层，含「创建新家庭」「加入已有家庭」。

| 项 | 内容 |
| --- | --- |
| 读写数据 | 读 `family_members`/`families`/`babies`（经 `store`）；改名等写操作在子页面 |
| 依赖组件 | `src/components/AppTabBar/index.vue` |
| 关键变量 | `canWrite`、`isOwner`、`accountValue`（后端能力决定显示「微信账号 / 已绑定邮箱 / 未绑定邮箱」） |

### 2.5 登录、引导与账号

| 页面 | 标题 | 能做什么 | 依据文件 |
| --- | --- | --- | --- |
| `src/pages/login/login.vue` | 登录 | 微信一键登录（`#ifdef MP-WEIXIN`）；`capabilities.phoneLogin` 时显示手机号注册/登录与忘记密码；首次登录弹协议确认层；登录后优先回到分享带来的邀请码 | `src/stores/auth.js`、`src/utils/legal.js` |
| `src/pages/forgot-password/forgot-password.vue` | 找回密码 | 输入绑定邮箱发送重置邮件；输入手机号时给出绑定引导 | `src/stores/auth.js` |
| `src/pages/setup/setup.vue` | 开始使用 | 第一步建家庭（或跳「加入已有家庭」），第二步建宝宝档案（昵称/生日/性别，可跳过） | `src/services/family.js`、`src/services/baby.js` |
| `src/pages/join-family/join-family.vue` | 加入家庭 | 输入 6 位邀请码加入，大写归一并过滤非法字符；从分享链接 `?code=` 带入 | `src/services/family.js` |
| `src/pages/family/family.vue` | 家庭成员 | 家庭改名（仅 owner）、按角色/有效期生成邀请码并复制/分享、改我的昵称、成员列表改角色/移除、邀请码记录与撤销、退出家庭（owner 不可退出） | `src/services/family.js` |
| `src/pages/baby-edit/baby-edit.vue` | 宝宝档案 / 添加宝宝 | 选头像、昵称、生日、性别；新增模式 `?mode=create`；头像先建宝宝再传到 `{family}/{baby}/avatar` 并回写 | `src/services/baby.js` |
| `src/pages/account/account.vue` | 账号与安全 | 展示账号类型与找回邮箱绑定状态；绑定真实邮箱（需点邮件确认，可手动刷新）；导出全部数据（小程序写沙箱并转发/ H5 下载）；注销账号（双确认，必须输入「删除」） | `src/services/account.js` |
| `src/pages/privacy/privacy.vue` | 隐私政策 | 静态六节文案；开发者名称与联系邮箱为占位符 | 纯静态 |
| `src/pages/terms/terms.vue` | 用户协议 | 静态六节文案；同样含占位符 | 纯静态 |
| `src/pages/feedback/feedback.vue` | 意见反馈 | 选类型、写描述、可选截图、可选联系方式；下方列出「我的反馈」及处理状态 | `src/services/feedback.js` |

---

## 3. 四个 tab 的信息架构

`src/pages.json` 的 `tabBar.list` 只有 4 项；实际底栏由 `src/components/AppTabBar/index.vue` 接管渲染，并在中间额外放了一个**凸起的 AI 按钮**（它不是 tab，走 `navigateTo` 到 AI 助手）。

| 顺序 | tab 名 | 页面 | 页面里放了哪些入口 |
| --- | --- | --- | --- |
| 1 | 时光 | `pages/index/index` | 宝宝信息头（家人环绕动画）、AI 观察卡、照片幻灯片、照片墙（按月/全部）、可拖动「+」上传、照片详情 |
| 2 | 记录 | `pages/record/record` | 今日小结 + 明细、喂奶提醒横幅、生成分享图、AI 小结、一句话记一笔、9 项记录宫格、记录项显隐工具栏、历史→每日小结 |
| — | （中间 AI 按钮） | `pages/ai-chat/ai-chat` | 非 tab，`navigateTo` 打开；后端不支持时 toast 提示 |
| 3 | 工具 | `pages/tools/tools` | 辅食资料库、AI 照护助手、生长曲线、成长报告、每日小结、疫苗与提醒、喂奶提醒 |
| 4 | 我的 | `pages/profile/profile` | 切换宝宝/家庭、编辑宝宝档案、添加宝宝、家庭成员、账号与安全、数据与备份、意见反馈、隐私政策、用户协议、退出登录 |

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

1. owner 在 `src/pages/family/family.vue` 选角色（`member`/`viewer`）与有效期（7 天 / 30 天 / 永久）→ `createInvitation()` 生成 6 位邀请码，可复制或经 `open-type="share"` 分享。
2. 家人打开分享卡片 → `src/App.vue` 在未登录时把邀请码暂存到本地；登录页 `goAfterLogin()` 取出邀请码并跳到 `pages/join-family/join-family?code=...`。
3. 也可手动输入邀请码，`normalizeInviteCode` 统一大写并过滤非法字符，必须 6 位。
4. 点「加入家庭」→ `joinFamilyByInvite(code)`（服务端函数，见 `src/services/family.js`）→ `store.refreshContext()` → `store.switchFamily(新家庭)` → 回时光页。
5. 加入后 owner 可在成员列表 `setMemberRole()` 改角色或 `removeMember()` 移除。

### 4.4 照片上传 → 时光页 → 成长报告分享图

1. 时光页点「+」→ `PhotoComposer.open()`（照片多选，最多 `PHOTO_MAX_COUNT`）或 `openVideo()`（单段，时长上限 `VIDEO_MAX_DURATION_SEC`）。
2. 备注确认后 `onSave()`：逐张压缩 → `uploadPhotoFile()`/`uploadVideoFile()` → `createPhoto()` 写 `baby_photos` → 触发 `saved` 事件。
3. 时光页 `onPhotoSaved()` 重新拉取；照片按 `taken_at` 倒序分页展示，图片地址是签名的临时链接（`CACHE_TTL` 内复用）。
4. 点任一照片进 `pages/photo-detail`，可改拍摄时间（`updatePhotoTakenAt`，会重新归月排序）或备注、删除。
5. 工具页进 `pages/report/report.vue`，选月度或年度 → `buildMonthlyReport()`/`buildYearlyReport()` → canvas 绘制报告图 → 「保存到相册」（`ensurePrivacyAuthorized` + `uni.saveImageToPhotosAlbum`）。

### 4.5 AI 三个触点

| 触点 | 入口 | 链路 |
| --- | --- | --- |
| 照护助手问答 | 工具页 AI 卡 / 底栏中间 AI 按钮 / 首页 AI 观察卡 / `pages/ai-chat` | `askAssistant()` → 内部 `buildBabyContext()`（拉近 7 天明细 + 近 30 天汇总 + 生病/生长/疫苗/体检/里程碑）→ 拼 `parenting-knowledge` 知识 → 流式返回；前端自己数出「依据：…共 N 条原始记录」显示在回答下 |
| 一句话记一笔 | 记录页 `canWrite && aiReady` 时显示 | `parseQuickRecord({ text })` 解析成 `kind` + 字段 → `assertQuickRecord()` 校验 → 确认卡按 `KIND_HANDLERS` 分派到 `createFeeding`/`createSleep`/`createDiaper`/`createGrowthRecord`/`createIllnessRecord`/`createMilestone` |
| 每日小结与首页观察 | 记录页「AI 小结」；首页「AI 观察」卡 | 小结：`summarizeDay()` + 本机缓存 `loadDailySummary`/`saveDailySummary`（按账号+宝宝+日期，同一天只成功一次）。观察：**规则**而非模型，`buildInsight()` 读喂养/睡眠/便便/疫苗后给出一条文案与追问问题 |

---

## 5. 角色权限

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
| `src/pages/growth/growth.vue` | 录入表单整块不渲染；历史行的「编辑/删除」不渲染；空态文案改为「家人录入记录后就能看到曲线」 |
| `src/pages/vaccine/vaccine.vue` | 「添加疫苗」「从推荐库添加」「按出生日期生成计划」整块不渲染；`VaccineItem` 传 `readonly`，隐藏「编辑/删除/标记已接种」 |
| `src/pages/milestone/milestone.vue`、`src/pages/illness/illness.vue`、`src/pages/checkup/checkup.vue` | 右上「打卡 / 记录」与每条记录的「编辑/删除」不渲染 |
| `src/pages/photo-detail/photo-detail.vue` | 不显示「编辑拍摄时间」、备注输入框换成纯文本、不显示删除按钮 |
| `src/pages/profile/profile.vue` | 不渲染「编辑宝宝档案」「添加宝宝」；宝宝选择弹层里的「添加宝宝」也不渲染 |
| `src/pages/ai-quick-record/ai-quick-record.vue` | 整页换成「你是这个家庭的只读成员，不能新增记录」 |
| `src/pages/feeding-reminder/feeding-reminder.vue` | 开关与加减仍可点，但 `onSave` 会拦下并提示「你在这个家庭里是只读成员，不能修改提醒设置」 |

注意：页面隐藏只是体验层，代码注释多处写明「真正的拦截靠 RLS / 服务端鉴权」（如 `src/pages/growth/growth.vue`、`src/pages/vaccine/vaccine.vue`）。

---

## 6. 未实现 / 占位 / 未确认

| 条目 | 说明 | 依据 |
| --- | --- | --- |
| `PagePlaceholder` 组件未被使用 | 组件存在（显示「功能正在开发中…」），但全仓库没有任何页面/组件 import 它 | `src/components/PagePlaceholder/index.vue`；全库检索 `PagePlaceholder` 无匹配 |
| 记录项分派的兜底提示不可达 | `onEntry()` 末尾有一条「XX 将在后续步骤实现」的 toast，但 `entries` 里 9 个 key 每个都有对应分支，正常走不到 | `src/pages/record/record.vue` |
| 手机号登录 / 注册 / 找回密码 | 仅 Supabase 后端可用，当前 `BACKEND='cloud'` 下这些入口整块不渲染 | `src/pages/login/login.vue` 的 `capabilities.phoneLogin`；`src/services/cloud/index.js` 中 `phoneLogin:false` |
| 绑定邮箱与数据导出 / 注销 | 云开发下没有邮箱体系（`emailBinding:false`），绑定邮箱整块隐藏；导出与注销改走云函数 `export-data`、`delete-account` | `src/pages/account/account.vue`、`src/cloudfunctions/export-data/index.js`、`src/cloudfunctions/delete-account/index.js` |
| AI 相关功能 | 仅微信小程序 + 云开发后端可用；否则提示「AI 助手只在微信小程序端（云开发后端）提供」，入口不渲染 | `src/services/ai.js` 的 `isAiChatAvailable()`、`capabilities.aiChat` |
| 微信推送订阅模板 | 喂奶提醒的推送依赖 `FEED_TEMPLATE_ID` 配置，未配置时整块订阅 UI 不渲染（`v-if="FEED_TEMPLATE_ID"`）；实际模板 ID 值未在本次阅读范围内确认 ⚠️ 未确认 | `src/pages/feeding-reminder/feeding-reminder.vue`、`src/utils/subscribe.js` |
| 云函数定时推送 | `src/cloudfunctions/reminder/` 与 `src/cloudfunctions/feeding-reminder/` 存在，页面只展示其写回的结果字段（`feed_remind_last_at` 等）；具体触发配置需看云开发控制台 ⚠️ 未确认 | `src/pages/feeding-reminder/feeding-reminder.vue`、`src/cloudfunctions/feeding-reminder/index.js` |
| 隐私政策 / 用户协议正文 | 文案为静态硬编码，开发者名称与联系邮箱是占位符「【待填写：…】」，文件头注释写明必须人工复核后才可上线 | `src/pages/privacy/privacy.vue`、`src/pages/terms/terms.vue` |
| 语音录入 | 依赖「同声传译」插件，插件未配好或非微信端时隐藏麦克风按钮，退化为键盘语音 | `src/pages/ai-quick-record/ai-quick-record.vue`、`src/utils/voice.js` |
| 对话与 AI 小结的本地存储 | 对话历史、每日小结文案只存本机 storage，不落库，换设备看不到 | `src/services/ai.js` 的 `loadChatHistory`/`loadDailySummary` |
| 年度报告入口 | 报告页支持 `?range=year`，但工具页与记录页目前只链到默认的月度报告，未发现直达年度报告的入口 ⚠️ 未确认 | `src/pages/report/report.vue` 的 `onLoad`、`src/pages/tools/tools.vue` |
