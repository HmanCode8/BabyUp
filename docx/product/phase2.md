# 婴儿成长记录小程序：初芽（BabyUp） · 第二期开发需求文档

> **文档用途**：本文件是给 AI 开发 Agent 执行的第二期开发规格说明，**必须在一期全部验收通过后开始**。Agent 按"七、分步开发计划"从 Step 0 开始逐步实现，每步完成自测后再进入下一步；遇到文档未覆盖或存在歧义的地方，列出问题向用户确认，禁止自行假设。
>
> **前置依赖**：第一期开发需求文档（`婴儿成长记录小程序-第一期开发需求文档.md`）已实现并验收通过，本项目在此基础上增量开发。
>
> **项目代号**：baby-record（二期）

---

## 一、项目概述

### 1.1 背景
- 第一期已实现：宝宝档案、照片时间线、身高体重曲线、疫苗提醒、家庭成员管理（5 个功能，10 个页面，Supabase 多租户隔离）。
- 第二期目标：**让日常记录形成闭环 + 制造分享传播点 + 登录体验升级**，为"推广给其他家庭"做准备。
- 推广目标决定：第二期必须出现"家长愿意转发"的产物（成长报告），以及"陌生人愿意注册"的登录体验（微信一键登录）。

### 1.2 产品定位
- 从"低频记录工具"升级为"**每天都会打开**的宝宝成长档案"。
- 一句话：家长每天 3 次打开（喂奶记一笔、睡觉记一笔、换尿布记一笔），月底收到一张想转发到家族群的成长报告。

### 1.3 关键设计原则
1. **多租户隔离延续一期，不许回退**：所有新表继续挂在 `family_id` 下，RLS 强制隔离；同时把"只读成员（viewer）"角色引入权限模型，为推广后"爷爷奶奶只读"场景铺路。
2. **二期 P0 = 8 个功能，P1 = 3 个可选，P2 明确不做**（见"二、范围"）。
3. **记录路径 ≤ 2 步**（延续一期）：喂养/睡眠/便便任一记录从打开 App 到保存不超过 2 步。
4. **能聚合的不落库**：每日小结、成长报告均为实时聚合生成，不建缓存表（数据量级完全够用）。
5. 后端仍全部依赖 Supabase（Auth / Postgres / RLS / Storage / Edge Function），不写自建服务。

---

## 二、第二期范围

### 2.1 P0 本期必做（8 个功能）
1. **微信一键登录**：`uni.login` 拿 code → Edge Function 换 openid → 自动注册/登录；保留手机号+密码登录作兜底。
2. **喂养记录**：母乳（时长）/配方奶（奶量）/辅食/水，按时间倒序，可增删改。
3. **睡眠记录**：入睡/醒来时间，自动算时长，支持"正在睡"状态。
4. **便便记录**：类型（尿/便/混合）、性状、颜色，可增删改。
5. **每日小结**：记录页顶部"今日卡片"，自动聚合当天喂养/睡眠/便便/照片/生长/疫苗数据。
6. **里程碑打卡**：预置里程碑（翻身/坐/爬/站/走/叫爸妈/长牙等）+ 自定义，可附照片，独立时间线展示。
7. **成长报告**：选月份 → 自动聚合当月照片+数据+里程碑 → canvas 生成分享图 → 保存相册/转发。
8. **家庭权限细化**：角色扩展为 owner / member / viewer（只读），owner 可生成"指定角色邀请码"、修改成员角色、移除成员。

### 2.2 P1 可选（看开发精力，文档已给出设计，可延后）
- **多宝宝支持**：babies 表结构一期已支持，二期只需前端加"宝宝切换器"（如精力不足可延后，结构已就绪）。
- **提醒系统扩展**：自定义提醒（喂奶/辅食/儿保），基于微信订阅消息（见 4.6 可选表，本期 SQL 不含，P1 追加）。
- **WHO 生长标准曲线对照**：growth 页叠加 WHO 0-2 岁百分位标准线（需引入标准数据，P1 追加）。

### 2.3 本期明确不做（防止范围蔓延）
- ❌ 会员/付费/订阅/容量限制
- ❌ 打印服务、实体周边
- ❌ 社区、育儿百科、内容流、AI 问答
- ❌ 时光视频（照片合成视频，需后端 ffmpeg，三期再说）
- ❌ 用药/症状/看诊记录
- ❌ 数据导出（三期配合合规做）

### 2.4 二期验收一句话
> 家长每天 3 次打开 App 记录喂养/睡眠/便便，晚上看"今日小结"，月底生成一张成长报告图发到家族群；爷爷/奶奶用微信一键登录 + 只读权限进来看，改不了；两个家庭之间依然互相看不到任何数据。

---

## 三、技术栈与架构决策

### 3.1 技术选型（延续一期，不更换）

| 层 | 选型 | 说明 |
|---|---|---|
| 小程序前端 | **uni-app + Vue3 + Pinia**（一期已建） | 不更换 |
| UI | 微信原生组件 + 少量自定义 | 不引入重型 UI 库 |
| 图表 | **uCharts**（生长曲线） | 不更换 |
| 后端 | **Supabase**：Auth + Postgres + RLS + Storage + **Edge Function** | 二期新增 Edge Function（仅用于微信登录） |
| 客户端 SDK | `@supabase/supabase-js` | 不更换 |
| 登录方案 | **微信一键登录（Edge Function）+ 手机号密码兜底** | 见 3.2 |
| 报告图生成 | 小程序端 **canvas** 合成（不依赖后端） | 见 3.3 |

