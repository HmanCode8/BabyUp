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
| 家庭成员管理 | 邀请码生成/撤销/**删除记录**、改角色、改昵称、移除成员、退出家庭 | `src/pkg/family/family.vue` | `src/services/family.js` |
| 家庭/宝宝切换 | 一个用户多家庭、一个家庭多宝宝的选择与切换 | `src/pages/profile/profile.vue` | `src/stores/auth.js` |
| 宝宝档案 | 昵称、生日、性别、头像的编辑与新增 | `src/pkg/baby-edit/baby-edit.vue` | `src/services/baby.js` |
| 时光相册 | 照片/视频上传、文件夹（相册）分类、按月分组或瀑布流浏览、片家人环绕动画、顶部轮播右上角「▶ 放映」进全屏播放 | `src/pages/index/index.vue` | `src/services/photo.js` |
| 全屏放映 | 把宝宝的照片全屏自动播一遍（**4 秒一张**、循环、可暂停、可手动翻）；深色底、自带进度条与第几张计数；顶栏可选**背景声**（关闭 + 13 首内置 + 自己存的，默认关闭、记在本机）；可分享卡片给家人 | `src/pkg/slideshow/slideshow.vue` | `src/services/photo.js`、`src/pkg/utils/bgm.js` |
| 照片详情 | 大图/视频查看、改拍摄时间、**改所在文件夹**、改备注、删除 | `src/pkg/photo-detail/photo-detail.vue` | `src/services/photo.js` |
| 日常记录入口 | 今日小结 + 九宫格记录项（喂养/睡眠/便便/生长/疫苗/里程碑/生病/体检/照片） | `src/pages/record/record.vue` | `src/services/summary.js`、`src/services/feeding.js` |
| 喂养记录 | 母乳/配方奶/辅食/水的记录与今日列表 | `src/pkg/feeding-edit/feeding-edit.vue` | `src/services/feeding.js` |
| 睡眠记录 | 入睡/醒来/正在睡、结束睡眠 | `src/pkg/sleep-edit/sleep-edit.vue` | `src/services/sleep.js` |
| 便便记录 | 尿/便/混合 + 性状 + 颜色（异常色提示） | `src/pkg/diaper-edit/diaper-edit.vue` | `src/services/diaper.js` |
| 生长记录 | 身高/体重/头围折线图 + 录入与历史 | `src/pkg/growth/growth.vue` | `src/services/growth.js` |
| 疫苗记录 | 待办/已接种、疫苗推荐库、一键排期、微信提醒 | `src/pkg/vaccine/vaccine.vue` | `src/services/vaccine.js`、`src/pkg/services/vaccine-library.js` |
| 喂奶提醒 | 按宝宝月龄算间隔上限、订阅消息推送设置 | `src/pkg/feeding-reminder/feeding-reminder.vue` | `src/services/feeding.js`、`src/utils/subscribe.js` |
| 安睡音 | **13 种声音**：6 种噪声/环境音（白噪音/粉噪音/棕噪音/雨声/海浪/风）+ 溪流/风扇/心跳/钟摆 + 3 首自制旋律（摇篮曲/八音盒/星光），可定时关闭；**后台播放，息屏也能放**；音频素材在云存储（脚本生成的无缝循环 WAV），不占代码包；列表末尾会接上「自己存的」 | `src/pkg/sleep-sound/sleep-sound.vue` | `src/pkg/utils/sound-library.js`、`src/pkg/utils/noise.js`、`scripts/gen-audio.mjs` |
| 声音工坊 | 选条件**实时合成**一个声音：底色 + 混入（可多选、各带强度）+ 亮度/起伏滑杆，改一下立刻听到；在手机内存里现算，不联网、不占存储；代价是**只在前台响**；满意后「存下来」会落成一段固定音频传云存储，之后能在安睡音/放映页选到并息屏播 | `src/pkg/sound-lab/sound-lab.vue` | `src/pkg/utils/sound-gen.mjs`、`src/pkg/utils/sound-lab-player.js` |
| 成长里程碑 | 预设/自定义里程碑时间线，可带照片 | `src/pkg/milestone/milestone.vue`、`src/pkg/milestone-edit/milestone-edit.vue` | `src/services/milestone.js` |
| 生病记录 | 症状/体温/用药/就诊/照片 | `src/pkg/illness/illness.vue`、`src/pkg/illness-edit/illness-edit.vue` | `src/services/illness.js` |
| 儿保体检 | 体检记录 + 体格测量同步到生长记录 | `src/pkg/checkup/checkup.vue`、`src/pkg/checkup-edit/checkup-edit.vue` | `src/services/checkup.js`、`src/services/growth.js` |
| 今日/每日小结 | 实时聚合当日数据、历史每日卡片与增减对比 | `src/pages/record/record.vue`、`src/pkg/daily/daily.vue` | `src/services/summary.js` |
| 成长报告 | 月度/年度报告生成分享图并保存相册 | `src/pkg/report/report.vue` | `src/pkg/services/report.js` |
| AI 照护助手 | 结合宝宝记录流式问答，附「依据」小字 | `src/pkg/ai-chat/ai-chat.vue` | `src/services/ai.js`、`src/services/parenting-knowledge.js` |
| AI 一句话记一笔 | 自然语言解析成六类记录，确认后写库 | `src/pkg/ai-quick-record/ai-quick-record.vue` | `src/services/ai.js` |
| AI 每日小结 | 当日记录让 AI 写一段小结，可复制/重新生成 | `src/pages/record/record.vue` | `src/services/ai.js` |
| AI 观察与作息预测 | 记录页顶部同一张卡：上面是规则判断出的一条值得留意的事，下面是按**自家近几天实际节律**算的「下一次喂养大约几点 / 夜里通常几点入睡」。**都不调模型、不花额度**、打开就有 | `src/pages/record/record.vue` | `src/services/ai-insight.js` |
| 辅食资料库 | 按月龄/食材筛选食谱，看食材、做法、注意点 | `src/pkg/solid-food/solid-food.vue`、`src/pkg/solid-food-detail/solid-food-detail.vue` | `src/pkg/services/solid-food.js` |
| 育儿工具页 | 查/看/设置类入口的聚合页（含疫苗与喂奶实时状态） | `src/pages/tools/tools.vue` | `src/services/vaccine.js`、`src/services/feeding.js` |
| 意见反馈 | 提交反馈（可带截图）、查看自己提交过的，以及管理员写的一句回复 | `src/pkg/feedback/feedback.vue` | `src/pkg/services/feedback.js` |
| 新手引导 | 六屏功能介绍（记录 / AI / 时光 / 工具 / 提醒 / 家人），可随时回看 | `src/pkg/onboarding/onboarding.vue` | `src/components/OnboardingGuide/index.vue` |
| 会员 | 会员权益对照 + 开通码兑换（按家庭开通，创建者操作）；会员制未上线时只显示状态卡 | `src/pkg/membership/membership.vue` | `src/services/membership.js`、`src/services/cloud/membership.js` |
| 运维后台 | 站内管理：运维概览 / 家庭与权限（管成员弹窗内含成员一览）/ 开通码 / 意见反馈（仅超级管理员） | `src/pkg/admin/admin.vue` | `src/services/cloud/admin.js`、`src/services/flags.js` |

---

## 2. 按页面组织的功能清单

### 2.1 时光 Tab

#### `pages/index/index` — 导航栏标题「时光」（tab 页）

- 顶部宝宝信息头：点整块弹出「守护家人」环绕动画（成员取自 `store.members`，不再发请求）。
- 顶部幻灯片：进入本页自动轮播最近 6 条媒体（视频显示封面；原先取 20 条，弱网下首屏要等一串大图）。
- 照片墙三种视图，**从左到右依次是 `全部`（三列瀑布流，按原图比例）/ `按月`（三列方格，本地时区归月）/ `文件管理`（相册，见下）**。视图选择存本机 `babyup.timelineView`，默认仍是「按月」。
  - 切换视图只改了标签顺序与「文件管理」这个名字，底层的 `key` 仍是 `all` / `month` / `album`，所以老用户存下来的偏好不需要迁移。
- **「文件管理」视图是两级的**：第一层列文件夹（缩略图 + 名字 + 张数）+ 固定的「未分类」入口 + 「+ 新建文件夹」；点进去才是那一叠照片（三列方格，顶部标题条左侧是「‹ 文件管理」返回，右上角「多选」）。
  - 长按文件夹行 → 进入排序模式，上下拖动调整顺序（`sort_order`），松手即落库；点「完成」退出。拖动的目标位置按「手指位移 ÷ 行高」算，行高常量 `ALBUM_ROW_RPX` 必须与样式里 `.album-row` 的 height 一致。
  - 文件夹行右侧「⋯」→ 重命名 / 删除。**删除时明确提示「里面的 N 张照片不会被删除，会回到未分类」**（服务端也是这么做的）。
  - 长按照片 → 直接弹「移动到…」；多选后底部操作条也能「移动到…」/「移出文件夹」。弹层是自绘的，因为 `uni.showActionSheet` 最多只列 6 项而文件夹上限 50。
  - **换了家庭 / 宝宝会自动退回文件夹列表层**（页面里 `watch(baseKey, ...)`）：待着的那个文件夹已经不属于新宝宝了，不退回就会停在一个「别人的文件夹」里 —— 标题还是旧宝宝的文件夹名、照片一张没有。
  - ⚠️ **文件夹清单的「要不要重拉」用的是 `baseKey()`（家庭 + 宝宝），不是带视图/文件夹的 `contextKey()`**，而且这个 key 必须在**发请求之前**取好、回来只认它（`loadAlbums` 里请求返回后还会再比一次，不一致就丢弃整份结果）。踩过的坑：以前是等接口回来再算一次 key 存进去，只要请求跑着的时候切了宝宝，存下的就是新宝宝的 key 而 `albums` 里是旧宝宝的数据，之后永远判定为「已经是最新」，旧文件夹一直挂在界面上直到重启小程序。
- 悬浮「+」按钮：可拖动换位，轻点弹「照片（可多选）/ 视频」，位置存本机 `home_fab_pos`；多选模式下自动收起。
- 下拉刷新、触底加载更多（每页 20 条，`CACHE_TTL` 30 分钟复用上次结果）。
  - ⚠️ **「去别的页面再回来，照片全没了」的根因在 store，不在这里**：回前台/切页超过 30 秒会触发上下文刷新，而 `loadBabies` 原来是「先把 `babies` / `currentBabyId` 清空再填」，于是 `store.baby` 会短暂为 `null` → 页面 `watch(baseKey)` 误判成「换了宝宝」把 `photos` 整批清空；紧接着 `shouldReload()` 又因 `CACHE_TTL` 30 分钟判定「不用重拉」，页面就空着不动了。修法是 store 侧**先查再替换**（`switchFamily` 里换家庭时仍显式先清）。

| 项 | 内容 |
| --- | --- |
| 读写数据 | 读 `baby_photos`（分页 + 覆盖只写权限）；读 `photo_albums`（文件夹清单）并为每个文件夹统计张数与封面（`summarizeAlbums`） |
| 依赖组件 | `src/components/PhotoComposer/index.vue`、`src/components/FamilyOrbit/index.vue`、`src/components/AppTabBar/index.vue` |
| 关键变量 | `canWrite`（`src/pages/index/index.vue`，来自 `store.canWrite`，控制 `PhotoComposer`、「+」与文件夹编辑入口是否渲染） |

### 2.2 记录 Tab

#### `pages/record/record` — 导航栏标题「记录」（tab 页）

- 「今日小结」卡：实时聚合当日喂养/睡眠/便便/照片/生长/疫苗，可展开当日明细时间线。
- 喂奶提醒横幅：宝宝开启提醒且距上次喂养超过间隔上限时置顶提示。
- 「生成分享图」：把今日小结画成 canvas 卡片，可保存到相册或转发给家人。
- 「AI 小结」：让 AI 说一句今天怎么样，可复制/重新生成，同一天只成功生成一次（本机缓存）。
- **「AI 观察」卡**（今日小结卡上方）：规则判断出一条值得留意的事，点整卡带问题跳到 AI 助手（`?q=` 预填输入框、不自动发送）。同一张卡里还带**作息预测**（按自家近几天实际节律算「下一次喂养大约几点 / 夜里通常几点入睡」）—— 两者都不调模型、不花额度。观察窗口 7 天，与小结共用同一批记录。
- 「一句话记一笔」入口：仅 `canWrite && aiReady` 时渲染。
- 九宫格记录项（共 9 项）+ 右侧「记录项」工具栏：本机开关控制显示哪些，存 `babyup.recordEntryHidden`。
  - **默认只放「喂奶」与「睡觉」两项**（`DEFAULT_VISIBLE_ENTRIES`）——这两个是每天必记的，宫格从九个变两个，一眼就知道点哪儿；其余 7 项要去右侧面板自己打开。
  - 存储沿用「存被关掉的那些」的写法：**没存过**才走默认；**存过**（哪怕是空数组，即用户手动全打开）就完全尊重本机选择，不再被默认值覆盖。这样以后新增记录项也仍是默认显示，不用迁移旧数据。
- 下拉刷新：重新聚合今日小结与 AI 观察（`src/pages.json` 里本页开了 `enablePullDownRefresh`）。刻意**不**在这里补生成 AI 小结 —— 那要花模型额度，且一天只补一次。
- 首次进入的轻引导（`babyup.recordGuideSeen`，只显示一次）；只读成员显示只读说明卡。
- **启动动画**（`src/components/LaunchSplash/index.vue`）：记录页是本项目声明的启动页（`pages.json` 的第一项），冷启动第一次进本页时放一次，1.4s 后淡出，点哪里都能跳过。
  - ⚠️ **它是同步判定、首帧就铺上去的**（`const splashVisible = ref(shouldPlaySplash())`），依据只有本机登录态（`api.session.get()`，同步读 storage）与一个内存变量 `splashPlayed`（切 tab 回来不重放、重启小程序才重放）。**不要改成在 `onShow` 里 `await store.bootstrap()` 之后再显示** —— 那样会变成「记录页先露出来 → 网络回来 → 启动页突然盖上来 → 再淡出」，看起来就是启动页莫名其妙闪一下（踩过）。
  - 「有没有家庭」这条同步判不了，放在 `onShow` 里 `bootstrap()` 之后补判：没有家庭的人马上会被改道去建档页，动画会立刻收掉。

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

- 8 张工具卡：辅食资料库、AI 照护助手、生长曲线、成长报告、每日小结、疫苗与提醒、喂奶参考与提醒、宝宝安睡音。
- 有功能开关的卡按 `flagEnabled(key)` 过滤（`solidFood` / `report` / `daily` / `sleepSound`），运维关掉后整项不渲染。
- AI 卡按 `isAiChatAvailable()` 过滤，不可用时整项不渲染。
- 疫苗卡显示实时状态「待接种 N · 已逾期 N」（`loadVaccineBadge`：只取 `id / scheduled_date / vaccinated_date` 三列，窄字段、不排序）。
- 喂奶卡显示「未开启提醒」或「每 X 小时 Y 分」（纯计算，不发请求）。
- 卡片下方是**广告位**（`src/components/AdBanner/index.vue`）：只留了结构，默认不显示 —— 开关关掉、广告位 id 为空、非微信端，三种情况整块都不渲染（`v-if` 都过不了，页面上零痕迹）。只有超管在运维后台打开并填了 Banner 广告位 id 才会出现。

| 项 | 内容 |
| --- | --- |
| 读写数据 | 读 `vaccinations`（状态）；广告位配置读 `adsConfig`（`app_config` 的 `ads` 文档）；其余为导航 |
| 依赖组件 | `src/components/AppTabBar/index.vue`、`src/components/AdBanner/index.vue` |
| 关键变量 | `ensureAds()`（进本页拉一次，配置全局、不跟家庭走）、`bannerUnitId()` |

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
| `src/pages/login/login.vue` | 登录 | 微信一键登录（`#ifdef MP-WEIXIN`）；`capabilities.phoneLogin` 时显示手机号注册/登录与忘记密码；首次登录弹协议确认层；登录后优先回到分享带来的邀请码；底部有一块**未登录可见的产品说明**（`HIGHLIGHTS`，给搜一搜进来的陌生人看，见第 7 节） | `src/stores/auth.js`、`src/utils/legal.js` |
| `src/pkg/forgot-password/forgot-password.vue` | 找回密码 | 输入绑定邮箱发送重置邮件；输入手机号时给出绑定引导 | `src/stores/auth.js` |
| `src/pages/setup/setup.vue` | 开始使用 | 第一步建家庭（或跳「加入已有家庭」），第二步建宝宝档案（昵称/生日/性别，可跳过） | `src/services/family.js`、`src/services/baby.js` |
| `src/pages/join-family/join-family.vue` | 加入家庭 | 输入 6 位邀请码加入，大写归一并过滤非法字符；从分享链接 `?code=` 带入 | `src/services/family.js` |
| `src/pkg/family/family.vue` | 家庭成员 | 家庭改名（仅 owner）、按角色/有效期生成邀请码并复制/分享、改我的昵称、成员列表改角色/移除、邀请码记录（撤销 / 删除）、退出家庭（owner 不可退出） | `src/services/family.js` |
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
                 ├─ free    → AI 共用 5 次/天、AI 上下文近 7 天
                 └─ member  → AI 共用 50 次/天、AI 上下文近 30 天
```

**1）凡是会调用模型的功能，都吃同一份额度**（问答 / 每日小结 / 一句话记一笔 —— 只有它们真烧 token）：

| 功能 | 是否按档位限制 | 说明 |
| --- | --- | --- |
| AI 问答 · AI 每日小结 · 一句话记一笔解析 | ✅ | **共用一份**：免费 5 次/天、会员 50 次/天 |
| AI 每日小结（豁免） | ✅ | 额度用完之后小结仍可多用 `AI_SUMMARY_GRACE` = 1 次，再用才挡（它是进记录页自动触发的，被挡掉就只剩空卡） |
| AI 明细上下文天数 | ✅ | 免费 7 天、会员 30 天（`contextDays()`） |
| 记录 / 时光 / 工具 / 疫苗 / 辅食 / 报告 / 观察与作息预测 | ❌ | **不调模型，与额度无关**。AI 观察与作息预测都是纯规则（`services/ai-insight.js`），零 token |

额度由 `actionAiUsage` 裁决：**额度按「家庭档位」取，记账按「人」**（`ai_usage` 集合，key = `user_id` + 北京日期）。三条约定：
- **先扣后调、失败不退**（否则「刷失败」就能把额度刷回来）；
- `peek = true` 只读不扣（AI 页顶部显示「今天还能问几次」不能反过来吃掉一次）；
- `kind = 'summary'` 时上限是 `limit + AI_SUMMARY_GRACE`，其余调用一律按 `limit` 卡死。

三处调用点都靠 [streamChat](file:///e:/workspace/个人项目测试/chenfen/src/services/cloud/ai.js) 这一道闸门（`counted` 默认 true）。超限时服务端回 `AI_QUOTA_EXCEEDED`，前端统一走 `isAiQuotaError()` 判定 → `promptAiQuotaUpgrade()` 弹「去开通会员」（会员制关着时只提示明天恢复，不引导开通）。

**⚠️ 额度用完不能等用户点了才说**（否则是「打完一行字才被拦」/「按钮点了没反应」，体验很差）。三个入口都改成**常驻提示**，依据是 `services/ai-quota.js` 的只读快照（AI 页、记录页 `onShow` 各刷一次，不扣次数）：

| 位置 | 额度用完时 |
| --- | --- |
| AI 助手页输入区 | 整块换成「今日 AI 次数已用完 · 去开通会员」，输入框与发送键都不再出现 |
| 记录页「AI 小结」卡 | 按钮换成同一句提示，并藏掉「重新生成」；`ensureDailySummary()` 也不再自动生成（否则一进记录页就弹窗） |
| 记录页「一句话记一笔」 | 整块置灰（`.quick-ai--off`），说明文案改成已用完提示 |

点提示条走 `goAiQuotaUpgrade()`（会员制开着直接进会员页，关着只 toast 明天恢复）；只有「额度在停留期间才被用完」这种被动场景才走 `promptAiQuotaUpgrade()` 弹窗。

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

四个页签（底栏是等分 flex，所以标签用短词，完整名字写在各页的标题上），数据全部走 `data` 云函数的 `admin*` action，服务端按**写死的 openid 白名单**鉴权（前端藏入口只是 UX）：

| 页签 | 能做什么 |
| --- | --- |
| 概览 | 近 N 天记录 / AI 用量 / 行为埋点 / 报错分组 + 规模统计；顶部有「待处理意见反馈 N 条」提示卡（`pendingFeedbackCount`），可一键跳到反馈页签 |
| 家庭 | 全局功能开关（总闸）、**广告位**（工具页 Banner 的开关 + 广告位 id）、每家卡片（改档位 / 功能开关例外 / 管成员 / 删家庭） |
| 开通码 | 台账列表（未用 / 已用 / 已作废 / 全部）+ 批量生成（数量 / 天数 / 备注，生成后**整批复制到剪贴板**）+ 复制码 / 作废 / 恢复 |
| 反馈 | 待处理 / 已处理 / 全部筛选；看提交人、内容、截图（可点开大图）、联系方式；「处理」可改状态并写一句回复 |

> 「全部成员」原先单独占一个页签（按人看），与「家庭」页签（按家看）是同一批人的两种排法，单开一页只是把信息换个地方再列一遍 —— 现在并进各家的**「管成员」弹窗**：每行除了昵称（含 openid 后 6 位）、角色、加入时间，还会补一句这个人「是不是超级管理员、还在哪些家」（`memberExtra()`，数据来自 `adminUsers`，在 `openMembers()` 里与这家的成员列表并行拉取）。

> **功能开关是「总闸 + 分闸」，不是「家庭覆盖优先」**：服务端 `resolveFlags()` 写的是 `globalOn ? family[key] !== false : false`，也就是**全局关掉的功能，哪一家都开不回来**（家庭里标「开」也不作数）。各家卡片的「功能开关」弹窗里，「当前生效」按同一算式显示；**全局已关的项会把「开」置灰**（`flagLockedByGlobal()`），选中也只报一句「这项已被全局关闭，本家开不了」。家庭页（创建者自助改的那处）同样是这个语义，见 `flagGlobalOn()` 的禁用与「已被管理员全局关闭，本家改不回来」提示。

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
| 1 | 时光 | `pages/index/index` | 宝宝信息头（家人环绕动画）、照片幻灯片、照片墙（全部/按月/文件管理）、文件夹的增删改与拖拽排序、可拖动「+」上传、照片详情 |
| 2 | 记录 | `pages/record/record` | 冷启动的启动动画、AI 观察 + 作息预测卡、今日小结 + 明细、喂奶提醒横幅、生成分享图、AI 小结、一句话记一笔、记录宫格（共 9 项，默认只显示喂奶/睡觉）、记录项显隐工具栏、历史→每日小结 |
| — | （中间 AI 按钮） | `pkg/ai-chat/ai-chat` | 非 tab，`navigateTo` 打开；后端不支持时 toast 提示 |
| 3 | 工具 | `pages/tools/tools` | 辅食资料库、AI 照护助手、生长曲线、成长报告、每日小结、疫苗与提醒、喂奶参考与提醒、宝宝安睡音、广告位（只留结构，默认关） |
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
| 照护助手问答 | 工具页 AI 卡 / 底栏中间 AI 按钮 / 记录页 AI 观察卡 / `pkg/ai-chat` | `askAssistant()` → 内部 `buildBabyContext()`（拉近 7~30 天明细 + 近 30 天汇总 + 生病/生长/疫苗/体检/里程碑 + 照片备注）→ 拼 `parenting-knowledge` 知识 → 流式返回；前端自己数出「依据：…共 N 条原始记录」显示在回答下 |
| 一句话记一笔 | 记录页 `canWrite && aiReady` 时显示；也可从 AI 助手回答下的「记成一笔」进来（原话经 `babyup.aiQuickPrefill` 交接，自动解析一次） | `parseQuickRecord({ text, familyId })` 解析成 `kind` + 字段 → `assertQuickRecord()` 校验 → 确认卡按 `KIND_HANDLERS` 分派到 `createFeeding`/`createSleep`/`createDiaper`/`createGrowthRecord`/`createIllnessRecord`/`createMilestone`。喂养支持「剩余多少」（`leftoverMl`），实际摄入按 `amount_ml - leftover_ml` 算 |
| 每日小结与观察/作息预测 | 记录页「AI 小结」；记录页顶部「AI 观察」卡 | 小结：`summarizeDay()` + 本机缓存 `loadDailySummary`/`saveDailySummary`（按账号+宝宝+日期，同一天只成功一次）；**占当日 AI 额度**（与问答共用，超额 1 次豁免）。观察 `buildInsight()` 与作息预测 `predictRhythm()`：**规则**而非模型，读喂养/睡眠/便便/疫苗后给出一条观察文案与追问问题，以及「下一次喂养 / 夜里入睡」的大概时刻 |

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

---

## 7. 搜一搜落地：陌生人第一眼看到什么

未登录用户会被 `src/utils/routeGuard.js` 改道到 `pages/login/login`，所以**搜索进来的人落地的就是登录页**，不是记录页 —— 想让陌生人知道「这是什么、和同类差在哪」，只能写在登录页上（写在记录/时光页等于谁都看不见）。

| 位置 | 写什么 | 依据 |
| --- | --- | --- |
| 登录页底部说明块 | `HIGHLIGHTS` 里的文案，渲染时用 `highlights` 过滤掉被关掉的功能（**AI 那条跟着 `aiChat` 开关走**，默认不显示）。五条：一键打卡（喂养/睡眠/便便/疫苗/体检）、全家一起记、AI 解读作息、喂奶与疫苗提醒、照片自动成成长时间轴。刻意贴口语，保持整句，不堆砌关键词 | `src/pages/login/login.vue` |
| 默认分享标题 | `SHARE_TITLE`：`宝宝的喂养睡眠记录，全家一起记`（卡片本来就显示小程序名与图标，标题的位置留给「这是什么、对谁有用」） | `src/utils/share.js` |

> ⚠️ **AI 卖点为什么必须跟着开关显隐**（2026-09-30 真事）：提审被驳回，理由是「涉及文本深度合成技术（AI问答）」，要求补「**深度合成-AI问答**」服务类目并在 AI 生成页加标识。而**深度合成四个类目都不对个人主体开放**（官方口径：属个人主体尚未开放服务类目），**加标识也过不了** —— 只能**关掉 `aiChat` 开关**再提审（关掉后底栏 AI 按钮、工具页入口、一句话记一笔、AI 观察/AI 小结/AI 助手全部消失，小程序变成纯记录工具，与现有类目相符）。
>
> 由此推出一条通用规则：**页面上不能出现某个功能的字样，而那个功能被开关关着** —— 会被判「描述与实际功能不符」而驳回。所以登录页那条 AI 卖点改成跟着 `aiChat` 显隐（读不到一律不显示，见 `aiOn`），后台「介绍」在关 AI 期间也要换成不含 AI 的文案。
>
> 以后若要把 AI 开回来，唯一合规路径是换非个人主体（个体工商户也行）+ 微信认证 + 走腾讯云开发的「小程序算法备案」生成材料，再补「深度合成-AI问答」类目。

> ⚠️ **不要加 `sitemap.json` 去「让页面被收录」**：微信小程序的默认行为就是「所有页面都可被索引」，`sitemap.json` 只能用来**关闭**某些页面的索引（末尾隐含一条优先级最低的 `{"action":"allow","page":"*"}`）。写一堆 allow 规则既不会扩大收录，也容易写错路径（分包页真实路径是 `pkg/vaccine/vaccine`，不是 `pages/record/vaccine`）。
>
> 另外：搜一搜排名的权重里，**用户行为数据（点击率 / 停留 / 复访）远大于文案与关键词**，页面文案只能算入场券；名称、简介、服务类目与微信认证都在微信公众平台后台，代码侧改不了。
>
> ⚠️ 还有个容易踩的坑：**「自定义推广关键词」功能 2018 年 4 月 3 日就被微信关闭了**（官方口径：已支持机器算法做模糊搜索，开发者无需再上传词汇与审核），后台根本没有这个入口。网上大量 2017~2019 年的教程还在流传，别照着去翻「推广 → 关键词」——找不到是正常的，不是配置漏了。原来指望它拿的那部分权重，现在靠**简介 + 服务类目 + 页面内容 + 用户行为**。

---

## 8. 照片放映：为什么不做"生成视频文件"

有需求提过「把时光里的照片做成幻灯片视频」。结论：**端上做不到，服务端成本高，所以做成全屏放映页，不产出视频文件。**

**为什么端上做不了**：微信唯一的音视频合成 API 是 `wx.createMediaContainer`，它的 `extractDataSource` 参数写得很明确 —— `source` 是「**视频源地址，只支持本地文件**」，轨道类型只有 audio / video。**图片不能作为轨道加进容器**，所以"图片 → 视频"这条路在端上是封死的。

**服务端（云函数 / 云托管 + ffmpeg）的代价**：ffmpeg 静态二进制约 80MB 要塞进代码包（冷启动慢）；照片在**私有云存储**，要先下载再合成再上传；云函数的执行时长与内存限制容易碰到；很可能超出免费额度。以"只给家人用、不想花钱"的前提，不值。

**做出来的东西**：`src/pkg/slideshow/slideshow.vue` —— 全屏 `swiper` 自动播放（**4 秒一张**、循环、可暂停、可手动左右翻），深色底，底部进度条随每张走一遍，顶栏显示第几张 / 共几张；可分享卡片，家人点开就是同一场放映。

**为什么要加"说明层"与 Ken Burns**：第一版只有图，用户反馈「**没有文字，感觉就像个全屏轮播**」。所以每张照片叠了一层说明：**拍摄日期 + 拍照当时的月龄 + 照片备注**（`dateText()` 用 `formatDate`，`ageText()` 用 `formatAge(baby.birthday, taken_at)`，任一取不到就只显示另一半），底下压一条由透明到黑的渐变做可读性底衬；同时给**当前这张**加**缓慢放大**（Ken Burns，`scale(1 → 1.08)`，时长比停留略长所以一直在动）—— 这是"照片电影"最标志性的动效，也是它和"轮播"最直观的区别。

**选片（默认全部，可选几张）**：顶栏「选片」打开一个深色网格面板（三列，`scroll-view` + `lazy-load`，只下载可见的缩略图）。**不勾 = 全部播放**（这是默认态）；勾了就只播勾中的那些，且**按原本的时间顺序**排（幻灯片是"时间流"，不能按点击顺序）。面板里每格带短日期（同年只显示 `9/17`），便于快速认图；「清空」= 回到全部播放，不是"一张都不播"。播放集合变化时 `watch(items)` 把序号归零，免得停在上一个集合的序号上。

**几个刻意如此的决定**：

1. **只放照片，不放视频** —— 视频在幻灯片里没法自动播（点了才出声），混进去会停在那儿不动。所以 `load()` 里把 `media_type === 'video'` 过滤掉。
2. **最多 60 张**（`MAX_PHOTOS`）—— 既是"全部播放"的上限，也是选片列表的长度；4 秒一张约 4 分钟，再多没人看完。这个数同时压着内存，**`swiper` 会把所有 slide 一次渲染出来**；实测 60 张在手机上正常，以后若有人反馈卡顿，先调小这个数，或改成"只渲染当前 ±1 张"的自研播放器。
3. **背景声（2026-10-09 新增）**：原来这条写的是「不发背景音乐 —— 内置一首要有版权，让用户选歌小程序读不到本机音乐库」。后来按用户要求补上了，但**只放自制合成的曲子**，不碰任何第三方音乐，所以版权问题不成立；「读不到本机音乐库」这一点依旧，所以不提供「选本地音乐」。音源与安睡音**共用同一份库**，见第 10 节。
4. **页面自己去拉照片**，不复用时光页已加载的那一页 —— 时光页是分页加载的，复用只会播前 20 张。
5. **暂停时动效也要冻住**：进度条用 `animation-play-state: paused`，Ken Burns 同理，否则"暂停"只停切换、画面还在动。
6. **打开选片面板时先暂停**（动画干扰看格子），关掉时**恢复打开前的状态**（用 `wasPlaying` 记住），不是无脑继续播。
7. 分享卡片的两个已知点：**未登录的家人**点开会被路由守卫送去登录页、登录后落在记录页（不是放映页）；**分享出去的永远是"全部"，不带这次勾选的那几张**（把一串 id 塞进 path 既长又易失效）。两者都与项目里其它分享的行为一致，先接受。
8. **顶栏不能放可点元素 —— 微信胶囊会抢走点击**（2026-09-30 用户实测踩到）：`navigationStyle: custom` 下，微信右上角的胶囊（`···`）浮在最上层、**点击优先级高于页面内容**。第一版把「选片」放在顶栏右侧，结果用户一点就弹出胶囊的分享菜单。修法两层：① 可点的东西一律不往右上角放（「选片」移到**底部操作条**，离拇指也更近）；② 用 `uni.getMenuButtonBoundingClientRect()` 取胶囊位置与高度，用 `padding-right` 把那一整块让出来，顺便让顶栏的上下留白和胶囊齐平（`topBarStyle`）。选片面板的标题栏共用同一套内距 —— 那里右上角也有一个「✕」。
   > ⚠️ 这条的准确含义是「**不能放进胶囊那一块区域**」，不是「顶栏右侧一律不能放」。2026-10-09 加的「背景声」按钮（`♪`）就放在标题右边 —— 它落在 `topBarStyle` 让出来的内距之内、即胶囊左边 8px 处，不重叠，所以安全。判断标准是**和胶囊矩形有没有交集**，不是它离右边多近。
   > 本项目**只有放映页**用了 `navigationStyle: custom`（`pages.json` 里唯一一处），所以这个坑只在这里需要防。
9. **`scroll-view` 必须有"确定的高度"才会滚**（2026-09-30 用户实测踩到：选片列表滑不动）：光给 `flex: 1` 在微信端不保险。可靠写法是外面套一层普通 `view`（`flex: 1; overflow: hidden; position: relative`）——普通 view 能拿到剩余高度 —— 再让 `scroll-view` 用 `position: absolute; top/right/bottom/left: 0` 铺满它，高度就确定了。内部网格用 `flex-wrap` 排三列（比 `inline-block` 稳，不会因为标签间的空白把第三列挤下去）。

---

## 9. 安睡音：从「前台合成」到「云存储音频 + 后台播放」

需求原话是「睡眠轻音乐 + 白噪音」。**两半最后都做了**：白噪音 / 环境音这条线用「后台音频播放」实现息屏也能放；有旋律的轻音乐（摇篮曲 / 八音盒 / 星光）是 2026-10-09 补上的**自制合成**曲子。音频素材都不打包进代码包，放在云存储。

### 「睡眠轻音乐」这条线：先绕开，后来自己合成补上

当初不做，是两个问题叠在一起：

1. **版权**——有旋律的曲子是音乐作品，要么买授权、要么盗版；
2. **类目**——微信《小程序备案服务内容选择指引》里 `休闲娱乐 > 音乐、电台、有声读物` 一栏写明「音乐：适用于提供**音乐在线播放**等服务」，**个人备案不建议选择**，单位备案还要《网络文化经营许可证》。上一个被驳的功能（AI 深度合成）就是栽在类目上，不重蹈。

2026-10-09 补做时（本来是为放映页做的，之后也放回本页）：**版权那条靠「自己按公式合成」解掉了** —— 产物归本项目，不是第三方音乐作品；**类目那条没有解**，只是继续压低姿态（见下面「留的合规退路」）。

产品上刻意做成「**工具**」而不是「播放器」：只有固定的几个音源、没有列表页 / 没有搜索 / 没有曲库，文案里**不出现「音乐 / 歌曲 / 曲库 / 歌单」**。

### 为什么是「云存储音频 + 后台播放」

先做过一版**纯前端 WebAudio 现场合成**的（零文件、零流量、零版权、真无缝），但它只能**前台**播：小程序的音频绑在页面上，屏幕一黑、退到后台就被系统挂起。当时的折中是「播放时用 `setKeepScreenOn` 不让屏幕自动息屏」，实测**费电、手机发热、放宝宝旁边还刺眼**，不可接受。

要真息屏只能换 `wx.getBackgroundAudioManager()` —— 而它只能播**真实音频文件**，于是：

| | 方案 |
|---|---|
| 素材 | 不打包进代码包（单个分包有 2MB 上限，13 个 WAV 加起来 14MB+），改放**云存储** `sleep-sound/*.wav` |
| 播放源 | 播放前先 `wx.cloud.downloadFile` 拉到本地临时文件再交给播放器（默认 `local` 模式），循环时不用再联网 |
| 生成方式 | 素材不是找来的，是 `scripts/gen-audio.mjs` 按公式算出来的：环境音 16kHz / 30 秒 / 首尾交叉淡化，旋律 22.05kHz / 8 小节 / 音符余韵绕回开头，循环接缝都听不出来 |

**必须接受的三个代价**（官方 API 定的，绕不过去）：

| 限制 | 后果 |
| --- | --- |
| **没有 `volume`** | 音量**只能按手机侧边的音量键**，页面上的音量滑块已去掉；定时关闭也做不了「渐弱」，到点直接停 |
| **没有 `loop`** | 靠 `onEnded` 里 `seek(0)` + `play()` 接上；1.2 秒还没播起来就重设 `src` 兜底（会重新加载，但保证不停） |
| **必须填元数据** | `title` / `singer` / `epname` / `coverImgUrl` 必填（不填 iOS 不给播），于是**锁屏与下拉控制中心会出现一个媒体面板** —— 对记录类小程序违和，也是审核判「音乐类目」最直接的证据（退路见下） |

另外还要在 [manifest.json](file:///e:/workspace/个人项目测试/chenfen/src/manifest.json) 声明 `requiredBackgroundModes: ["audio"]`，并在小程序后台「开发 → 开发管理 → 接口设置」确认有没有「音频播放后台运行」这一项（有就打开，找不到说明不用单独申请）。

⚠️ **后台播放只有真机能验证**：开发者工具模拟不出来；iOS 微信还要 ≥ 8.0.22。

### 音频素材怎么来的（`scripts/gen-audio.mjs`）

素材不是找的、也不是录的，是按公式算出来写成 WAV。**环境音与旋律共用这一个脚本**（素材清单也只有一份，见第 10 节）：

- 十个环境音各一个填充函数，往 `Float32Array` 写样本：白噪音 = 均匀随机；粉噪音 = Paul Kellet 近似（-3dB/倍频程）；棕噪音 = 带泄漏的积分（-6dB/倍频程）；雨声 = 低通底噪 + 高通残差做「沙沙」颗粒，叠强度起伏；海浪 = 棕噪音 × 往复包络 + 一点高频当浪花；风 = 极低频底噪 × 阵风包络；溪流 = 高通残差（明亮细碎）；风扇 = 宽带底噪 + 14 转/秒的叶片起伏；心跳 = 每秒两下低频闷响（lub-dub，52Hz / 42Hz + 指数衰减）；钟摆 = 每秒一记柔和的两泛音「嗒」（衰减约半秒）。
  > ⚠️ 「钟摆」本来写成「两秒一记、每次 70ms」，结果 96% 的时间是静音 —— 为了把平均响度抬到和其他素材一样，增益把那一记推到削平（峰值顶到 1.0），加了峰值上限后 RMS 只剩 0.04，单独播放等于没声音。改成「一秒一下、衰减慢」才让峰值和响度同时站得住。
- **无缝循环**：30 秒缓冲，多算 0.5 秒尾巴，用交叉淡化叠回开头再截断。不做的话棕噪音和海浪在接缝处会有明显「咔哒」声。（三首旋律用的是另一套做法：音符余韵绕回开头，见第 10 节。）
- **响度归一**：按 RMS 归到 0.18，**再加一道峰值上限 0.95** —— 光按 RMS 归会把「大部分静音、偶尔一响」的素材推爆（改之前心跳有 899 个样本被削平、海浪 6 个）。后台播放没有音量接口，电平直接决定听感，不能调大。
- 输出 16kHz 单声道 16-bit PCM（938KB/首）。改音色、改时长后 `node scripts/gen-audio.mjs` 重跑一遍，再把 `scripts/out/sleep-sound/` 整个传到云存储同名目录即可（产物已进 `.gitignore`）。

### 播放器要点（`src/pkg/utils/noise.js`）

- 只用 `wx.getBackgroundAudioManager()`；它是**全局单例**，页面不持有它，状态靠 `onPlay / onPause / onStop / onEnded / onError` 事件回传给页面（**必须挂**：用户可能在锁屏媒体面板上直接暂停，那种操作页面收不到点击）。H5 / 非云开发后端下 `isSleepSoundSupported()` 返回 false，页面降级成「暂不可用」。
- src 的解析（拼云文件 ID → `wx.cloud.downloadFile` 下到本地临时文件 → 按 key 缓存）统一放在 `src/pkg/utils/sound-library.js`，安睡音与放映页共用；`noise.js` / `bgm.js` 都不自己拼路径。本机覆盖：控制台 `wx.setStorageSync('babyup.soundSrc', 'cloud')` 可切回直连云文件（排查用）。
- 元数据 `title`（音源名）/ `epname` / `singer` / `coverImgUrl` 都要填；封面图用 `wx.cloud.getTempFileURL` 取签名地址，一次会话只取一次。
- **离开的语义分两种**：息屏 / 切到别的应用走 `onHide`，**不停**（后台播放就是为这个）；返回上一页走 `onUnload`，**停**（不然会变成一段没人管的播放）。

### 两个体验细节

- **定时关闭**（15/30/60 分钟）：到点**直接停**（后台播放没有音量接口，做不了「渐弱」），倒计时显示在状态行上。
- **记住上次的选择**（音源 / 定时档，存 `babyup.sleepSound`），下次进来不用重新调。

### 留的合规退路

它终究是音频播放，仍可能被审核判成「音乐」类目。所以入口挂了功能开关 **`sleepSound`**（运维后台可全局关、也可按家庭关），真要下架时点一下就能整块收起，**不用重新发版**——和 AI 那次是同一套做法。同理，页面文案、工具页描述都避开了「音乐」字样。

> ⚠️ **音源库是共用的，开关却是分开的**：关掉 `sleepSound` 只收起本页入口，不会连带收起放映页（那边是 `slideshowBgm`）；反过来也一样。类目真被卡，**两个都要关**。

---

## 10. 放映背景声：与安睡音**共用一份音源库**（2026-10-09）

需求原话是「时光页的那个幻灯片能不能配背景音乐呢」。第一版给放映页单独做了一套音源（另建目录、另写下载逻辑），随后按用户要求**统一管理**：音源只留一份，由安睡音那边管，放映页直接用 —— 于是原来那 3 首自制旋律也**放回了安睡音**（需求原话本来就是「睡眠轻音乐 + 白噪音」，这下两半齐了）。

### 统一后的结构

**一处真源**：`src/pkg/utils/sound-library.js`

| 内容 | 说明 |
| --- | --- |
| `SOUNDS` | **13 首内置**（10 环境音 + 3 旋律）+「自己存的」，两个页面渲染的都是这一份 |
| 云存储目录 | 只有 `sleep-sound/` 这一个（旋律不再单独放 `slideshow-bgm/`） |
| `resolveSoundSrc()` | 拼云文件 ID → `wx.cloud.downloadFile` 到本地临时文件 → 按 key 缓存；两个播放器都调它，谁都不自己拼路径 |
| 本机覆盖 | `wx.setStorageSync('babyup.soundSrc', 'cloud')` 可切直连云文件（排查用，原先两个模块各有一个 key） |

这个模块和 `noise.js` / `bgm.js` 一样放在 `src/pkg/` —— 只有分包页面在 import 它们，放主包会被「主包内不应存在主包未使用的 JS 文件」判掉（理由见 [代码架构](/guide/architecture.md)）。

### 为什么两个页面用**不同**的播放器

| 播放器 | 用在哪 | 取舍 |
| --- | --- | --- |
| `wx.getBackgroundAudioManager()`（`noise.js`） | 安睡音 | 要看一晚上，必须能**息屏/后台播**；代价是**全局单例**、必须填元数据（锁屏会冒出媒体面板） |
| `wx.createInnerAudioContext()`（`bgm.js`） | 放映背景声 | 独立实例、**自带 `loop` 和 `volume`**、不惊动锁屏；代价是**只在前台响** |

决策理由：

1. **单例会互顶**：`getBackgroundAudioManager()` 返回同一个实例，放映页设 `src` 会把安睡音顶掉，反过来也一样；而安睡音的 `onStop/onPause` 逻辑会把这种「被顶掉」误判成「用户主动停了」。
2. **放映本来就是盯着屏幕看的场景**，不需要后台播；而且锁屏媒体面板正是审核判「音乐类目」最直接的证据，能不出就不出。

所以放映页**自己在 `onHide` 里停**（切应用 / 息屏就停，省电），`onUnload` 里 `destroy()`（否则一直占着一个音频池）。

### 旋律怎么合成的（`scripts/gen-audio.mjs` 的后半段）

三首：`lullaby`（摇篮曲）/ `musicbox`（八音盒）/ `starlight`（星光）。跟环境音同一套「按公式合成、产物归本项目」的路子，**不碰任何第三方音乐**。和环境音只有参数与循环手法不同：

- **素材**：22.05kHz 单声道 16-bit WAV，72 BPM、8 小节（26.7 秒），各约 1.12MB，与 6 个环境音**同放** `sleep-sound/`，不进代码包。
  - 采样率比环境音的 16k 高：八音盒的泛音能上好几 kHz，16k 会明显发闷。
- **音色**：`addBell()` = 基频 + 3 个泛音（含一个**非整数倍** 4.2 倍频，八音盒的金属味靠它）× 指数衰减；`addBass()` = 正弦慢起慢落；`addPad()` = 长音铺底。
- **无缝循环的做法和环境音不同**：环境音是「首尾交叉淡化」，旋律不行（会把音符尾巴抹掉）。旋律让**音符余韵绕回开头** —— 越界的采样用 `(start + i) % LEN` 直接加到缓冲区开头，循环点的能量天然连续。前提是 `LEN` 落在**整数拍**上（22050 × 32 × 60 / 72 = 588000，正好整除），所以末句刻意收在主音、接回第一句不别扭。
- **pad 的颤音周期必须等于整首循环长度**（用 `1 / loopSec` 当 LFO 频率），否则循环点能听到音量跳一下。
- 自检（听不到声音时的替代）：峰值归一化到 0.82，RMS 0.10~0.17；**首尾采样差（0.03~0.05）比波形里正常的相邻采样跳变还小**，即循环点没有额外的不连续。

### 页面交互

- **入口**：顶栏标题右边的 `♪` 按钮（位置说明见第 8 节）。关闭态是灰底，**真的在响**才变主题色，正在加载（首次要下载音频）时半透明 —— 避免「点了没反应」。
- **面板**：底部抽屉里的 3 列网格，列出**与安睡音完全相同的那些格**（关闭 + 13 首内置 + 自己存的）。用网格不用竖排列表 —— 十几项竖排在小屏上会顶破屏幕。选了立刻生效并**记到本机**（`babyup.slideshowBgm`，只存本机、不跟账号走）。
- **默认关闭**：自动出声在公共场合很唐突，所以第一次进来是静音的，用户选过一次后下次自动放。
- **降级**：H5 / 非云开发后端下 `isBgmSupported()` 返回 false，入口整个不渲染。

### 留的合规退路

放映配乐**比安睡音更像「音乐播放」**（有曲子、有选择面板），所以单独挂了功能开关 **`slideshowBgm`**。真要下架时**优先关它**，再考虑 `sleepSound`；两个开关互不连带，要一起关（见第 9 节末尾）。

---

## 11. 声音工坊：自己调一个（2026-10-09）

需求原话是「能不能实现实时生成的，比如说我选择一些条件，可以给我生产出声音」。第 9/10 节那些是**固定的 13 首**，工坊给的是「自己叠一个」。

### 两条路，缺一不可

| | 怎么做到 | 代价 |
| --- | --- | --- |
| **试听（实时）** | `wx.createWebAudioContext()` 在**内存里**算出 12 秒样本、`loop` 循环播放 | **只在前台响**：小程序的前台音频会被系统挂起，息屏/切后台就停 |
| **存下来** | 同一套公式按 22.05kHz / 30 秒再算一遍 → 写成 WAV 落本地临时文件 → `wx.cloud.uploadFile` 传云存储 → 记进本机音源列表 | 要联网、要一次上传（约 1.3MB）；不是即时的 |

「存下来」之后这条音源就进了 `listSounds()`（内置 + 自己存的），**安睡音与放映页都能选到、也能息屏播** —— 这是它和「只在前台响的实时版」之间唯一的意义差别。

### 「条件」是什么

- **底色**（单选）：不要 / 白噪音 / 粉噪音 / 棕噪音 / 风 / 溪流 / 风扇
- **混入**（多选，每一层各带一个强度滑杆）：雨声 / 海浪 / 溪流 / 风 / 风扇 / 心跳 / 钟摆 / 摇篮曲
- **亮度**（滑杆）：一阶低通，截止频率在 350Hz ~ 9kHz 之间**指数**映射（听感上才是均匀变亮）。同一个棕噪音，从「闷在被子里」到「贴着耳朵」
- **起伏快慢 / 起伏幅度**（两条滑杆）：想要的周期在 24 秒 ~ 2 秒之间，幅度 0 = 完全平稳

无缝循环还是那套「周期取循环长度的整数分之一」，最后按整数个周期取整 —— 否则循环点会「多起伏半下」。

### 实现上的三个点

1. **滑杆用 `@change`（松手）而不是 `@changing`（拖动中）**：每次改动都要重算 12 秒的样本（约 50 万采样点 × 几层），拖动中连发会把界面拖卡。手感是「松手即听到」。
2. **合成放在 `setTimeout(..., 0)` 里**：合成是同步的 CPU 活，直接跑会把「生成中…」那一帧堵在渲染之前。另外每次 start 带一个自增 token，算到一半就被下一次顶掉的旧结果直接丢弃。
3. **低通是全程唯一「有记忆」的处理**（输出依赖上一个样本），理论上循环点有一次极小的不连续；一阶滤波的记忆只有几毫秒，又被噪声层的交叉淡化盖住，实际听不出来。

### 自己存的音源为什么只记在本机

`babyup.customSounds`（storage，最多 20 条），不上云数据库。理由是它属于「这台手机主人的听感偏好」：没必要跟账号走，也不该污染全家共享的清单。代价是换手机就没了 —— 可以接受，重新调一个就好。音频文件本身在云存储（`sleep-sound/custom-<时间戳>.wav`），删除时用 `wx.cloud.deleteFile` 一起清掉。

### 留的合规退路

它同样是音频播放，而且是「能自己造声音」的形态。工坊**入口就在安睡音页里**，所以关掉 `sleepSound` 开关，安睡音页连同工坊一起从工具页消失（工坊页自己没有单独的开关，也没有能被直接打开的分享链接 —— 它的分享走的是 App 首页）。


