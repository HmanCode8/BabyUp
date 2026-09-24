# 数据模型说明

面向后续接手者，说明「书遥贝贝」的数据存在哪里、按什么规则组织：云开发集合与 Supabase 表的对应关系、每个实体有哪些字段、`family_id` / `baby_id` 怎么贯穿、权限落在哪一层、照片文件怎么命名与访问。

**本文只描述代码与 SQL 里真实存在的内容**，来源限定在下面这些文件；两侧不一致或读不出来的地方，都用 `⚠️` 明确标出（清单见文末「未确认与不一致」）。

- 云开发：`src/cloudfunctions/init-db/index.js`（建集合与字典种子）、`src/cloudfunctions/data/index.js`（唯一的读写入口 + 服务端校验）
- Supabase：`supabase/migrations/*.sql`（001 ~ 015，共 14 个文件）
- 业务服务层：`src/services/*.js`、`src/services/cloud/db.js`、`src/services/supabase/db.js`、`src/services/cloud/storage.js`、`src/services/supabase/storage.js`

双后端为什么会并存、`api.js` 怎么切换，见 [代码架构说明](./architecture.md)；两侧功能与部署状态的对照见 [双后端功能对照](../backend/README.md)。

---

## 一、总览：一份数据落在哪

业务代码只有一份，落在哪一侧完全由 `src/config/index.js` 的 `BACKEND` 决定（当前 `'cloud'`，微信云开发）。切换点只有一个：`src/services/api.js`。

```text
src/pages/**（页面）
      │  只调 src/services/*.js
      ▼
src/services/*.js（业务服务层，两侧共用同一份，不认识后端）
  baby.js / family.js / feeding.js / sleep.js / diaper.js / growth.js /
  illness.js / milestone.js / vaccine.js / vaccine-library.js / checkup.js /
  photo.js / feedback.js / solid-food.js（纯前端静态数据，不落库）
      │  import { api } from './api'
      ▼
src/services/api.js  ← 唯一切换点（读 BACKEND；H5 强制回落 Supabase）
      │
      ├── BACKEND = 'cloud'（当前）
      │     src/services/cloud/db.js
      │       └─ wx.cloud.callFunction('data')
      │            └─ src/cloudfunctions/data/index.js
      │                 · 以管理员身份读写 17 个 NoSQL 集合
      │                 · 在函数内做成员鉴权、字段校验、内容安全检测
      │
      └── BACKEND = 'supabase'（保留，可整体回滚）
            src/services/supabase/db.js
              └─ PostgREST  /rest/v1/<table>
                   └─ 17 张 Postgres 表，权限由 RLS 策略 + RPC 承担
```

两套实现的 `db` 方法签名完全相同（`select / selectOne / insert / insertSilent / upsert / remove / rpc / pickColumns`），差异全部收在 `src/services/cloud/db.js` 的翻译逻辑里——它把 PostgREST 的 filters / order 语法翻译成云函数的 `where` / `order` 数组。

### 两侧的对应关系（17 组，集合名与表名完全同名）

| # | 云开发集合 | Supabase 表 | 维度 |
|---|---|---|---|
| 1 | `families` | `families` | 家庭主表 |
| 2 | `family_members` | `family_members` | 成员关系 |
| 3 | `family_invitations` | `family_invitations` | 一次性邀请码 |
| 4 | `babies` | `babies` | 宝宝档案 |
| 5 | `baby_photos` | `baby_photos` | 照片 / 视频日记 |
| 6 | `growth_records` | `growth_records` | 生长记录 |
| 7 | `vaccinations` | `vaccinations` | 疫苗记录 |
| 8 | `feeding_records` | `feeding_records` | 喂养记录 |
| 9 | `sleep_records` | `sleep_records` | 睡眠记录 |
| 10 | `diaper_records` | `diaper_records` | 便便记录 |
| 11 | `milestones` | `milestones` | 里程碑 |
| 12 | `illness_records` | `illness_records` | 生病 / 用药记录 |
| 13 | `checkup_records` | `checkup_records` | 儿保体检记录 |
| 14 | `feedbacks` | `feedbacks` | 用户反馈（账号维度） |
| 15 | `profiles` | `profiles` | 用户资料 |
| 16 | `vaccine_library` | `vaccine_library` | 疫苗字典（公共只读） |
| 17 | `app_logs` | `app_logs` | 埋点 / 错误日志（只写不可读） |

云开发侧集合清单的权威来源是 `src/cloudfunctions/init-db/index.js` 的 `COLLECTIONS` 常量（注释写明「与 Supabase 的 17 张表一一对应」）；Supabase 侧来自 `supabase/migrations/001_init_phase1.sql`、`006_phase2_schema.sql`、`009_patch_phase1_2.sql`、`014_phase3_schema.sql`。

### 三个必须知道的存储差异

| 差异 | Supabase 侧 | 云开发侧 |
|---|---|---|
| 主键 | 每张表有 `id` 列（`uuid`，默认 `gen_random_uuid()`；`app_logs` 例外，是 `bigint generated always as identity`） | NoSQL 文档自带 `_id`（云开发自动生成），业务代码里看不到 |
| `id` 与 `_id` | 前端直接用 `id` | `src/cloudfunctions/data/index.js` 的 `toClientRow` / `toServerRow` 做透明映射：入口把 `id` 改写成 `_id`，出口把 `_id` 补成 `id`。业务层一行都不用改 |
| 时间戳默认值 | 靠 SQL 的 `default now()` | 云开发没有列默认值，由云函数 `prepareDoc()` 补：`HAS_CREATED_AT` 列出的 15 个集合补 `created_at`，`TOUCH_UPDATED_AT` 列出的 3 个集合（`feedbacks` / `illness_records` / `checkup_records`）与 `babies` / `profiles` 补 `updated_at` |

`profiles` 的主键在两侧都等于「当前用户 id」：Supabase 是 `auth.users.id`（uuid），云开发是 `openid`（字符串，`src/cloudfunctions/login/index.js` 用 `_id = OPENID` 建档，`data` 云函数的 `guardInsert` / `guardUpsert` 也强制 `doc._id = userId`）。

---

## 二、实体清单表

字段类型一栏以 Supabase 的 SQL 为准：云开发是 NoSQL，集合本身没有类型与必填约束，约束只存在于 `src/cloudfunctions/data/index.js` 的校验代码里。