### 3.2 微信登录方案（二期最重要技术决策，按此实现）

**流程总览**：
```
小程序端                          Edge Function (wechat-login)            微信服务器 / Supabase
─────────────────────────────    ────────────────────────────────    ──────────────────────────
uni.login() 拿 code
        ── POST /wechat-login ──►  1. 用 code 调 code2session ──────►  https://api.weixin.qq.com
        { code }                      （appid + secret）                返回 openid / session_key
                                   2. 查 profiles.wechat_openid
                                      ├─ 存在 → 取对应用户
                                      └─ 不存在 → admin.createUser 创建
                                                 （邮箱=wx_{openid}@wechat.local）
                                   3. admin.generateUserTokens(userId)
        ◄── { access_token,     ──
              refresh_token }
前端 supabase.auth.setSession({access_token, refresh_token}) → 登录完成
```

**实现要点（Agent 必读）**：
1. **Edge Function 位置**：Supabase 项目 → Edge Functions → 新建 `wechat-login`，用 `supabase/functions/wechat-login/index.ts` 本地开发后 `supabase functions deploy wechat-login`（需安装 supabase CLI 并 `supabase login`，或直接在 Dashboard Edge Functions 里在线编辑）。
2. **环境变量（只放服务端）**：`WECHAT_APPID`、`WECHAT_SECRET`（微信公众平台 → 开发管理 → 开发设置获取）、`SUPABASE_URL`、`SUPABASE_SERVICE_ROLE_KEY`。**service_role 严禁出现在前端**。
3. **code2session 接口**：`GET https://api.weixin.qq.com/sns/jscode2session?appid={appid}&secret={secret}&js_code={code}&grant_type=authorization_code`，返回 `{ openid, session_key, unionid?, errcode?, errmsg? }`。
4. **账号映射规则**：openid 为 28 位字母数字，映射邮箱 `wx_{openid}@wechat.local`（邮箱格式合法）。创建用户时 `email_confirm: true`，password 用随机串（用户无需知道），`user_metadata: { wechat_openid: openid }`。
5. **查/建 profiles**：创建用户后插入 `profiles (id=user.id, wechat_openid)`；已存在 openid 则直接复用该用户。
6. **返回令牌**：用 Supabase Admin API 的 `generateUserTokens(userId)`（如当前 SDK 无此方法，查官方文档用等价方法，如 `generateLink` + 兑换，**以官方 API 现状为准，遇到差异停下来问用户**）。
7. **前端接入**：login 页加"微信一键登录"按钮 → `uni.login({ provider: 'weixin' })` 拿 code → `supabase.functions.invoke('wechat-login', { body: { code } })` → 拿到 tokens 后 `supabase.auth.setSession()` → 刷新全局登录态（复用一期 auth store）。
8. **兜底**：手机号+密码登录（一期方案）完整保留，微信登录失败时引导用户走手机号登录。

### 3.3 成长报告生成方案
- **不落库**：报告数据实时聚合（当月 baby_photos / growth_records / milestones / 汇总统计）。
- **canvas 合成**：小程序端用 canvas 绘制分享图（背景 + 宝宝照片九宫格 + 当月数据摘要 + 里程碑列表 + 品牌名"初芽 BabyUp"），绘制完成后 `wx.canvasToTempFilePath` 导出图片 → `wx.saveImageToPhotosAlbum` 保存 → 用户自行转发。
- 注意：canvas 在部分安卓机型上有兼容问题，代码里统一 try/catch 并提示"保存失败请截图"兜底；字体用系统默认字体，不引入版权字体。

### 3.4 关键约束（延续一期 + 新增）
- **严禁** service_role 进前端；Edge Function 内的 service_role 只存在于服务端环境变量。
- 所有业务表访问必须经过 RLS；**二期新增表的写策略必须排除 viewer 角色，一期业务表的写策略同步收紧（见第四节 SQL）**。
- 每日小结/成长报告的聚合查询必须带 `family_id + baby_id` 过滤，不得出现跨家庭/跨宝宝查询。

---

## 四、数据库设计（二期变更 SQL，可整段执行）

> 在 Supabase SQL Editor 中整段执行。执行前向用户展示确认。
> **注意**：本段 SQL 包含对一期表的策略修改（收紧写权限排除 viewer），执行前确认一期数据无异常。

```sql
-- ========== 4.1 新增表 ==========

-- 用户资料表（微信绑定 + 昵称头像）
-- 一期没有此表，二期新增；已有用户自动补一条（见 4.7 迁移）
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nickname text,
  avatar_url text,
  wechat_openid text unique,          -- 微信 openid（唯一）
  wechat_unionid text,
  updated_at timestamptz not null default now()
);

-- 喂养记录表（母乳按时长，配方奶/水按毫升，辅食只记次数）
create table feeding_records (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  baby_id uuid not null references babies(id) on delete cascade,
  feed_type text not null check (feed_type in ('breast','formula','solid','water')),
  amount_ml numeric(6,1),             -- 配方奶/水：毫升
  duration_min integer,               -- 母乳：时长（分钟）
  record_time timestamptz not null default now(),  -- 喂养发生时间
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- 睡眠记录表（ended_at 为空 = 正在睡）
create table sleep_records (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  baby_id uuid not null references babies(id) on delete cascade,
  started_at timestamptz not null,    -- 入睡时间
  ended_at timestamptz,               -- 醒来时间（空 = 正在睡）
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- 便便记录表（性状/颜色用 code，前端映射中文）
create table diaper_records (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  baby_id uuid not null references babies(id) on delete cascade,
  diaper_type text not null check (diaper_type in ('pee','poop','mixed')),
  poop_character text check (poop_character in ('soft','loose','hard','watery','pasty')),
  poop_color text check (poop_color in ('yellow','golden','green','brown','dark','red','black')),
  record_time timestamptz not null default now(),
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
-- 前端映射（写死在代码常量里）：
-- 性状：soft=软便, loose=稀便, hard=硬便, watery=水样, pasty=糊状
-- 颜色：yellow=黄, golden=金黄, green=绿, brown=棕, dark=深色, red=带血丝(提示就医), black=黑(提示就医)

-- 里程碑表（预置 key + 自定义 name）
create table milestones (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  baby_id uuid not null references babies(id) on delete cascade,
  milestone_key text not null,        -- 预置 key 或 'custom'
  name text not null,                 -- 展示名（预置=中文名，自定义=用户输入）
  achieved_date date not null,
  photo_url text,                     -- Storage 路径（可空）
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
-- 预置里程碑（前端常量表）：first_smile=第一次笑, first_roll=第一次翻身, first_sit=会坐,
-- first_crawl=会爬, first_stand=会站, first_step=迈出第一步, first_word=第一次叫爸妈,
-- first_tooth=长第一颗牙, night_sleep=睡整觉, custom=自定义

-- 家庭邀请表（带角色的一次性邀请码；一期 families.invite_code 保留兼容但不再使用）
create table family_invitations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  invite_code text not null unique,   -- 6 位随机码
  role text not null default 'member' check (role in ('member','viewer')),
  expires_at timestamptz,             -- 空 = 不过期
  status text not null default 'active' check (status in ('active','used','expired','revoked')),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- ========== 4.2 一期表结构变更 ==========

-- 扩展家庭角色枚举：owner / member / viewer
-- （一期约束名默认是 family_members_role_check；若实际名称不同，先查 \d family_members 确认）
alter table family_members drop constraint family_members_role_check;
alter table family_members add constraint family_members_role_check
  check (role in ('owner','member','viewer'));

-- ========== 4.3 索引 ==========
create index idx_profiles_openid          on profiles(wechat_openid);
create index idx_feeding_family_baby      on feeding_records(family_id, baby_id, record_time desc);
create index idx_sleep_family_baby        on sleep_records(family_id, baby_id, started_at desc);
create index idx_diaper_family_baby       on diaper_records(family_id, baby_id, record_time desc);
create index idx_milestones_family_baby   on milestones(family_id, baby_id, achieved_date desc);
create index idx_invites_family           on family_invitations(family_id);
create index idx_invites_code             on family_invitations(invite_code);

-- ========== 4.4 开启 RLS ==========
alter table profiles            enable row level security;
alter table feeding_records     enable row level security;
alter table sleep_records       enable row level security;
alter table diaper_records      enable row level security;
alter table milestones          enable row level security;
alter table family_invitations  enable row level security;

-- ========== 4.5 RLS 策略 ==========
-- 权限模型升级：
--  - owner：家庭内一切权限（含改角色、移除成员、撤销邀请）
--  - member：可读写家庭内所有业务数据（一期行为不变）
--  - viewer：只能读，所有 insert/update/delete 被 RLS 拒绝
--  - 所有用户只能看到"自己是 active 成员"的家庭数据（延续一期）

-- ① profiles：用户只看/改自己的资料
create policy profiles_select on profiles for select using (auth.uid() = id);
create policy profiles_insert on profiles for insert with check (auth.uid() = id);
create policy profiles_update on profiles for update using (auth.uid() = id);

-- ② feeding_records：读=active 成员；写=active 且非 viewer
create policy feeding_select on feeding_records for select
using (exists (select 1 from family_members fm
              where fm.family_id = feeding_records.family_id
                and fm.user_id = auth.uid() and fm.status = 'active'));
create policy feeding_insert on feeding_records for insert
with check (exists (select 1 from family_members fm
                    where fm.family_id = feeding_records.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'
                      and fm.role != 'viewer'));
create policy feeding_update on feeding_records for update
using (exists (select 1 from family_members fm
               where fm.family_id = feeding_records.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));
create policy feeding_delete on feeding_records for delete
using (exists (select 1 from family_members fm
               where fm.family_id = feeding_records.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));

-- ③ sleep_records（同上模式）
create policy sleep_select on sleep_records for select
using (exists (select 1 from family_members fm
              where fm.family_id = sleep_records.family_id
                and fm.user_id = auth.uid() and fm.status = 'active'));
create policy sleep_insert on sleep_records for insert
with check (exists (select 1 from family_members fm
                    where fm.family_id = sleep_records.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'
                      and fm.role != 'viewer'));
create policy sleep_update on sleep_records for update
using (exists (select 1 from family_members fm
               where fm.family_id = sleep_records.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));
create policy sleep_delete on sleep_records for delete
using (exists (select 1 from family_members fm
               where fm.family_id = sleep_records.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));

-- ④ diaper_records（同上模式）
create policy diaper_select on diaper_records for select
using (exists (select 1 from family_members fm
              where fm.family_id = diaper_records.family_id
                and fm.user_id = auth.uid() and fm.status = 'active'));
create policy diaper_insert on diaper_records for insert
with check (exists (select 1 from family_members fm
                    where fm.family_id = diaper_records.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'
                      and fm.role != 'viewer'));
create policy diaper_update on diaper_records for update
using (exists (select 1 from family_members fm
               where fm.family_id = diaper_records.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));
create policy diaper_delete on diaper_records for delete
using (exists (select 1 from family_members fm
               where fm.family_id = diaper_records.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));

-- ⑤ milestones（同上模式）
create policy milestones_select on milestones for select
using (exists (select 1 from family_members fm
              where fm.family_id = milestones.family_id
                and fm.user_id = auth.uid() and fm.status = 'active'));
create policy milestones_insert on milestones for insert
with check (exists (select 1 from family_members fm
                    where fm.family_id = milestones.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'
                      and fm.role != 'viewer'));
create policy milestones_update on milestones for update
using (exists (select 1 from family_members fm
               where fm.family_id = milestones.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));
create policy milestones_delete on milestones for delete
using (exists (select 1 from family_members fm
               where fm.family_id = milestones.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));

-- ⑥ family_invitations：读=本家庭 active 成员；发邀请=非 viewer；撤销/改状态=仅 owner
create policy invites_select on family_invitations for select
using (exists (select 1 from family_members fm
              where fm.family_id = family_invitations.family_id
                and fm.user_id = auth.uid() and fm.status = 'active'));
create policy invites_insert on family_invitations for insert
with check (exists (select 1 from family_members fm
                    where fm.family_id = family_invitations.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'
                      and fm.role != 'viewer'));
create policy invites_update on family_invitations for update
using (exists (select 1 from family_members fm
               where fm.family_id = family_invitations.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role = 'owner'));

-- ========== 4.6 一期表写策略收紧（关键！排除 viewer） ==========
-- 删除并重建一期 4 个业务表的 insert/update/delete 策略：
-- 原先"active 成员可写"改为"active 且 role != 'viewer' 可写"。
-- babies / baby_photos / growth_records / vaccinations 的 select 策略不变（viewer 可读）。

drop policy if exists babies_insert on babies;
create policy babies_insert on babies for insert
with check (exists (select 1 from family_members fm
                    where fm.family_id = babies.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'
                      and fm.role != 'viewer'));
drop policy if exists babies_update on babies;
create policy babies_update on babies for update
using (exists (select 1 from family_members fm
               where fm.family_id = babies.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));
drop policy if exists babies_delete on babies;
create policy babies_delete on babies for delete
using (exists (select 1 from family_members fm
               where fm.family_id = babies.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));

drop policy if exists photos_insert on baby_photos;
create policy photos_insert on baby_photos for insert
with check (exists (select 1 from family_members fm
                    where fm.family_id = baby_photos.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'
                      and fm.role != 'viewer'));
drop policy if exists photos_delete on baby_photos;
create policy photos_delete on baby_photos for delete
using (exists (select 1 from family_members fm
               where fm.family_id = baby_photos.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));

drop policy if exists growth_insert on growth_records;
create policy growth_insert on growth_records for insert
with check (exists (select 1 from family_members fm
                    where fm.family_id = growth_records.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'
                      and fm.role != 'viewer'));
drop policy if exists growth_delete on growth_records;
create policy growth_delete on growth_records for delete
using (exists (select 1 from family_members fm
               where fm.family_id = growth_records.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));

drop policy if exists vaccines_insert on vaccinations;
create policy vaccines_insert on vaccinations for insert
with check (exists (select 1 from family_members fm
                    where fm.family_id = vaccinations.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'
                      and fm.role != 'viewer'));
drop policy if exists vaccines_update on vaccinations;
create policy vaccines_update on vaccinations for update
using (exists (select 1 from family_members fm
               where fm.family_id = vaccinations.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));
drop policy if exists vaccines_delete on vaccinations;
create policy vaccines_delete on vaccinations for delete
using (exists (select 1 from family_members fm
               where fm.family_id = vaccinations.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));

-- 存储桶策略收紧：viewer 可读不可传不可删
drop policy if exists photos_storage_insert on storage.objects;
create policy photos_storage_insert on storage.objects for insert
with check (
  bucket_id = 'baby-photos'
  and exists (select 1 from family_members fm
              where fm.family_id = (storage.foldername(name))[1]::uuid
                and fm.user_id = auth.uid() and fm.status = 'active'
                and fm.role != 'viewer')
);
drop policy if exists photos_storage_delete on storage.objects;
create policy photos_storage_delete on storage.objects for delete
using (
  bucket_id = 'baby-photos'
  and exists (select 1 from family_members fm
              where fm.family_id = (storage.foldername(name))[1]::uuid
                and fm.user_id = auth.uid() and fm.status = 'active'
                and fm.role != 'viewer')
);

-- ========== 4.7 数据迁移 ==========
-- 为既有用户补 profiles 行（微信字段留空，后续绑定时再更新）
insert into profiles (id, updated_at)
select u.id, now() from auth.users u
left join profiles p on p.id = u.id
where p.id is null;
```