| 实体 | 云开发集合 | Supabase 表 | 存什么 | 关键字段 | 备注 |
|---|---|---|---|---|---|
| 家庭 | `families` | `families` | 家庭空间与家庭名 | `id` / `name` / `created_at` | 永久邀请码 `invite_code` 已废弃并删列（013） |
| 成员 | `family_members` | `family_members` | 用户与家庭的关联 + 角色 + 昵称 + 状态 | `family_id` / `user_id` / `role` / `status` / `nickname` | 唯一约束 `(family_id, user_id)`；一个用户可属多个家庭（008） |
| 邀请码 | `family_invitations` | `family_invitations` | 带角色的一次性邀请码 | `invite_code` / `role` / `expires_at` / `status` / `created_by` | `invite_code` 全局唯一；只经 RPC 写入 |
| 宝宝 | `babies` | `babies` | 宝宝档案 | `name` / `gender` / `birthday` / `avatar_url` | 一个家庭可多宝宝；云开发侧另有 3 个喂奶提醒字段 ⚠️ |
| 照片 | `baby_photos` | `baby_photos` | 照片 / 视频日记 | `media_type` / `storage_path` / `taken_at` / `note` | `storage_path` 存相对路径，不存完整 URL |
| 生长 | `growth_records` | `growth_records` | 身高 / 体重 / 头围 | `record_date` / `height_cm` / `weight_kg` / `head_cm` | 三项可只填部分；体检联动会写入这里 |
| 疫苗 | `vaccinations` | `vaccinations` | 已接种 / 计划接种的疫苗 | `name` / `dose` / `scheduled_date` / `vaccinated_date` | 状态不落库，由 `vaccinated_date` 推导 |
| 喂养 | `feeding_records` | `feeding_records` | 母乳 / 配方奶 / 水 / 辅食 | `feed_type` / `amount_ml` / `duration_min` / `record_time` | 数量字段按 `feed_type` 二选一 |
| 睡眠 | `sleep_records` | `sleep_records` | 入睡 / 醒来时间 | `started_at` / `ended_at` | `ended_at` 为空 = 正在睡，时长现算 |
| 便便 | `diaper_records` | `diaper_records` | 尿 / 便 / 混合 + 性状 + 颜色 | `diaper_type` / `poop_character` / `poop_color` / `record_time` | 存英文 code，中文映射在前端 |
| 里程碑 | `milestones` | `milestones` | 预置或自定义的达成事件 | `milestone_key` / `name` / `achieved_date` / `photo_url` | `photo_url` 存对象路径 |
| 生病 | `illness_records` | `illness_records` | 症状 / 体温 / 用药 / 就诊信息 | `occurred_at` / `symptoms` / `temperature` / `medicines` / `photos` | 第三期新增（014） |
| 体检 | `checkup_records` | `checkup_records` | 儿保体检数值与结论 | `checkup_date` / `month_age` / `growth_id` / 身高体重头围 / `photos` | 第三期新增（014）+ 体检↔生长联动（015） |
| 反馈 | `feedbacks` | `feedbacks` | 用户提交的问题 / 建议 | `content` / `type` / `contact` / `images` / `status` | 账号维度，**没有 `family_id`** |
| 用户资料 | `profiles` | `profiles` | 昵称、头像、微信标识 | `nickname` / `avatar_url` / `wechat_openid` / `wechat_unionid` | 主键 = 用户 id；邮箱 / 手机号只在 Supabase 侧 ⚠️ |
| 疫苗字典 | `vaccine_library` | `vaccine_library` | 一类 / 二类疫苗参考条目 | `name` / `dose` / `min_age_month` / `max_age_month` / `category` / `sort_order` | 公共只读，前端无写入口 |
| 埋点日志 | `app_logs` | `app_logs` | 错误 / 页面 / 动作事件 | `event_type` / `event_name` / `payload` / `user_id` / `family_id` | 只写不可读，前端读会被拒 |

另外两个不含数据库实体的模块，容易被误认为有表：

- `src/services/solid-food.js`：辅食食谱常量表（`STAGES` / `CATEGORIES` / `RECIPES`），**纯前端静态数据，不落库**。
- 日报 / 成长报告（`src/services/summary.js`、`src/services/report.js`）：**不建表**，全部由 `feeding_records` / `sleep_records` / `diaper_records` / `baby_photos` / `growth_records` / `vaccinations` / `milestones` 现算。

---

## 三、逐实体字段说明

### 3.1 家庭 `families`

来源：`supabase/migrations/001_init_phase1.sql`（建表）、`013_drop_family_invite_code.sql`（删列）；`src/services/family.js` 的 `FAMILY_COLUMNS = 'id,name,created_at'`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid`（主键，默认 `gen_random_uuid()`） | 云开发侧映射自 `_id` |
| `name` | `text not null default '我的家'` | 家庭名；`create_family(p_name)` 会把空白名兜底成 `'我的家'` |
| `created_at` | `timestamptz not null default now()` | 云开发侧由 `prepareDoc()` 补 |

⚠️ 001 建表时还有 `invite_code text not null unique`（6 位永久邀请码），`013` 已 `drop column`，对应的 `join_family_by_code()` 也已丢弃；云开发侧 `rpcCreateFamily` 从来没写过这个字段。两侧现状一致：邀请只走 `family_invitations`。

### 3.2 成员 `family_members`

来源：`001_init_phase1.sql`、`006_phase2_schema.sql`（放宽 role 约束）。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` 主键 | |
| `family_id` | `uuid not null references families(id) on delete cascade` | 所属家庭 |
| `user_id` | `uuid not null references auth.users(id) on delete cascade` | 云开发侧存的是 `openid` 字符串 |
| `role` | `text not null default 'member'`，`check (role in ('owner','member','viewer'))` | 001 只允许 `owner` / `member`，006 扩充为三个值 |
| `nickname` | `text` | 家庭内显示名，最多 12 字（`set_my_nickname` 与云函数 `rpcSetMyNickname` 都校验） |
| `status` | `text not null default 'active'`，`check (status in ('active','removed'))` | 移除成员是软删除（置 `removed`），保留行以便重新加入 |
| `created_at` | `timestamptz not null default now()` | |

约束与索引：`unique (family_id, user_id)`（同一个用户在同一家庭只有一行，因此「一个用户属于多个家庭」天然成立）、`idx_family_members_user`、`idx_family_members_family`。

中文标签写死在前端：`src/services/family.js` 的 `FAMILY_ROLE_LABEL = { owner: '创建者', member: '成员', viewer: '只读' }`。

### 3.3 邀请码 `family_invitations`

来源：`006_phase2_schema.sql`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` 主键 | |
| `family_id` | `uuid not null references families(id) on delete cascade` | |
| `invite_code` | `text not null unique` | 6 位随机码，字符集 `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`（去掉易混淆的 I / O / 0 / 1） |
| `role` | `text not null default 'member'`，`check (role in ('member','viewer'))` | **只能来自邀请码**，客户端指定不了，因此没有 `owner` |
| `expires_at` | `timestamptz` | 空 = 不过期；前端 `inviteStatus()` 按 `expires_at` 实时把 `active` 显示成「已过期」 |
| `status` | `text not null default 'active'`，`check (status in ('active','used','expired','revoked'))` | 用码成功即置 `used` |
| `created_by` | `uuid not null references auth.users(id)` | 云开发侧 = `openid` |
| `created_at` | `timestamptz not null default now()` | |

索引：`idx_invites_family`、`idx_invites_code`。

### 3.4 宝宝 `babies`

来源：`001_init_phase1.sql`；`src/services/baby.js`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` 主键 | |
| `family_id` | `uuid not null references families(id) on delete cascade` | |
| `name` | `text not null` | 宝宝昵称 |
| `gender` | `text`，`check (gender in ('male','female'))` | 可为空 |
| `birthday` | `date` | 可为空；月龄、疫苗计划日期、喂奶提醒都依赖它 |
| `avatar_url` | `text` | 存**对象路径**（`{family_id}/{baby_id}/avatar.jpg`），不是完整 URL |
| `created_at` | `timestamptz not null default now()` | |
| `updated_at` | `timestamptz not null default now()` | Supabase 侧没有触发器，由 `saveBaby()` 显式提交新值；云开发侧由 `prepareDoc()` 补 |

⚠️ **云开发侧多 3 个字段，Supabase 侧没有**：喂奶提醒（三期 P1-8）复用 `babies` 集合，新增 `feed_remind_enabled`（boolean，设置页写入）、`feed_interval_max_min`（number，实际生效的间隔上限分钟数）、`feed_remind_at`（ISO 时间串，云函数写入，用于「同一轮超时只推一次」去重）。`src/services/feeding.js` 的 `resolveFeedInterval()` 会读 `baby.feed_interval_max_min`，`src/cloudfunctions/feeding-reminder/index.js` 会读 `feed_remind_enabled` / `feed_remind_at`。**Supabase 侧没有任何迁移文件加这三列**，按 `docx/backend/README.md` 的说明这两处提醒功能「Supabase 侧不做」。

### 3.5 照片 `baby_photos`

来源：`001_init_phase1.sql`；`src/services/photo.js` 的 `PHOTO_COLUMNS`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` 主键 | |
| `family_id` | `uuid not null references families(id) on delete cascade` | |
| `baby_id` | `uuid not null references babies(id) on delete cascade` | |
| `media_type` | `text not null default 'image'`，`check (media_type in ('image','video'))` | 表结构一期即预留视频 |
| `storage_path` | `text not null` | 存储对象**相对路径**，如 `{family_id}/{baby_id}/{唯一串}.jpg` |
| `note` | `text` | 一句话备注 |
| `taken_at` | `timestamptz not null default now()` | 时间线排序依据；补录老照片时可改（`updatePhotoTakenAt`） |
| `created_by` | `uuid not null references auth.users(id)` | 云开发侧 = `openid` |
| `created_at` | `timestamptz not null default now()` | |

索引：`idx_photos_family_baby (family_id, baby_id, taken_at desc)`。

前端派生字段（**不落库**）：`url`（签名后的临时地址）、`cover_url`（视频封面，由命名约定 `xxx.mp4 → xxx.poster.jpg` 推导）。整行 upsert 前必须用 `api.db.pickColumns` 剔除，否则 Supabase 会以 `PGRST204` 拒绝。

### 3.6 生长 `growth_records`

来源：`001_init_phase1.sql`；`src/services/growth.js`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` 主键 | |
| `family_id` | `uuid not null references families(id) on delete cascade` | |
| `baby_id` | `uuid not null references babies(id) on delete cascade` | |
| `record_date` | `date not null default current_date` | |
| `height_cm` | `numeric(5,1)` | 身高 cm，可空 |
| `weight_kg` | `numeric(5,2)` | 体重 kg，可空 |
| `head_cm` | `numeric(5,1)` | 头围 cm，可空 |
| `note` | `text` | 家长备注；体检联动**不覆盖**它 |
| `created_by` | `uuid not null references auth.users(id)` | |
| `created_at` | `timestamptz not null default now()` | |

索引：`idx_growth_family_baby (family_id, baby_id, record_date)`。

前端校验区间：`GROWTH_RANGES` = 身高 20~150 / 体重 0.5~50 / 头围 20~70（生长页填写与 AI 解析出的数值共用这一份）。

⚠️ 体检侧体重上限是 60（`src/services/checkup.js` 的 `CHECKUP_LIMITS.weightMax` 与 `src/cloudfunctions/data/index.js` 的 `CHECKUP_NUMERIC_FIELDS`），与生长侧的 50 不一致。两侧 SQL 的列宽（`numeric(5,2)`）都放得下，属于校验口径差异。

### 3.7 疫苗 `vaccinations`

来源：`001_init_phase1.sql`；`src/services/vaccine.js`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` 主键 | |
| `family_id` | `uuid not null references families(id) on delete cascade` | |
| `baby_id` | `uuid not null references babies(id) on delete cascade` | |
| `name` | `text not null` | 疫苗名，如「乙肝疫苗」 |
| `dose` | `text` | 剂次，如「第1剂」「1剂」 |
| `scheduled_date` | `date` | 计划接种日期，可空 |
| `vaccinated_date` | `date` | 实际接种日期；**为空 = 未接种** |
| `hospital` | `text` | 接种机构 |
| `note` | `text` | |
| `created_by` | `uuid not null references auth.users(id)` | |
| `created_at` | `timestamptz not null default now()` | |

索引：`idx_vaccines_family_baby (family_id, baby_id)`。

**状态不落库**：`getVaccineStatus()` 按规则推导 `vaccinated` / `overdue` / `soon`（计划日期距今 ≤ 7 天）/ `pending`，列表查询用 `order: 'scheduled_date.desc.nullslast'`——云开发表达不了 null 排序，由 `src/services/cloud/db.js` 的 `applyLocalOrder()` 在客户端补排，这是两侧排序行为的唯一差异点。

### 3.8 喂养 `feeding_records`

来源：`006_phase2_schema.sql`；`src/services/feeding.js`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` 主键 | |
| `family_id` / `baby_id` | `uuid not null references ... on delete cascade` | |
| `feed_type` | `text not null`，`check (feed_type in ('breast','formula','solid','water'))` | 母乳 / 配方奶 / 辅食 / 水 |
| `amount_ml` | `numeric(6,1)` | 配方奶与水用；母乳与辅食强制置空 |
| `duration_min` | `integer` | 母乳用；其余类型强制置空 |
| `record_time` | `timestamptz not null default now()` | 喂养发生时间 |
| `note` | `text` | |
| `created_by` | `uuid not null references auth.users(id)` | |
| `created_at` | `timestamptz not null default now()` | |

索引：`idx_feeding_family_baby (family_id, baby_id, record_time desc)`。前端归一化在 `normalizeAmount()`：`breast` 只留 `duration_min`，`formula` / `water` 只留 `amount_ml`，`solid` 两者都空（辅食只记次数，次数 = 当日条数）。单次上限 `FEED_LIMITS`：奶量 1~500 ml、时长 1~240 分钟。

### 3.9 睡眠 `sleep_records`

来源：`006_phase2_schema.sql`；`src/services/sleep.js`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` 主键 | |
| `family_id` / `baby_id` | `uuid not null references ... on delete cascade` | |
| `started_at` | `timestamptz not null` | 入睡时间 |
| `ended_at` | `timestamptz` | 醒来时间；**为空 = 正在睡** |
| `note` | `text` | |
| `created_by` | `uuid not null references auth.users(id)` | |
| `created_at` | `timestamptz not null default now()` | |

索引：`idx_sleep_family_baby (family_id, baby_id, started_at desc)`。状态与时长都不落库，一律由 `ended_at - started_at` 现算（跨天自然算对）。

### 3.10 便便 `diaper_records`

来源：`006_phase2_schema.sql`；`src/services/diaper.js`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` 主键 | |
| `family_id` / `baby_id` | `uuid not null references ... on delete cascade` | |
| `diaper_type` | `text not null`，`check (diaper_type in ('pee','poop','mixed'))` | 尿 / 便 / 混合 |
| `poop_character` | `text`，`check (poop_character in ('soft','loose','hard','watery','pasty'))` | 性状；纯尿时置空 |
| `poop_color` | `text`，`check (poop_color in ('yellow','golden','green','brown','dark','red','black'))` | 颜色；`red` / `black` 前端提示就医 |
| `record_time` | `timestamptz not null default now()` | |
| `note` | `text` | |
| `created_by` | `uuid not null references auth.users(id)` | |
| `created_at` | `timestamptz not null default now()` | |

索引：`idx_diaper_family_baby (family_id, baby_id, record_time desc)`。库里只存英文 code，中文映射写死在前端（`DIAPER_TYPES` / `POOP_CHARACTERS` / `POOP_COLORS`）。