### 4.8 数据流约定（二期新增）
- **微信登录**：见 3.2 全流程。注意 Edge Function 返回的 tokens 只用于 `setSession`，**不在前端存储 code/session_key**。
- **喂养记录**：`feed_type=breast` 时填 `duration_min`（amount_ml 空）；`formula/water` 填 `amount_ml`（duration_min 空）；`solid` 两者都空（记次数即可，次数=当日记录条数）。
- **睡眠时长**：`ended_at - started_at` 计算，前端展示"X小时X分钟"；`ended_at` 为空时显示"正在睡"，列表按 started_at 倒序。
- **每日小结聚合口径**（前端聚合，按宝宝本地时区"今天 00:00~23:59"）：
  - 喂养：总次数、母乳总时长、配方奶总毫升、辅食次数
  - 睡眠：总时长（跨天睡眠计入醒来当天）、入睡时间、醒来时间
  - 便便：次数、最近一次性状/颜色
  - 照片：当日新增张数
  - 生长/疫苗：当日有记录则显示；疫苗显示"近 7 天到期/已逾期"条数
- **成长报告聚合口径**：所选月份内照片（最多取 9 张为封面九宫格）、身高体重首末值、喂养/睡眠/便便统计、里程碑列表、"初芽 BabyUp"品牌落款。
- **邀请加入流程（二期新版）**：输入邀请码 → 查 `family_invitations`（status='active' 且未过期）→ 插入 `family_members`（role=邀请码指定 role）→ 该邀请码 status 置 'used' → 前端刷新家庭数据。
- **角色判断**：前端 store 存 `myRole`（当前用户在家庭的 role），用于 UI 隐藏（viewer 隐藏所有"新增/编辑/删除"按钮）；**但 UI 隐藏只是体验优化，真正的拦截靠 RLS**（viewer 即使构造请求也会被拒）。