### 3.11 里程碑 `milestones`

来源：`006_phase2_schema.sql`；`src/services/milestone.js`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` 主键 | |
| `family_id` / `baby_id` | `uuid not null references ... on delete cascade` | |
| `milestone_key` | `text not null` | 预置 key（`first_smile` / `first_roll` / `night_sleep` / `first_sit` / `first_tooth` / `first_crawl` / `first_stand` / `first_step` / `first_word`）或 `'custom'` |
| `name` | `text not null` | 展示名；预置项存中文名，自定义存用户输入 |
| `achieved_date` | `date not null` | 达成日期 |
| `photo_url` | `text` | 存**对象路径**（`{family_id}/{baby_id}/milestone/{唯一串}.jpg`），可空 |
| `note` | `text` | |
| `created_by` | `uuid not null references auth.users(id)` | |
| `created_at` | `timestamptz not null default now()` | |

索引：`idx_milestones_family_baby (family_id, baby_id, achieved_date desc)`。列表按 `achieved_date.desc,created_at.desc` 排序。前端派生字段 `photoUrl` 不落库。

### 3.12 生病 / 用药 `illness_records`

来源：`supabase/migrations/014_phase3_schema.sql`；`src/services/illness.js` 的 `ILLNESS_COLUMNS`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` 主键，默认 `gen_random_uuid()` | |
| `family_id` / `baby_id` | `uuid not null references ... on delete cascade` | |
| `occurred_at` | `timestamptz not null` | 发病时间（必填） |
| `symptoms` | `text[] not null default '{}'` | 症状标签数组，至少 1 项；枚举 8 项：`fever` / `cough` / `runny_nose` / `vomit` / `diarrhea` / `rash` / `poor_appetite` / `other` |
| `temperature` | `numeric(4,1)` | 体温 ℃，可空 |
| `medicines` | `jsonb not null default '[]'` | 数组，元素形如 `{ name, dose, unit, frequency, days, note }` |
| `hospital` | `text` | 就诊医院 |
| `doctor` | `text` | 医生 |
| `diagnosis` | `text` | 诊断 |
| `allergy_note` | `text` | 过敏 / 不良反应 |
| `photos` | `text[] not null default '{}'` | 存储对象相对路径数组，最多 3 张 |
| `note` | `text` | |
| `created_by` | `uuid not null references auth.users(id)` | 云开发侧由云函数强制注入 `openid` |
| `created_at` | `timestamptz not null default now()` | |
| `updated_at` | `timestamptz not null default now()` | 云开发侧由 `TOUCH_UPDATED_AT` 自动维护 |

索引：`idx_illness_family_baby (family_id, baby_id, occurred_at desc)`。列表按 `occurred_at.desc,created_at.desc`。

服务端校验（`src/cloudfunctions/data/index.js` 的 `normalizeIllnessDoc`，前端 `ILLNESS_LIMITS` 先拦一遍）：体温 30~45 ℃、用药 ≤ 10 条且只保留填了药名的行、图片 ≤ 3 张；文本上限 `hospital` 50 / `doctor` 30 / `diagnosis` 200 / `allergy_note` 200 / `note` 200 字，用药行内 `dose` 20 / `unit` 10 / `frequency` 30 / `note` 50 字。

### 3.13 体检 `checkup_records`

来源：`014_phase3_schema.sql`（建表）、`015_checkup_sync_and_remove.sql`（联动触发器与删除 RPC）；`src/services/checkup.js` 的 `CHECKUP_COLUMNS`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` 主键，默认 `gen_random_uuid()` | |
| `family_id` / `baby_id` | `uuid not null references ... on delete cascade` | |
| `checkup_date` | `date not null` | 体检日期（必填） |
| `month_age` | `integer` | 月龄快照，由页面按「体检日期与宝宝生日」算好传上来；云函数只做非负整数兜底 |
| `growth_id` | `uuid references growth_records(id) on delete set null` | **服务端维护的联动字段**，指向体检自动生成 / 更新的那条生长记录。014 相对需求文档新增这一列，为的是「改体检 → 同步改生长」「删体检 → 可选删生长」有确定的关联方式 |
| `hospital` | `text` | 体检机构 |
| `height_cm` | `numeric(5,1)` | |
| `weight_kg` | `numeric(5,2)` | |
| `head_cm` | `numeric(5,1)` | |
| `hemoglobin` | `numeric(5,1)` | 血红蛋白 |
| `development` | `text` | 发育评估 |
| `doctor_advice` | `text` | 医生建议 |
| `next_date` | `date` | 建议下次体检日期，可空 |
| `photos` | `text[] not null default '{}'` | 体检本照片路径数组，最多 3 张 |
| `created_by` | `uuid not null references auth.users(id)` | |
| `created_at` | `timestamptz not null default now()` | |
| `updated_at` | `timestamptz not null default now()` | |

索引：`idx_checkup_family_baby (family_id, baby_id, checkup_date desc)`。列表按 `checkup_date.desc,created_at.desc`。

服务端校验（`normalizeCheckupDoc`，前端 `CHECKUP_LIMITS` 先拦一遍）：身高 20~150、体重 0.5~60、头围 20~70、血红蛋白 10~300、照片 ≤ 3 张、文本字段（`hospital` 50 / `development` 500 / `doctor_advice` 500）逐个限长。`growth_id` 客户端传什么都不认：新增时被 `delete doc.growth_id` 丢掉，整行写回时被覆盖成库里已有的值。

**体检 ↔ 生长联动**（文档 4.4，两侧行为刻意对齐）：

- 填了身高或体重 → 产生 / 更新一条同日期、同数值的生长记录，并把 id 记回 `checkup_records.growth_id`；只填头围不触发。
- 编辑时把身高体重都清空 → 删掉那条联动生长记录并清空 `growth_id`。
- 同步只覆盖 `record_date` 与三个数值，**不覆盖**家长在生长页写的 `note`。
- 落点差异：云开发侧写在 `data` 云函数的 `syncCheckupGrowth()` 里（写入体检后由服务端一次完成）；Supabase 侧是 `015` 的 `BEFORE INSERT OR UPDATE` 触发器 `trg_sync_checkup_growth`。
- 删除体检必须走 RPC：`remove_checkup_record(p_id, p_delete_growth)`，返回值 `{ growth_deleted: boolean }`。普通 remove 会被两侧同时拒绝（云函数 `guardRemove` 直接报错，RPC 里才承载「联动的生长记录留不留」这个选择）。

### 3.14 反馈 `feedbacks`

来源：`supabase/migrations/014_phase3_schema.sql`；`src/services/feedback.js`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` 主键，默认 `gen_random_uuid()` | |
| `user_id` | `uuid not null references auth.users(id) on delete cascade` | 提交人；云开发侧 = `openid` |
| `created_by` | `uuid not null references auth.users(id) on delete cascade` | 与 `user_id` 同值（两条字段都保留） |
| `content` | `text not null` | 问题描述，5~500 字（长度由服务端校验） |
| `type` | `text not null default 'other'`，`check (type in ('bug','suggestion','content','other'))` | 功能异常 / 体验建议 / 内容有误 / 其他 |
| `contact` | `text` | 联系方式，可选，≤ 50 字 |
| `images` | `text[] not null default '{}'` | 截图相对路径，最多 3 张 |
| `status` | `text not null default 'pending'`，`check (status in ('pending','done'))` | 由管理员在控制台改，前端只读展示 |
| `created_at` | `timestamptz not null default now()` | |
| `updated_at` | `timestamptz not null default now()` | 云开发侧由 `TOUCH_UPDATED_AT` 维护 |

索引：`idx_feedbacks_user (user_id, created_at desc)`。

**没有 `family_id` / `baby_id`**：反馈是账号维度数据，用户还没建家庭时也要能提交。云函数侧 `guardInsert` 把 `user_id` / `created_by` / `status` 一律覆盖成服务端值，且禁止修改（`guardUpsert` 里 `feedbacks` 直接报「反馈提交后不可修改」）。

### 3.15 用户资料 `profiles`

来源：`006_phase2_schema.sql`、`009_patch_phase1_2.sql`（`recovery_email`）、`011_profiles_phone.sql`（`phone`）；云开发侧写入逻辑在 `src/cloudfunctions/login/index.js`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid primary key references auth.users(id) on delete cascade` | 云开发侧 = `openid`，且没有 `created_at` 列 |
| `nickname` | `text` | |
| `avatar_url` | `text` | |
| `wechat_openid` | `text unique` | 云开发侧 = 自己的 `openid` |
| `wechat_unionid` | `text` | 取自 `cloud.getWXContext().UNIONID`，可能为空 |
| `updated_at` | `timestamptz not null default now()` | 云开发侧由 `prepareDoc()` 补 |
| `recovery_email` | `text` | 009 新增；找回密码用的真实邮箱，不影响登录邮箱 |
| `phone` | `text` | 011 新增，配 `unique index idx_profiles_phone`；供 Edge Function `phone-login` 按手机号反查登录邮箱 |

索引：`idx_profiles_openid (wechat_openid)`、`idx_profiles_phone (phone)`。

⚠️ 云开发侧的 `profiles` 文档只有 `nickname` / `avatar_url` / `wechat_openid` / `wechat_unionid` / `updated_at`（`login` 云函数建档时写入），**没有 `recovery_email` 与 `phone`**，这与云开发后端没有邮箱 / 手机号体系一致（`capabilities` 里对应能力为 `false`）。`src/stores/auth.js` 的 `savePhone()` 会 `upsert('profiles', { id, phone })`，但该路径只服务于手机号注册（Supabase 侧）。

### 3.16 疫苗字典 `vaccine_library`

来源：`supabase/migrations/009_patch_phase1_2.sql`（建表 + 一类种子）、`012_vaccine_library_paid.sql`（二类种子）；云开发侧种子在 `src/cloudfunctions/init-db/index.js`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `uuid` 主键，默认 `gen_random_uuid()` | |
| `name` | `text not null` | 疫苗名（如「乙肝疫苗」） |
| `dose` | `text` | 剂次（「第1剂」/「第2剂」…；单剂次写「1剂」） |
| `min_age_month` | `numeric(4,1) not null` | 建议接种月龄（最小） |
| `max_age_month` | `numeric(4,1)` | 建议接种月龄（最大，空 = 不限） |
| `category` | `text not null`，`check (category in ('free','paid'))` | `free` = 一类（免费）、`paid` = 二类（自费） |
| `note` | `text` | 备注（含免责说明） |
| `sort_order` | `integer not null default 0` | 一类 1 起、二类 101 起 |

索引：`idx_vaccine_lib_category (category, sort_order)`。**没有 `created_at`，也没有 `family_id`**：这是开发者维护的公共字典，RLS 只开了 select（`auth.uid() is not null`），前端没有任何增删改入口（`src/services/vaccine-library.js` 只有 `listVaccineLibrary()`）。

⚠️ 两侧种子条数不一致：SQL 侧是 22 条 `free`（009）+ 28 条 `paid`（012）= 50 条；云开发侧 `init-db` 实际写入 **26 条 `free`**（009 的 22 条 + 4 条「乙脑灭活疫苗」，注释说明是为了覆盖 2021 版程序表里的另一条路线）+ 28 条 `paid` = 54 条。`init-db/index.js` 文件头注释仍写「一类 22 条」，与该文件内数组的实际条数不一致。

### 3.17 埋点日志 `app_logs`

来源：`supabase/migrations/009_patch_phase1_2.sql`；写入方 `src/utils/tracker.js`。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | `bigint generated always as identity primary key` | 云开发侧为自动生成的 `_id`，不是自增整数 |
| `user_id` | `uuid references auth.users(id) on delete set null` | 009 特意加的 `on delete set null`：日志保留用于排障，但不再指向已注销用户（原文写 `NO ACTION` 会导致注销失败） |
| `family_id` | `uuid` | 冗余字段，便于按家庭分析；没有外键 |
| `event_type` | `text not null`，`check (event_type in ('error','page_view','action'))` | |
| `event_name` | `text not null` | 如 `photo_upload_fail` / `report_share` / `record_created` |
| `payload` | `jsonb` | 附加信息；约定**不放敏感信息**（不记录照片 URL、备注正文、邮箱手机号） |
| `created_at` | `timestamptz not null default now()` | |

索引：`idx_logs_created (created_at desc)`、`idx_logs_user (user_id)`、`idx_logs_family (family_id)`。

写入必须走 `insertSilent`（云开发侧 `actionInsertSilent`，Supabase 侧裸 POST 不带 `Prefer: return=representation`）：这张表**故意没有 select 策略**，带返回值的插入会因 RLS 回读被整条拒掉。云开发侧 `actionSelect` 对 `app_logs` 直接报「埋点日志不支持读取」，`guardUpsert` 报「埋点日志不支持更新」。

---

## 四、多家庭与多宝宝

### `family_id` 与 `baby_id` 的贯穿方式

- **家庭子表**统一带两个字段：`family_id`（归属家庭）+ `baby_id`（归属宝宝）。共 10 张：`babies`、`baby_photos`、`growth_records`、`vaccinations`、`feeding_records`、`sleep_records`、`diaper_records`、`milestones`、`illness_records`、`checkup_records`。这个清单在两侧各有一份对应实现：云函数的是 `src/cloudfunctions/data/index.js` 的 `FAMILY_CHILD_TABLES`，Supabase 侧是每张表各自的 RLS 策略里的 `exists (select 1 from family_members fm where fm.family_id = <表>.family_id ...)`。
- **`families` 本身没有 `family_id`**，它的可见性由 `family_members` 推导（云函数 `actionSelect` 用 `listActiveFamilyIds()` 求交集；Supabase 用 `families_select` 策略）。
- **`family_members` / `family_invitations` 只有 `family_id`，没有 `baby_id`**。
- **`feedbacks` / `profiles` / `vaccine_library` / `app_logs` 与家庭无关**：`profiles` 按用户 id、`feedbacks` 按 `user_id` / `created_by`、`vaccine_library` 是公共字典、`app_logs` 只写。
- **`created_by` 在所有记录类子表上都存一份**：云开发侧存 `openid`，Supabase 侧存 `auth.users.id`（外键）。身份字段由服务端注入，客户端指定不了。

### 多家庭

- `family_members` 的唯一约束是 `(family_id, user_id)`，本就允许同一个 `user_id` 出现在多个 `family_id` 下。`008_multi_family.sql` 只是去掉了三个函数（`create_family` / `join_family_by_code` / `join_family_by_invite`）里「已加入一个家庭就报错」的判断，**表结构一行没改，RLS 一行没动**，家庭之间天然隔离（策略都是「我是该家庭的 active 成员才能看该家庭的数据」）。
- 前端拿到的是**全部**在册成员关系：`listMyMemberships(userId)` → `listFamiliesByIds(ids)`，当前选中的家庭持久化在 `SELECTION_STORAGE_KEY`（`babyup.selection`）。

### 多宝宝

- `babies` 表结构一期即按多宝宝设计（`family_id` 一对多），`listBabies(familyId)` 按 `created_at.asc` 返回，第一个作为默认选中。
- 「现在看哪个宝宝」不存在数据库里，由 store 的 `currentBabyId` 决定（同样持久化在 `SELECTION_STORAGE_KEY`），页面不自己挑。

### 成员角色怎么表达

| 角色 | 含义 | 读 | 写 | 谁能改 |
|---|---|---|---|---|
| `owner` | 创建者 | 可 | 可 | 不开放邀请（`INVITE_ROLES` 只有 member / viewer，避免多创建者） |
| `member` | 成员 | 可 | 可 | owner 可通过 `set_member_role` 改成 viewer，或 `remove_family_member` 软删除 |
| `viewer` | 只读 | 可 | **不可** | 同上 |

「可写 / 只读」的表达方式两侧不同，但语义一致：

- **Supabase**：写策略（insert / update / delete）里统一多一个 `and fm.role != 'viewer'`；select 策略不含这个条件（viewer 能读）。
- **云开发**：`data` 云函数里 `assertMember(userId, familyId, needWrite)`，写操作传 `needWrite = true`，命中 `viewer` 时报「只读成员不能修改数据」。

---

## 五、权限

### Supabase：RLS 策略 + RPC

**辅助函数**（`001` 与 `006`，全部 `SECURITY DEFINER`，入口校验 `auth.uid()`，未登录一律拒绝）：

- `is_family_member(p_family_id)`、`is_family_owner(p_family_id)`：以属主身份查询 `family_members`，绕过 RLS，从而避免策略自我引用导致的 `infinite recursion detected in policy`。
- `generate_invite_code()`：生成 6 位码，字符集去掉 I / O / 0 / 1。

**策略要点**（完整写法见各迁移文件，这里只列规则）：

| 表 | select | insert | update | delete |
|---|---|---|---|---|
| `families` | 我是 active 成员的家庭 | `with check (true)`（前端实际走 `create_family()`） | 仅 owner | 无策略 |
| `family_members` | `auth.uid() = user_id or is_family_member(family_id)` | `with check (false)`（006 封死，防自我提权） | 仅 owner | `auth.uid() = user_id`（退出家庭）或 owner |
| `family_invitations` | 本家庭 active 成员 | 仅 owner | 仅 owner | 无策略 |
| `profiles` | `auth.uid() = id` | `auth.uid() = id` | `auth.uid() = id` | 无策略 |
| `babies` / `baby_photos` / `growth_records` / `vaccinations` / `feeding_records` / `sleep_records` / `diaper_records` / `milestones` / `illness_records` / `checkup_records` | 本家庭 active 成员 | 本家庭 active 成员且 `role != 'viewer'` | 同 insert | 同 insert |
| `vaccine_library` | `auth.uid() is not null` | 无策略（不可写） | 无 | 无 |
| `app_logs` | **无策略**（前端读不到） | `auth.uid() = user_id` | 无 | 无 |
| `feedbacks` | `user_id = auth.uid()` | `with check (user_id = auth.uid())` | 无（status 由管理员在控制台改） | 无 |

几条关键的收紧与补丁（都是踩过坑才加的，别回退）：

- `002` 给 `baby_photos` 补 update、`004` 给 `storage.objects` 补 update、`005` 给 `growth_records` 补 update：微信小程序不支持 PATCH，更新一律走 upsert（`INSERT ... ON CONFLICT DO UPDATE`），该语句需要 INSERT 与 UPDATE 两条策略同时放行。`004` 修的是「宝宝头像换第二次必失败」（同一路径 `x-upsert: true` 触发 UPDATE）。
- `006` 把这 3 条 update 策略一并重建为「非 viewer 可写」，否则 viewer 仍能改照片备注、覆盖照片对象、改生长记录。
- `006` 把存储桶的 insert / delete / update 也收紧为「非 viewer」：viewer 可读不可传不可删不可覆盖。
- `006` 把 `members_insert` 改成 `with check (false)`：原本 `auth.uid() = user_id` + `members_delete = auth.uid() = user_id` 组合起来，任何成员都能「删掉自己那行 → 再以 `role='owner'` 插回」自我提权。代价是 owner 改别人角色也走不了 upsert，于是有了 `007`。
- `family_members` 的写操作**一律下沉到函数**：`set_my_nickname`（成员改自己昵称，只能改 `nickname`）、`set_member_role`（owner 改角色，只能改成 member / viewer）、`remove_family_member`（软删除，`status = 'removed'`）。

**RPC 函数清单（前后端共用的 7 个）**：`create_family`、`join_family_by_invite`、`create_family_invitation`、`set_member_role`、`set_my_nickname`、`remove_family_member`、`remove_checkup_record`。

`join_family_by_code`（一期永久邀请码）已在 `013` 里 `drop function`，云开发侧也没实现（`data/index.js` 文件头注释明确写了「是已废弃的一期接口，前端未调用，故未实现」）。

`remove_checkup_record` 的签名：

```sql
create or replace function public.remove_checkup_record(p_id uuid, p_delete_growth boolean default false)
returns jsonb
```

### 云开发：`data` 云函数内的 JS 校验

**云开发安全规则没有参与业务鉴权**。原因写在 `src/cloudfunctions/data/index.js` 的文件头：安全规则只能按 `_openid` 判断，做不了「必须是 `baby_photos.family_id` 对应家庭的 active 成员才能读照片」这类跨集合校验。因此**客户端不直连数据库**，读写统一由 `data` 云函数以管理员身份执行，在函数内鉴权。

鉴权实现（都在 `data/index.js`）：

| 动作 | 规则 |
|---|---|
| 身份来源 | 一律取 `cloud.getWXContext().OPENID`，前端传什么都不信 |
| `select` | `profiles` 强制 `id = OPENID`；`feedbacks` 强制 `created_by = OPENID`；`vaccine_library` 登录即可读；`app_logs` 拒绝；`family_members` 按 `family_id` 校验成员、没有 `family_id` 则强制 `user_id = OPENID`；`families` 与我的 active 家庭取交集；`family_invitations` 与 10 张家庭子表按 `family_id` 校验成员（只带 `id` 的查单条会先查出该行的 `family_id` 再逐行校验） |
| `insert` | `profiles` 强制 `_id = OPENID`；`feedbacks` 强制 `user_id` / `created_by` / `status = 'pending'`；`families` / `family_members` / `family_invitations` / `vaccine_library` 一律拒绝直写（必须走 RPC）；10 张家庭子表走 `assertMember(needWrite = true)` |
| `upsert` | 按**库里已有行**的 `family_id` 鉴权，并把 `family_id` 钉死，不允许整行写回时挪家庭（等价于 Supabase 侧 RLS 的 `USING` 子句）；`feedbacks` 不可改；`app_logs` 不可改；`checkup_records` 的 `growth_id` 只信库里的值 |
| `remove` | `family_members` 只能删自己那行（退出家庭）；`family_invitations` 仅 owner；`checkup_records` 必须走 RPC；其余家庭子表走 `assertMember(needWrite = true)` |
| 内容安全 | 写入前对用户手打的文本字段调 `cloud.openapi.security.msgSecCheck`（`CONTENT_FIELDS` 按集合列出字段，资料类 `scene = 1`、记录类 `scene = 4`）。命中 `risky` 或错误码 87014 时抛 `CONTENT_RISKY`；**调用异常一律放行**并打日志，避免接口抖动导致家长记不了数据。Supabase 侧没有这一层 |

`{ ok, code, message }` 是云函数的统一出参约定，前端在 `src/services/cloud/db.js` 里翻译成 `ApiError`。

---

## 六、照片存储

### 桶与命名

- **Supabase**：桶名 `baby-photos`，`public = false`（私有桶，`001` 里 `insert into storage.buckets (id, name, public) values ('baby-photos', 'baby-photos', false)`）。桶名的前端常量是 `src/config/index.js` 的 `STORAGE_BUCKET`。
- **云开发**：没有桶的概念，直接是云存储；相对路径前要拼 `src/config/index.js` 的 `CLOUD_FILE_ID_PREFIX` 才成为合法 fileID（留空则所有云存储调用抛 `STORAGE_NOT_CONFIGURED`）。

### 路径规则

**库里存的永远是相对路径**，完整 URL 一律现算。

| 用途 | 路径规则 | 出处 |
|---|---|---|
| 照片 | `{family_id}/{baby_id}/{唯一串}.jpg` | `src/services/photo.js` 的 `buildObjectPath()` |
| 视频 | `{family_id}/{baby_id}/{唯一串}.mp4` | 同上 |
| 视频封面 | `{family_id}/{baby_id}/{唯一串}.poster.jpg`（由视频路径去扩展名 + `.poster.jpg` 推导，**不占数据库字段**） | `src/services/photo.js` 的 `buildPosterPath()` |
| 宝宝头像 | `{family_id}/{baby_id}/avatar.jpg`（同路径覆盖，`upsert: true`） | `src/services/baby.js` 的 `babyAvatarPath()` |
| 里程碑照片 | `{family_id}/{baby_id}/milestone/{唯一串}.jpg` | `src/services/milestone.js` |
| 生病记录照片 | `{family_id}/{baby_id}/illness/{唯一串}.jpg` | `src/services/illness.js` |
| 体检本照片 | `{family_id}/{baby_id}/checkup/{唯一串}.jpg` | `src/services/checkup.js` |
| 反馈截图 | `{family_id}/feedback/{唯一串}.jpg` | `src/services/feedback.js` |

⚠️ 反馈截图这一条要特别留意：`feedbacks` 表本身**没有 `family_id`**，但截图路径的首段仍借用了「当前家庭 id」，因为云函数要从路径首段取家庭 id 做成员校验。因此 `src/pages/feedback/feedback.vue` 在没有家庭时不允许上传截图（只为纯文字反馈放行）。

### 落库字段与访问方式

- 落库的字段：`baby_photos.storage_path`、`babies.avatar_url`、`milestones.photo_url`、`illness_records.photos[]`、`checkup_records.photos[]`、`feedbacks.images[]`。全是相对路径数组 / 单值。
- **Supabase 访问**：私有桶必须走签名 URL。单个用 `createSignedUrl(path, 3600)`（`POST /storage/v1/object/sign/baby-photos/{path}`），批量用 `createSignedUrls(paths, 3600)`（一页照片只发一次请求）。上传走 `uni.uploadFile`（小程序无法构造 FormData / Blob），删除走 `DELETE /storage/v1/object/baby-photos` + `{ prefixes }`。
- **云开发访问**：`getTempFileURL` 换到的是平台**固定 2 小时**有效的 https 链接，`expiresIn` 形参无法自定义（保留只为两侧签名一致）。换链接与删文件**都走 `data` 云函数**（`tempFileURL` / `deleteFile` 两个 action），每次最多 50 个文件、超限自动分批；上传仍留在客户端（`wx.cloud.uploadFile`）。
- `storage.objects` 的策略：`001` 给出 read / insert / delete（判定条件是从对象名的第一段 `(storage.foldername(name))[1]` 取 `family_id`，再查 `family_members` 是否 active），`004` 补 update，`006` 把 insert / delete / update 收紧为「非 viewer」。
- 云函数的 fileID 解析（`familyIdOfFile()`）取的是路径**第二段**：完整结构是 `cloud://<环境ID>.<存储桶ID>/<family_id>/<baby_id>/<文件名>`，第一段是平台自动拼的环境与存储桶，不是上传时给的路径。注释里写明这里取错一度导致所有换链接请求都被判成「非家庭成员」。
- 删除顺序：照片 / 里程碑 / 生病 / 体检都是「先删存储对象（幂等）再删记录」；上传顺序反过来「先传文件、成功后再插记录」，插入失败则把刚上传的对象删掉，避免孤儿文件。`checkup` 是「先删记录再删图片」——记录没删成时图片还在，不会出现「照片没了记录还在」。