---

## 五、页面结构与信息架构

### 5.1 页面清单（二期：一期 10 页 + 新增 7 页，TabBar 不变）

```
小程序（底部 TabBar：时光 / 记录 / 我的）
│
├── Tab1 时光 pages/index/index          ← 照片时间线（一期，不变）
│
├── Tab2 记录 pages/record/record        ← 【改造】今日聚合页
│     ├── 顶部：每日小结卡片（自动聚合，见 4.8）
│     └── 功能宫格（六宫格 + 里程碑）：
│           拍照 / 量一量 / 打疫苗 / 喂奶 / 睡觉 / 便便 / 里程碑
│
├── Tab3 我的 pages/profile/profile      ← 【改造】加宝宝切换器 + 提醒入口
│     ├── 宝宝切换器（多宝宝，P1；单宝宝时隐藏）
│     ├── 宝宝档案卡片（点击进编辑）
│     ├── 疫苗提醒（一期）
│     ├── 家庭成员（列表 + 邀请，二期含角色管理）
│     ├── 成长报告入口
│     └── 退出登录
│
├── pages/login/login                    ← 【改造】微信一键登录 + 手机号登录
├── pages/setup/setup                    ← 首次引导（一期，不变）
├── pages/join-family/join-family        ← 加入家庭（一期，内部改用新邀请码表）
├── pages/baby-edit/baby-edit            ← 宝宝档案编辑（一期）
├── pages/photo-detail/photo-detail      ← 照片详情（一期）
├── pages/growth/growth                  ← 生长曲线（一期；P1 叠加 WHO 标准线）
├── pages/vaccine/vaccine                ← 疫苗管理（一期）
├── pages/family/family                  ← 【改造】成员角色管理 + 生成带角色邀请码
│
├── 二期新增：
├── pages/feeding-edit/feeding-edit      ← 喂养记录（类型/奶量/时长/时间）
├── pages/sleep-edit/sleep-edit          ← 睡眠记录（入睡/醒来/"正在睡"）
├── pages/diaper-edit/diaper-edit        ← 便便记录（类型/性状/颜色）
├── pages/milestone/milestone            ← 里程碑时间线
├── pages/milestone-edit/milestone-edit  ← 里程碑打卡（预置列表/自定义 + 照片）
├── pages/report/report                  ← 成长报告（月份选择 → 生成 → 保存分享）
└── pages/reminders/reminders            ← 提醒管理（P1，二期先建占位页）
```

### 5.2 关键页面职责与要点
- **登录页（改造）**：主按钮"微信一键登录"（uni.login → Edge Function → setSession），下方保留"手机号登录"入口（tab 切换或次级链接）。登录后逻辑沿用一期：无家庭 → setup。
- **记录页（改造，二期核心页）**：
  - 顶部"今日小结"卡片：展示当日喂养次数/睡眠时长/便便次数/照片张数，点击进汇总详情（可下拉展开明细列表）。
  - 功能宫格：拍照、量一量、打疫苗、喂奶、睡觉、便便、里程碑（7 个入口，viewer 隐藏可写入口，只留小结与列表查看）。
  - 各记录入口点开后为"表单页（编辑）+ 本类记录当日列表"（表单页内嵌最近记录列表，或跳独立列表页，选实现简单的方案）。
- **喂养表单（feeding-edit）**：顶部类型选择器（母乳/配方奶/辅食/水）→ 按类型显示对应字段（母乳=时长分钟；配方奶/水=毫升；辅食=无数量）→ 时间默认"现在"可选改 → 备注可空 → 保存。母乳可加"双侧"快捷（左侧/右侧/双侧，存 note 即可，不建字段）。
- **睡眠表单（sleep-edit）**：入睡时间（默认现在）、醒来时间（空 = 正在睡，保存后再点"结束睡眠"补醒来时间）、备注。保存后列表显示时长。
- **便便表单（diaper-edit）**：类型三选（尿/便/混合）→ 类型含"便"时显示性状+颜色选择器 → 时间 → 备注。红色/黑色便便保存时提示"建议咨询医生"（轻提示，不阻断）。
- **里程碑页（milestone）**：时间线（按 achieved_date 倒序，每条含名称/日期/照片/备注）；右上"打卡"按钮进 milestone-edit。
- **打卡表单（milestone-edit）**：预置里程碑列表（带图标，按常见月龄排序）或"自定义"输入框 → 日期默认今天 → 可拍照/选图 → 备注 → 保存。
- **成长报告页（report）**：月份选择器（默认上月，可滚动选历史月）→ "生成报告" → canvas 渲染预览 → 底部按钮"保存到相册"（wx.saveImageToPhotosAlbum，需用户授权 scope.writePhotosAlbum）→ "重新生成"。
- **家庭页（改造）**：
  - 成员列表：昵称 + 角色标签（owner=创建者 / member=成员 / viewer=只读）。
  - 邀请区：选择角色（成员/只读）→ 生成一次性邀请码（有效期可选：7 天/30 天/永久）→ 展示大字 + 复制。旧邀请码列表（状态：未使用/已使用/已过期/已撤销）。
  - owner 可操作：修改成员角色、移除成员（移除 = family_members.status='removed'）；member 只能看；viewer 只读。
- **我的页（改造）**：宝宝切换器（P1 实现，多宝宝时显示）；"成长报告"入口；"提醒管理"入口（P1）；其余一期不变。

---

## 六、核心交互流程（用户故事）

> 每个流程 = 用户操作 → 系统动作 → 数据变更。开发时按此实现页面跳转与接口调用。

### 流程 1：微信一键登录（新用户）
1. 打开小程序 → 未登录 → 登录页。
2. 点"微信一键登录" → 微信授权弹窗 → `uni.login` 拿 code。
3. 前端调 Edge Function `wechat-login` → 服务端换 openid → 查 profiles → 无则创建用户+profiles。
4. 返回 tokens → `supabase.auth.setSession` → 登录成功。
5. 查询 family_members → 无记录 → 跳 setup（创建家庭/建档案，沿用一期流程）。
6. 完成。新用户从打开到进首页约 5 秒，无手机号输入。

### 流程 2：记录一次喂养（10 秒完成）
1. 记录页点"喂奶" → feeding-edit。
2. 妈妈选"配方奶" → 输入 120 → 点保存（时间默认现在）。
3. 插入 `feeding_records` → 返回记录页，今日小结的"喂养次数/总奶量"立即 +1。
4. 母乳场景：选"母乳" → 输入 15 分钟 → 保存，小结显示母乳总时长。

### 流程 3：记录睡眠（含"正在睡"）
1. 记录页点"睡觉" → sleep-edit。
2. 爸爸点"开始睡眠"（入睡时间=现在，ended_at 空）→ 保存 → 列表显示"正在睡"。
3. 宝宝醒来：点该条"结束睡眠" → 填醒来时间（默认现在）→ 保存。
4. 系统计算时长 → 列表显示"9 小时 30 分钟"，小结的睡眠总时长累加。

### 流程 4：便便记录 + 异常提示
1. 记录页点"便便" → diaper-edit。
2. 奶奶选"便" → 性状"稀便"、颜色"绿" → 保存。
3. 若颜色选"红"或"黑" → 保存时弹轻提示"建议咨询医生"（不阻断保存）。
4. 妈妈在今日小结看到便便次数与最近性状。

### 流程 5：查看每日小结
1. 晚上打开记录页 → 顶部今日卡片显示聚合数字。
2. 点击卡片展开当日明细：喂养时间线、睡眠时段、便便记录、当日照片缩略图。
3. 数据为空项不显示（如当天没拍照片就不显示照片行）。

### 流程 6：里程碑打卡
1. 记录页点"里程碑" → milestone 时间线页。
2. 点"打卡" → milestone-edit → 选"第一次翻身" → 日期默认今天 → 拍一张照片 → 保存。
3. 插入 `milestones` → 时间线顶部出现新节点（名称+日期+照片）。
4. 宝宝长大后再打卡"迈出第一步"，时间线按日期排好，成为成长报告素材。

### 流程 7：生成并分享成长报告（获客钩子）
1. 我的页/记录页点"成长报告" → report 页。
2. 选月份（默认上月）→ 点"生成报告" → 聚合当月数据 + 照片 → canvas 绘制预览。
3. 点"保存到相册" → 授权 → 图片存入相册。
4. 妈妈把图发到家族群 → 亲戚看到"初芽 BabyUp"落款 → 扫码体验（进入微信登录 → 建家庭引导）。
5. 失败兜底：canvas 导出失败时 toast"保存失败，可截图保存"，不阻塞页面。

### 流程 8：邀请家人（带角色）
1. 家庭页点"邀请成员" → 选角色（成员/只读）+ 有效期 → 生成 6 位邀请码。
2. 复制发到家族群 → 家人打开小程序 → 微信一键登录 → 无家庭 → 输入邀请码。
3. 系统：查 `family_invitations`（active 且未过期）→ 插入 family_members（role=邀请码角色）→ 邀请码置 used。
4. 奶奶（viewer）进入后：能看到照片/记录/小结，所有新增编辑按钮隐藏；即使构造请求也会被 RLS 拒绝（服务端兜底）。
5. owner 后续可把奶奶改为 member，或移除。

### 流程 9：多宝宝切换（P1，结构已就绪）
1. 我的页点"添加宝宝" → 建第二个宝宝档案。
2. 我的页顶部出现宝宝切换器（头像 + 名称下拉）。
3. 切换后所有 Tab 与记录页自动按"当前宝宝"过滤（store 里 currentBabyId 驱动所有查询）。

---

## 七、分步开发计划（Agent 按此顺序执行）

> 每步包含：目标 / 涉及内容 / 完成标准。**严格按顺序**，前一步未验证通过不进入下一步。