---

## 七、迁移历史（`supabase/migrations/001 ~ 015`）

**云开发侧没有同名迁移文件**：集合的建立与字典种子全靠 `src/cloudfunctions/init-db/index.js` 一次执行（`createCollection` + `vaccine_library` 种子，可重复执行），字段与约束以该文件与 `src/cloudfunctions/data/index.js` 的校验代码为准。Supabase 侧才用 `supabase/migrations/` 逐版演进。

下表的编号连续，但**没有 `010`**：`010` 曾用于「旧邀请码置空 + 放开 NOT NULL」，已被 `013` 完全覆盖、从未执行，文件已从仓库删除（`009` 文件末尾与 `013` 文件头都写明了这一点）。所以实际上只有 14 个文件。

| 文件 | 做了什么 |
|---|---|
| `001_init_phase1.sql` | 一期建表：`families` / `family_members` / `babies` / `baby_photos` / `growth_records` / `vaccinations`；建索引；开 RLS；建 3 个 `SECURITY DEFINER` 辅助函数（`is_family_member` / `is_family_owner` / `generate_invite_code`）与 `create_family` / `join_family_by_code`；写全部一期 RLS 策略；建 `baby-photos` 私有桶与 3 条存储策略 |
| `002_baby_photos_update_policy.sql` | 给 `baby_photos` 补 `photos_update` 策略（照片详情要能改备注，upsert 需要 INSERT + UPDATE 同时放行） |
| `003_member_helpers.sql` | 补 `set_my_nickname`（成员只能改自己昵称）与 `remove_family_member`（owner 软删除成员） |
| `004_storage_objects_update_policy.sql` | 给 `storage.objects` 补 `photos_storage_update` 策略（修「换头像第二次必失败」） |
| `005_growth_update_policy.sql` | 给 `growth_records` 补 `growth_update` 策略（生长记录填错了能改） |
| `006_phase2_schema.sql` | 二期建表：`profiles` / `feeding_records` / `sleep_records` / `diaper_records` / `milestones` / `family_invitations`；把 `family_members.role` 约束扩成 `owner/member/viewer`；建索引、开 RLS、写二期策略；收紧一期各表的写策略为「非 viewer」；补 3 条漏掉的 update 策略；把 `members_insert` 封成 `with check (false)`；新增 `create_family_invitation` / `join_family_by_invite` 两个函数；给既有用户补 `profiles` 行 |
| `007_member_role_rpc.sql` | 补 `set_member_role` 函数（owner 改成员角色只能改 member / viewer，因为 `members_insert` 被封后 upsert 走不通） |
| `008_multi_family.sql` | 放开「一个用户只能属于一个家庭」：重写 `create_family` / `join_family_by_code` / `join_family_by_invite`，去掉跨家庭限制；表结构与 RLS 未动 |
| `009_patch_phase1_2.sql` | 一二期补丁：`profiles` 加 `recovery_email`；建 `vaccine_library`（含 22 条一类种子）与 `app_logs`；建索引、开 RLS、写策略（字典仅登录可读、日志仅登录可写且不可读）；`app_logs.user_id` 定为 `on delete set null`；4.6「旧邀请码停用」拆出去未执行 |
| `011_profiles_phone.sql` | `profiles` 加 `phone` 与唯一索引 `idx_profiles_phone`；补缺失的 `profiles` 行；从 `{手机号}@phone.babyup.app` 形式的登录邮箱回填手机号（供 Edge Function `phone-login` 反查） |
| `012_vaccine_library_paid.sql` | 补 `vaccine_library` 的二类（自费）疫苗种子 28 条，`sort_order` 从 101 起（只有表里没有 `paid` 行时才插入） |
| `013_drop_family_invite_code.sql` | 丢弃 `join_family_by_code()`；删除 `families.invite_code` 列；重建 `create_family()` 不再生成邀请码（破坏性操作，已单独确认） |
| `014_phase3_schema.sql` | 三期建表：`feedbacks` / `illness_records` / `checkup_records`（含相对文档新增的 `checkup_records.growth_id`）；建索引、开 RLS、写策略。文件头标明是「只写不执行」的交付物，回滚到 Supabase 时才执行 |
| `015_checkup_sync_and_remove.sql` | 补体检的两处服务端逻辑：`sync_checkup_growth()` 触发器（BEFORE INSERT / UPDATE，体检 ↔ 生长联动）与 `remove_checkup_record(p_id, p_delete_growth)` 函数（删除时可选一并删联动生长记录）。同样是「只写不执行」 |