### Step 0：环境确认与一期待办
- 目标：确认一期的确可交付，二期环境就绪。
- 内容：
  1. 跑一遍第一期验收清单，确认无遗留问题（有则先修一期）。
  2. 备份一期数据库（Supabase Dashboard → Database → Backups，或导出 SQL）。
  3. 确认微信小程序已认证，拿到 AppID 与 AppSecret（mp.weixin.qq.com → 开发管理）。
  4. 安装 supabase CLI（本地）或确认 Dashboard 的 Edge Functions 入口可用；确认 Node 环境。
- 完成标准：AppID/AppSecret 可用；Edge Function 能创建/部署；一期数据备份完成。

### Step 1：数据库变更落地
- 目标：执行第四节完整 SQL。
- 内容：在 Supabase SQL Editor 执行 4.1~4.7 全部语句；逐条核对无报错；确认一期策略被正确替换。
- 完成标准：
  - 新增 6 张表 + profiles 迁移完成（既有用户都有 profiles 行）；
  - 一期 4 表写策略已排除 viewer；storage 写策略已排除 viewer；
  - SQL 自测：`select * from feeding_records limit 1`（未登录）返回空。

### Step 2：微信登录接入
- 目标：Edge Function + 前端一键登录全链路打通。
- 内容：
  1. 创建 `wechat-login` Edge Function（见 3.2 伪代码），配置 4 个环境变量（WECHAT_APPID/WECHAT_SECRET/SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY）。
  2. 部署函数并本地 curl 联调：用微信开发者工具的"获取 code"能力模拟（真机/开发者工具能拿到真实 code）。
  3. 前端 login 页加"微信一键登录"：uni.login → invoke → setSession → 恢复全局态。
  4. 保留手机号+密码登录（一期逻辑不动）。
- 完成标准：微信开发者工具里点一键登录 → 授权 → 自动进入建家庭引导；第二次打开直接登录（不用再授权）；手机号登录仍可用。
- **若 generateUserTokens / code2session 行为与文档不一致，停下来向用户说明并确认，不猜实现。**

### Step 3：喂养记录
- 目标：feeding-edit 表单 + 记录页入口 + 当日列表。
- 内容：类型选择器（母乳/配方奶/辅食/水）、条件字段（时长/毫升）、时间选择、保存/删除；记录页宫格加入口；表单页下方当日列表。
- 完成标准：四种类型分别保存成功；列表倒序；删除后小结数字同步减少；RLS 正常（viewer 无法新增，用 SQL/控制台验证）。

### Step 4：睡眠记录
- 目标：sleep-edit 表单（含"正在睡"状态）+ 时长计算。
- 内容：开始睡眠（ended_at 空）、结束睡眠（补 ended_at）、时长格式化（X小时X分钟）、列表展示。
- 完成标准：跨天睡眠（21:00 入睡次日 6:30 醒来）时长计算正确；"正在睡"状态跨页面保持；结束睡眠后时长正确显示。

### Step 5：便便记录
- 目标：diaper-edit 表单（类型/性状/颜色）+ 红黑便提示。
- 内容：类型三选、性状/颜色选择器（中文映射常量表）、异常颜色轻提示、保存/删除。
- 完成标准：含"便"类型时性状颜色可选、纯尿时不显示；红/黑便提示出现且不阻断保存。

### Step 6：每日小结
- 目标：记录页顶部"今日卡片" + 明细展开。
- 内容：按 4.8 口径聚合当日数据（并行查询 5 类表，按 family_id + baby_id + 今日范围过滤）；卡片展示；展开明细列表。
- 完成标准：录入测试数据后，小结数字与明细逐项一致（抽样核对 3 天数据）；空项不显示。

### Step 7：里程碑
- 目标：milestone 时间线 + milestone-edit 打卡。
- 内容：预置里程碑常量表（10 个，含自定义）、打卡表单（选择/自定义 + 日期 + 照片上传至 `{family_id}/{baby_id}/milestone/{uuid}.jpg`）、时间线展示。
- 完成标准：打卡后时间线出现节点；照片可显示（signed URL）；自定义里程碑可保存。

### Step 8：家庭权限与邀请
- 目标：角色体系前端落地 + 邀请码全流程。
- 内容：
  1. family 页改造：成员列表带角色标签；owner 可改角色/移除；viewer 隐藏全部写操作按钮（全局按 myRole 控制）。
  2. 邀请区：选角色 + 有效期 → 生成邀请码（插入 family_invitations）→ 复制。
  3. join-family 改造：用 family_invitations 校验（active + 未过期 + 一次性）。
  4. store 增加 myRole 状态，登录/切换家庭时刷新。
- 完成标准：owner 生成"只读"邀请码 → 新账号加入后只能查看，所有写按钮隐藏且 RLS 拒绝；邀请码用一次即失效；过期码提示"已失效"。

### Step 9：成长报告
- 目标：report 页 + canvas 分享图生成 + 保存相册。
- 内容：月份选择、聚合当月数据（照片最多 9 张、生长首末、统计数字、里程碑）、canvas 绘制（背景 + 九宫格 + 文字 + 品牌落款）、wx.canvasToTempFilePath + saveImageToPhotosAlbum、失败兜底。
- 完成标准：选任意有数据的月份能生成图；图片保存到相册可正常查看；无数据月份显示"本月暂无记录"空态。

### Step 10：多宝宝（P1，若精力允许）+ 联调验收
- 目标：宝宝切换器 + 全功能联调。
- 内容（P1 部分）：profile 页"添加宝宝" + 顶部切换器；currentBabyId 进 Pinia，驱动所有查询与记录表单；各 Tab 数据随切换刷新。
- 联调：按第八节验收清单逐项自测，两个家庭 × 三类角色（owner/member/viewer）交叉验证 RLS。
- 完成标准：验收清单全部通过（含多宝宝隔离，若已实现）。

---

## 八、验收清单（Agent 交付前逐项勾选）

**登录与账号**
- [ ] 微信一键登录：新用户授权后自动注册并进入建家庭引导，全程无需输入手机号
- [ ] 微信登录后刷新小程序，登录态保持（setSession 持久化）
- [ ] 手机号+密码注册/登录仍正常（兜底路径）
- [ ] 前端代码中无 service_role / AppSecret（只在 Edge Function 环境变量）

**记录功能（喂养/睡眠/便便）**
- [ ] 喂养四种类型均可保存/编辑/删除，列表按时间倒序
- [ ] 睡眠"开始/结束"流程正确，跨天时长计算正确，"正在睡"状态正常
- [ ] 便便类型/性状/颜色正确保存；红/黑便出现轻提示
- [ ] viewer 账号无法新增/编辑/删除任何记录（UI 隐藏 + RLS 拒绝双验证）

**每日小结**
- [ ] 聚合数字与明细数据一致（抽样核对）
- [ ] 空数据项不显示；跨天睡眠计入正确的一天
- [ ] 小结按"当前宝宝"过滤（多宝宝时互不串数据）

**里程碑**
- [ ] 预置里程碑 + 自定义均可打卡，时间线按日期倒序
- [ ] 里程碑照片可正常显示（signed URL）

**成长报告**
- [ ] 选择有数据的月份可生成报告图，照片九宫格/数据/里程碑展示正确
- [ ] 图片可保存到相册；无数据月份显示空态
- [ ] 生成失败有兜底提示（不白屏不卡死）

**家庭权限**
- [ ] owner 可改成员角色、可移除成员；member 无此权限（UI 隐藏）
- [ ] 邀请码一次性有效、过期码提示失效、撤销后不可用
- [ ] viewer 只能读：一期功能（照片/生长/疫苗）与二期功能（喂养/睡眠/便便/里程碑/小结）均只读

**权限与安全（重点回归）**
- [ ] 账号 A 与账号 B（不同家庭）互不可见任何数据（含新增 6 张表）
- [ ] viewer 构造写请求（绕过 UI 直接调 API）被 RLS 拒绝
- [ ] 未登录无法读到任何业务数据
- [ ] 照片桶仍为 private；storage 写策略已排除 viewer

**体验**
- [ ] 任一新记录操作 ≤ 2 步
- [ ] 无报错、无白屏；弱网有加载态
- [ ] 微信开发者工具 + 真机（安卓/苹果各一）均通过

---

## 九、风险与注意事项（Agent 与用户都需知晓）

1. **微信登录是二期最易踩坑点**：code2session 需真实 AppID/AppSecret（开发者工具模拟可调通，真机需小程序已发布体验版）；`generateUserTokens` 等 Admin API 以官方文档当前版本为准，**遇到 API 差异停止并询问，不猜**。
2. **密钥安全**：WECHAT_SECRET 与 SUPABASE_SERVICE_ROLE_KEY 只放 Edge Function 环境变量，严禁进前端/仓库/文档。
3. **RLS 收紧是安全底线**：二期策略修改覆盖了一期表，验证时务必回归"viewer 只读、跨家庭隔离"两项；任何"拿不到数据/写不进去"先查 RLS，不要图方便禁 RLS 或换 service_role。
4. **儿童健康数据敏感度升级**：喂养/睡眠/便便属健康信息，叠加照片，是《儿童个人信息网络保护规定》关注对象。二期仍不外部分享（成长报告图由家长自行转发，App 内无公开展示），但**隐私政策/用户协议需要在推广前补**（三期上线前必做项，二期先在"我的"页加隐私政策入口占位）。
5. **时区问题**：每日小结按本地时区聚合（UTC+8），统一用前端本地日期生成"今日 00:00~23:59"边界后转 UTC 查询，避免跨时区/跨天错账。
6. **canvas 兼容性**：生成分享图在不同机型有差异，代码 try/catch + 兜底提示；测试覆盖低端安卓。
7. **邀请码体系切换**：一期 families.invite_code 废弃（数据保留不删）；二期全部走 family_invitations。旧邀请码失效属预期，文档/引导语写清。
8. **报告图品牌**：落款"初芽 BabyUp"为二期暂定名，若项目更名，改 report 页常量即可。

---

## 十、给 Agent 的执行规则（必读）

1. **前置条件**：一期验收清单必须全部通过才开始二期；二期 SQL 执行前先备份数据库。
2. **严格按第七节步骤顺序执行**，每步完成自测（见该步"完成标准"）后再进入下一步。
3. **执行 SQL 前先展示给用户确认**；用户确认后再在 Supabase SQL Editor 执行。
4. **Edge Function 部署与环境变量配置**属于"改动外部服务"的操作，执行前向用户说明将使用其 Supabase 项目的函数功能与微信密钥，获得确认后再部署。
5. 遇到文档未定义、字段含义不明、或官方 API 与文档描述不一致时（尤其微信 code2session、Supabase Admin API 版本差异），**停止并列出问题向用户确认**，不要自行猜测实现。
6. 密钥管理：anon key 可进前端；service_role / AppSecret / 数据库密码绝不进前端代码或提交到仓库。
7. 编码规范（延续一期）：Vue3 组合式 API；业务查询统一按 family_id + baby_id 过滤；注释写清"业务意图"。
8. 二期交付前必须跑通"八、验收清单"全部项目（含一期功能回归），并输出验收结论。