按 `docx/backend/README.md` 的记录，`001 ~ 013` 已执行，`014` / `015` 尚未执行——也就是说**当前若把 `BACKEND` 切回 `'supabase'`，生病 / 体检 / 反馈三个功能会因表不存在而失败**，而云开发侧的这三个集合已建、`data` 云函数已重传。

---

## 八、未确认与不一致

以下条目是核对两侧源码时发现的不对称，逐条列出以便后续处理。

### 明确的字段级不一致

1. **`babies` 的 3 个喂奶提醒字段只在云开发侧存在**：`feed_remind_enabled` / `feed_interval_max_min` / `feed_remind_at` 由 `src/pages/feeding-reminder/feeding-reminder.vue`、`src/services/feeding.js`、`src/cloudfunctions/feeding-reminder/index.js` 读写；`supabase/migrations/` 下**没有任何迁移**加这三列。按 `docx/backend/README.md` 的说明，这两处提醒功能 Supabase 侧不做，因此不与云开发侧对齐。云开发侧集合是无模式的，`data` 云函数的白名单按集合粒度，所以加字段不需要改云函数。
2. **`profiles` 的 `recovery_email` / `phone` 只在 Supabase 侧存在**：云开发侧 `login` 云函数建档只写 `nickname` / `avatar_url` / `wechat_openid` / `wechat_unionid` / `updated_at`。与「云开发没有邮箱 / 手机号体系」一致。
3. **`vaccine_library` 种子条数两侧不同**：Supabase 侧 22 `free` + 28 `paid` = 50 条；云开发侧 26 `free`（多 4 条「乙脑灭活疫苗」）+ 28 `paid` = 54 条。另外 `init-db/index.js` 的**文件头注释写「一类 22 条」，与文件内数组实际条数（26）不一致**。
4. **体重校验上限不一致**：生长侧 50 kg（`src/services/growth.js` 的 `GROWTH_RANGES`），体检侧 60 kg（`src/services/checkup.js` 的 `CHECKUP_LIMITS` 与 `data` 云函数的 `CHECKUP_NUMERIC_FIELDS`）。
5. **反馈截图的路径首段借用了家庭 id**：`feedbacks` 表没有 `family_id`，但 `uploadFeedbackImage(familyId, ...)` 生成的路径是 `{family_id}/feedback/xxx.jpg`。这是为了复用云函数「从 fileID 首段取 family id 做成员校验」的机制，代价是没有家庭就不能传截图。看起来是有意为之，但语义上容易误解，接手时注意。

### 数据清理与导出范围未覆盖三期

6. **`src/cloudfunctions/delete-account/index.js` 的 `FAMILY_CHILD_COLLECTIONS` 只有 8 个集合**（`babies` / `baby_photos` / `growth_records` / `vaccinations` / `feeding_records` / `sleep_records` / `diaper_records` / `milestones`），**不含 `illness_records` / `checkup_records` / `feedbacks`**。Supabase 侧靠 `families(id) on delete cascade` 与 `auth.users(id) on delete cascade` 能级联清掉这三张表，云开发侧没有级联，注销后会留下这三类残留数据。`checkup_records.growth_id` 的联动生长记录也不在这个清单的考虑范围内（它属于 `growth_records`，会被删掉，但删除时不区分是否联动产生）。
7. **两个 `export-data`（云函数 + Edge Function）都只导出 10 张表**，同样不含三期三张表，两侧行为一致但都不完整。反馈是账号维度数据，更不在任何一份导出范围内。

### 其他需要留意但已确认是设计如此的

8. **云开发安全规则未参与业务鉴权**：`docx/backend/migration-plan.md` 的「风险」一节记着「跨集合成员校验是否可完全在云函数外实现存疑」，实际做法是不依赖安全规则、统一走云函数。云存储权限页的具体配置值在源码里没有体现，只有 `docx/product/phase3-cloud.md` 提到「免费套餐不可修改（当前为『仅创建者可读写』）」与 `docx/backend/migration-plan.md` 提到「默认公有读」两种说法——**两处文档口径不一致，以控制台实际配置为准**（无论哪种，代码都绕开了它，走云函数管理员身份）。
9. **`docx/backend/README.md` 写 `init-db` 灌「一类 22 + 二类 28」**，与 `init-db/index.js` 数组实际的 26 + 28 不符（同第 3 条）。
10. **`app_logs` 的 `id` 类型两侧不同**：Supabase 是 `bigint identity`，云开发是自动生成的字符串 `_id`。导出 / 比对数据时不能按数值主键对齐。
11. **`illness_records` 与 `checkup_records` 的 `updated_at`**：Supabase 靠列默认值 `now()`，但两侧都**没有 update 触发器**去刷新它（009 只给 `app_logs` 定了 `on delete set null`，014 / 015 没有 `updated_at` 触发器）——Supabase 侧整行 upsert 时由客户端提交的值决定；云开发侧由 `data` 云函数的 `TOUCH_UPDATED_AT` 自动刷新。真实的新鲜度行为两侧可能不同。

---

## 延伸阅读

- [代码架构说明](./architecture.md)
- [功能清单](./features.md)
- [双后端功能对照](../backend/README.md)
- [双后端迁移计划](../backend/migration-plan.md)
- [AI 助手说明](../ai/README.md)
