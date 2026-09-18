# 婴儿成长记录小程序 · 第一期开发需求文档

> **文档用途**：本文件是给 AI 开发 Agent 执行的第一期开发规格说明。Agent 按"七、分步开发计划"从 Step 0 开始逐步实现，每步完成自测后再进入下一步；遇到文档未覆盖或存在歧义的地方，列出问题向用户确认，禁止自行假设。
>
> **项目代号**：baby-record（一期）

---

## 一、项目概述

### 1.1 背景
- 开发者（用户）本人有新生儿，需要一款记录婴儿成长生活的小程序，供自己家庭日常使用。
- 第一期目标：**快速上线自用**（预期 1~2 周开发量），覆盖"记录照片、生长数据、疫苗、家庭共享"四个核心场景。
- 未来目标（本期不实现，但**架构必须预留**）：推广给其他家庭使用，多家庭数据绝对隔离，后续可做会员与 AI 功能。

### 1.2 产品定位
- 一款"家庭私密"的婴儿成长记录工具，核心价值 = **记录简单 + 时间线回顾 + 家人共同参与**。
- 对标参考：亲宝宝、宝宝树（仅作功能参考，不做功能堆砌）。

### 1.3 关键设计原则
1. **多租户隔离从第一天做对**：所有业务数据挂在 `family_id`（家庭空间）下，权限用数据库 RLS 强制隔离，A 家庭永远看不到 B 家庭数据。这是未来产品化的地基，不可妥协。
2. **一期只做 5 个功能**，其余全部不做（见"二、范围"），防止范围蔓延。
3. **记录路径 ≤ 2 步**：任何一条记录（拍照/量身高/打疫苗）用户操作不超过 2 步完成。
4. 不写自建后端服务，全部依赖 Supabase（Auth / Postgres / RLS / Storage）。

---

## 二、第一期范围

### 2.1 本期实现（5 个功能）
1. **宝宝档案**：创建/编辑宝宝资料（昵称、生日、性别、头像）。
2. **照片/视频时间线**：拍照/上传、写备注、按时间倒序浏览、按月分组、可删除。
3. **身高体重记录**：录入身高/体重/头围，展示简单生长曲线图。
4. **疫苗记录与提醒**：记录已接种/计划接种疫苗，展示"待接种/已接种/已逾期"状态，站内提醒列表。
5. **家庭成员管理**：创建家庭、邀请码加入家庭、成员列表、退出。

### 2.2 本期明确不做（防止范围蔓延）
- ❌ 喂养记录、睡眠记录、大小便记录
- ❌ 里程碑（第一次翻身等）
- ❌ 症状/用药记录
- ❌ 在线支付、会员、订阅消息推送
- ❌ AI 功能（成长月报/问答）
- ❌ 视频直播、社区、朋友圈分享
- ❌ 多宝宝支持（一期一个家庭一个宝宝，表结构按多宝宝设计即可）

### 2.3 一期验收一句话
> 一个家庭（父母+爷爷奶奶）可以：注册登录 → 建档案 → 每天拍照记备注 → 记录身高体重看曲线 → 管理疫苗到期提醒 → 邀请家人一起看一起记。全程数据只对本家庭成员可见。

---

## 三、技术栈与架构决策

### 3.1 技术选型（推荐，除非有强理由否则不要更换）

| 层 | 选型 | 说明 |
|---|---|---|
| 小程序前端 | **uni-app + Vue3 + Pinia** | 开发者熟悉 Vue3 语法，一套代码可编译到微信小程序，生态成熟 |
| UI | 微信原生组件 + 少量自定义 | 不引入重型 UI 库，保持轻量 |
| 图表 | **uCharts**（uni-app 生态） | 用于生长曲线，轻量无依赖 |
| 后端 | **Supabase**（不写自建服务） | Auth + Postgres + RLS + Storage |
| 客户端 SDK | `@supabase/supabase-js` | uni-app 中直接使用 |
| 登录方案 | **手机号 + 密码**（映射为 Supabase 邮箱账号，见 3.2） | 一期最简可执行方案 |
| 部署 | 微信小程序开发者工具上传 + Supabase 免费版起步 | — |

### 3.2 登录方案（重要技术决策，按此实现）
- **一期方案（推荐）**：不使用微信 `getPhoneNumber` 组件（避免依赖 Edge Function 和 appid/secret 配置），直接采用**手机号 + 密码注册/登录**：
  - 注册：用户输入手机号 + 密码 → 映射为 Supabase 邮箱账号 `{手机号}@phone.local`，调用 `supabase.auth.signUp({ email, password })`。
  - 登录：`supabase.auth.signInWithPassword({ email, password })`。
  - Session 由 supabase-js 自动管理（本地存储）。
  - 已存在账号则直接登录；手机号唯一。
- **二期可选升级**：Edge Function 对接微信手机号快速验证组件（需小程序 appid/secret，以当时 Supabase 官方文档为准），本期不做。

### 3.3 关键约束
- **严禁**将 `service_role` 密钥放在前端；前端只用 `anon` key（Supabase URL + anon key 可暴露）。
- 所有对业务表的访问**必须经过 RLS**，前端不直接绕过。
- 存储桶照片访问走 RLS 鉴权（桶设为 private）。

---

## 四、数据库设计（完整 SQL，可整段执行）

> 在 Supabase SQL Editor 中整段执行。执行前向用户展示确认。

```sql
-- ========== 4.1 表结构 ==========

-- 家庭空间表
create table families (
  id uuid primary key default gen_random_uuid(),
  name text not null default '我的家',
  invite_code text not null unique,          -- 邀请码（6位，用于家人加入）
  created_at timestamptz not null default now()
);

-- 家庭成员表（用户-家庭 关联，一期一个用户属于一个家庭）
create table family_members (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'member' check (role in ('owner','member')),
  nickname text,
  status text not null default 'active' check (status in ('active','removed')),
  created_at timestamptz not null default now(),
  unique (family_id, user_id)
);

-- 宝宝档案表（一期一个家庭一个宝宝，结构按多宝宝设计）
create table babies (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  name text not null,                        -- 宝宝昵称
  gender text check (gender in ('male','female')),
  birthday date,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 照片/视频日记表
create table baby_photos (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  baby_id uuid not null references babies(id) on delete cascade,
  media_type text not null default 'image' check (media_type in ('image','video')),
  storage_path text not null,                -- Storage 中的对象路径
  note text,                                 -- 一句话备注
  taken_at timestamptz not null default now(), -- 拍摄时间（时间线排序依据）
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- 生长记录表（身高/体重/头围，可只填部分）
create table growth_records (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  baby_id uuid not null references babies(id) on delete cascade,
  record_date date not null default current_date,
  height_cm numeric(5,1),                    -- 身高 cm
  weight_kg numeric(5,2),                    -- 体重 kg
  head_cm numeric(5,1),                      -- 头围 cm
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- 疫苗记录表（已接种 / 计划接种共用，状态由 vaccinated_date 推导）
create table vaccinations (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  baby_id uuid not null references babies(id) on delete cascade,
  name text not null,                        -- 疫苗名称（如：乙肝疫苗）
  dose text,                                 -- 剂次（如：第1剂）
  scheduled_date date,                       -- 计划接种日期（可为空）
  vaccinated_date date,                      -- 实际接种日期（为空=未接种）
  hospital text,
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

-- ========== 4.2 索引 ==========
create index idx_family_members_user   on family_members(user_id);
create index idx_family_members_family on family_members(family_id);
create index idx_babies_family         on babies(family_id);
create index idx_photos_family_baby    on baby_photos(family_id, baby_id, taken_at desc);
create index idx_growth_family_baby    on growth_records(family_id, baby_id, record_date);
create index idx_vaccines_family_baby  on vaccinations(family_id, baby_id);

-- ========== 4.3 开启 RLS ==========
alter table families       enable row level security;
alter table family_members enable row level security;
alter table babies         enable row level security;
alter table baby_photos    enable row level security;
alter table growth_records enable row level security;
alter table vaccinations   enable row level security;

-- ========== 4.4 RLS 策略 ==========
-- 核心权限模型：
--  - 用户只能看到"自己是 active 成员"的家庭及其下所有数据
--  - family_members 表用户可看自己的行（供子查询命中）
--  - 家庭创建者（owner）可改家庭信息；所有 active 成员可读写宝宝及记录

-- families
create policy families_select on families for select
using (
  exists (select 1 from family_members fm
          where fm.family_id = families.id
            and fm.user_id = auth.uid()
            and fm.status = 'active')
);
create policy families_insert on families for insert
with check (true);  -- 任何登录用户可创建家庭
create policy families_update on families for update
using (
  exists (select 1 from family_members fm
          where fm.family_id = families.id
            and fm.user_id = auth.uid()
            and fm.role = 'owner'
            and fm.status = 'active')
);

-- family_members
create policy members_select on family_members for select
using (auth.uid() = user_id);
create policy members_insert on family_members for insert
with check (auth.uid() = user_id);
create policy members_update on family_members for update
using (
  exists (select 1 from family_members fm
          where fm.family_id = family_members.family_id
            and fm.user_id = auth.uid()
            and fm.role = 'owner'
            and fm.status = 'active')
);

-- babies / baby_photos / growth_records / vaccinations：统一"家庭成员可读写"
create policy babies_select on babies for select
using (exists (select 1 from family_members fm
               where fm.family_id = babies.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'));
create policy babies_insert on babies for insert
with check (exists (select 1 from family_members fm
                    where fm.family_id = babies.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'));
create policy babies_update on babies for update
using (exists (select 1 from family_members fm
               where fm.family_id = babies.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'));
create policy babies_delete on babies for delete
using (exists (select 1 from family_members fm
               where fm.family_id = babies.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'));

create policy photos_select on baby_photos for select
using (exists (select 1 from family_members fm
               where fm.family_id = baby_photos.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'));
create policy photos_insert on baby_photos for insert
with check (exists (select 1 from family_members fm
                    where fm.family_id = baby_photos.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'));
create policy photos_delete on baby_photos for delete
using (exists (select 1 from family_members fm
               where fm.family_id = baby_photos.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'));

create policy growth_select on growth_records for select
using (exists (select 1 from family_members fm
               where fm.family_id = growth_records.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'));
create policy growth_insert on growth_records for insert
with check (exists (select 1 from family_members fm
                    where fm.family_id = growth_records.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'));
create policy growth_delete on growth_records for delete
using (exists (select 1 from family_members fm
               where fm.family_id = growth_records.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'));

create policy vaccines_select on vaccinations for select
using (exists (select 1 from family_members fm
               where fm.family_id = vaccinations.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'));
create policy vaccines_insert on vaccinations for insert
with check (exists (select 1 from family_members fm
                    where fm.family_id = vaccinations.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'));
create policy vaccines_update on vaccinations for update
using (exists (select 1 from family_members fm
               where fm.family_id = vaccinations.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'));
create policy vaccines_delete on vaccinations for delete
using (exists (select 1 from family_members fm
               where fm.family_id = vaccinations.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'));

-- ========== 4.5 存储桶（照片） ==========
insert into storage.buckets (id, name, public)
values ('baby-photos', 'baby-photos', false);

-- 对象路径约定：{family_id}/{baby_id}/{uuid}.jpg
-- 读取：仅本家庭成员
create policy photos_storage_read on storage.objects for select
using (
  bucket_id = 'baby-photos'
  and exists (
    select 1 from family_members fm
    where fm.family_id = (storage.foldername(name))[1]::uuid
      and fm.user_id = auth.uid()
      and fm.status = 'active'
  )
);
-- 上传：仅本家庭成员
create policy photos_storage_insert on storage.objects for insert
with check (
  bucket_id = 'baby-photos'
  and exists (
    select 1 from family_members fm
    where fm.family_id = (storage.foldername(name))[1]::uuid
      and fm.user_id = auth.uid()
      and fm.status = 'active'
  )
);
-- 删除：仅本家庭成员
create policy photos_storage_delete on storage.objects for delete
using (
  bucket_id = 'baby-photos'
  and exists (
    select 1 from family_members fm
    where fm.family_id = (storage.foldername(name))[1]::uuid
      and fm.user_id = auth.uid()
      and fm.status = 'active'
  )
);
```

### 4.6 数据流约定
- 照片上传：前端 `wx.chooseMedia` 选择 → `wx.compressImage` 压缩 → 上传 Supabase Storage（路径 `{family_id}/{baby_id}/{uuid}.jpg`）→ 成功后向 `baby_photos` 插入一条记录（storage_path = 对象路径，不含 URL）。
- 显示照片：通过 `supabase.storage.from('baby-photos').createSignedUrl(path, 3600)` 获取临时访问 URL（1 小时有效），或生成公开 URL 前二次校验 RLS。**推荐用 signed URL**。
- 疫苗状态推导：`vaccinated_date IS NOT NULL` → 已接种；`vaccinated_date IS NULL AND scheduled_date < 今天` → 已逾期；`vaccinated_date IS NULL` → 待接种。

---

## 五、页面结构与信息架构

### 5.1 页面清单（一期共 10 个页面）

```
小程序（底部 TabBar：时光 / 记录 / 我的）
│
├── Tab1 时光 pages/index/index          ← 照片时间线（默认首页）
│     ├── 照片流：按 taken_at 倒序、按月分组展示
│     ├── 悬浮"拍照/上传"按钮
│     └── 点击照片 → 照片详情页
│
├── Tab2 记录 pages/record/record        ← 快速记录中心（三宫格入口）
│     ├── 拍照片（跳相机/相册 → 写备注 → 保存）
│     ├── 量一量（身高体重表单 → 保存 → 可看曲线）
│     └── 打疫苗（疫苗列表 → 添加/标记接种）
│
├── Tab3 我的 pages/profile/profile
│     ├── 宝宝档案卡片（点击进编辑）
│     ├── 疫苗提醒（待办列表：待接种/已逾期红点）
│     ├── 家庭成员（列表 + 邀请）
│     └── 退出登录
│
├── pages/login/login                    ← 登录/注册（手机号+密码）
├── pages/setup/setup                    ← 首次引导（创建家庭 → 建宝宝档案）
├── pages/join-family/join-family        ← 输入邀请码加入家庭
├── pages/baby-edit/baby-edit            ← 宝宝档案编辑
├── pages/photo-detail/photo-detail      ← 照片详情（看大图/编辑备注/删除）
├── pages/growth/growth                  ← 生长记录 + 曲线图
├── pages/vaccine/vaccine                ← 疫苗管理（列表+添加+标记接种）
└── pages/family/family                  ← 家庭成员管理（展示邀请码/复制）
```

### 5.2 关键页面职责与要点
- **登录页**：手机号 + 密码；注册后自动进入"首次引导"；登录后校验是否已有家庭（查 family_members），没有则进 setup。
- **首次引导（setup）**：① 创建家庭（生成 6 位随机邀请码，存 families.invite_code）→ ② 当前用户写入 family_members（role=owner）→ ③ 创建宝宝档案。三步完成，可跳过（跳过则首页显示"未设置宝宝档案"引导卡）。
- **时光页（index）**：查询当前家庭第一个宝宝的照片，`taken_at desc` 排序；按月分组展示（如"2026年9月"）；支持下拉刷新、上拉加载更多（分页 20 条）。
- **记录页（record）**：三宫格快速入口，均为 1 步直达表单/相机。
- **生长曲线（growth）**：uCharts 折线图，x 轴 record_date，y 轴对应数值；默认展示体重，可切换身高/头围；下方为历史列表。
- **疫苗页（vaccine）**：顶部为"待办"区（待接种 + 已逾期），下方全部记录；新增时必填疫苗名称，可选剂次/计划日期；点击"标记已接种"填实际日期。
- **家庭页（family）**：展示家庭名称、邀请码（大字 + 一键复制）、成员列表（昵称+角色）；"复制邀请码"供分享给家人。

---

## 六、核心交互流程（用户故事）

> 每个流程 = 用户操作 → 系统动作 → 数据变更。开发时按此实现页面跳转与接口调用。

### 流程 1：首次使用（注册 → 建家庭 → 建档案）
1. 用户打开小程序 → 未登录 → 登录页。
2. 输入手机号+密码注册 → `supabase.auth.signUp({email: 手机号@phone.local, password})`。
3. 自动登录成功后，查询 `family_members` → 无记录 → 跳 setup。
4. 用户点"创建我的家庭" → 插入 `families`（生成随机 6 位邀请码）→ 插入 `family_members`（role=owner）→ 跳"建宝宝档案"。
5. 填昵称/生日/性别 → 插入 `babies` → 跳首页（时光页）。
6. 完成。首页显示空时间线 + "记录第一条"引导。

### 流程 2：记录一条照片
1. 首页/记录页点拍照 → `wx.chooseMedia` 选图/拍摄。
2. 写一句话备注（可跳过）→ 点保存。
3. 系统：`wx.compressImage` 压缩 → 上传 Storage（路径 family_id/baby_id/uuid.jpg）→ 成功后插入 `baby_photos`。
4. 回到时光页，新照片出现在时间线顶部。
5. 失败处理：上传失败提示重试；已插入记录但图片缺失需清理。

### 流程 3：记录身高体重
1. 记录页点"量一量" → growth 表单页。
2. 填日期（默认今天）、身高、体重（头围可空）→ 保存。
3. 插入 `growth_records` → 跳转曲线页查看最新点。
4. 曲线页按 record_date 升序绘制折线。

### 流程 4：疫苗管理与提醒
1. 记录页点"打疫苗" → vaccine 页。
2. 添加疫苗：名称 + 剂次 + 计划日期 → 插入 `vaccinations`（vaccinated_date 为空）。
3. 到期判断：`scheduled_date` 距今 ≤ 7 天 → "即将接种"；已过 → "已逾期"，在"我的"页疫苗提醒区红点展示。
4. 接种后：点击该条"标记已接种" → 填实际日期 → 更新 vaccinated_date → 状态变"已接种"。

### 流程 5：邀请家人加入
1. 家庭页展示邀请码 + "复制"按钮。
2. 家人打开小程序 → 注册登录 → 无家庭 → setup 页 → 选"加入已有家庭" → 输入邀请码。
3. 校验：查 `families` 按 invite_code → 存在则插入 `family_members`（role=member）→ 跳首页。
4. 邀请码错误提示"邀请码无效"。
5. 新成员加入后，即可看到该家庭全部照片与记录（RLS 自动放行）。

---

## 七、分步开发计划（Agent 按此顺序执行）

> 每步包含：目标 / 涉及内容 / 完成标准。**严格按顺序**，前一步未验证通过不进入下一步。

### Step 0：环境准备
- 目标：拿到可开发的账号与密钥。
- 内容：
  1. 确认/注册微信小程序账号（AppID），下载微信开发者工具。
  2. 创建 Supabase 项目，记录 Project URL 和 anon key。
  3. 本地创建 uni-app 项目（Vue3），安装 `@supabase/supabase-js`、uCharts。
- 完成标准：项目能在微信开发者工具中编译运行；supabase client 初始化成功（调用 `auth.getSession()` 不报错）。

### Step 1：数据库落地
- 目标：执行第四节完整 SQL。
- 内容：在 Supabase SQL Editor 执行 4.1~4.5 全部语句；逐条核对无报错。
- 完成标准：
  - 6 张表 + 索引 + 6 个 RLS + 存储桶策略全部创建成功；
  - 用 SQL 自测 RLS：在 SQL Editor 中执行 `select auth.uid()`（无登录）应无法查到任何家庭数据（返回空）。

### Step 2：应用骨架
- 目标：TabBar 三页 + 路由 + 全局登录态。
- 内容：
  - 配置 pages.json：三个 Tab 页 + 全部非 Tab 页面路由 + TabBar 图标。
  - Pinia store：`useAuthStore`（session、user、家庭信息、宝宝信息，启动时 `supabase.auth.getSession()` 恢复登录态）。
  - 全局路由守卫：未登录 → login；已登录无家庭 → setup。
- 完成标准：三 Tab 可切换；未登录访问自动跳登录页。

### Step 3：登录模块
- 目标：手机号+密码注册/登录/退出。
- 内容：login 页表单；signUp（已存在则提示去登录）、signInWithPassword、退出登录。
- 完成标准：能注册、登录、退出；刷新小程序后登录态保持。

### Step 4：家庭与宝宝档案
- 目标：setup 流程（建家庭、加入家庭、建档案）+ 档案编辑页。
- 内容：
  - setup 页三态：创建家庭 / 加入家庭（邀请码）/ 建宝宝档案。
  - 生成 6 位随机邀请码（字母数字，唯一校验）。
  - baby-edit 页：编辑昵称/生日/性别/头像（头像上传到 `family_id/baby_id/avatar.jpg`）。
- 完成标准：新用户完整走通"注册→建家庭→建档案→进首页"；家人能通过邀请码加入并看到同一家庭。

### Step 5：照片时间线
- 目标：拍照上传 + 时间线列表 + 照片详情。
- 内容：
  - index 页照片流（分页 20 条、按月分组、下拉刷新）。
  - 拍照/上传：chooseMedia → compressImage → 上传 Storage → 插 baby_photos。
  - photo-detail 页：大图（signed URL）、编辑备注、删除（删记录 + 删 Storage 对象）。
- 完成标准：拍照 30 秒内出现在时间线；另一成员登录能看到同一照片；删除后列表和存储均无残留。

### Step 6：生长记录与曲线
- 目标：录入表单 + uCharts 折线图。
- 内容：growth 页表单（日期/身高/体重/头围）+ growth 页曲线（体重/身高/头围切换）+ 历史列表。
- 完成标准：录入 3 条以上数据后曲线正确绘制；切换指标正常。

### Step 7：疫苗模块
- 目标：疫苗列表 + 添加 + 标记接种 + 到期状态 + 提醒入口。
- 内容：vaccine 页（待办区 + 全部列表）、添加表单、标记已接种；"我的"页疫苗提醒区展示待接种/逾期数量。
- 完成标准：添加一条"计划日期为昨天"的疫苗 → 状态显示已逾期 → 标记接种后变已接种。

### Step 8：家庭成员管理
- 目标：家庭页（展示邀请码/复制）+ 成员列表。
- 内容：family 页；查询本家庭 members 列表；展示/复制邀请码。
- 完成标准：owner 和 member 都能看到成员列表；member 无删除成员权限（UI 隐藏）。

### Step 9：联调、自测与验收
- 目标：按第八节验收清单逐项自测，修复所有问题。
- 内容：两个微信账号（或同一账号不同手机号注册两个）分别作为 owner/member 联调；重点验证 RLS 隔离。
- 完成标准：验收清单全部通过。

---

## 八、验收清单（Agent 交付前逐项勾选）

**功能验收**
- [ ] 手机号注册/登录/退出正常，登录态刷新保持
- [ ] 创建家庭成功生成唯一邀请码；邀请码加入家庭成功
- [ ] 宝宝档案可创建、可编辑，头像可上传显示
- [ ] 照片可拍摄/上传、写备注、时间线倒序展示、按月分组、分页加载
- [ ] 照片详情可编辑备注、可删除（记录+存储对象都删干净）
- [ ] 身高/体重/头围可录入，曲线图正确绘制，可切换指标
- [ ] 疫苗可添加（含计划日期）、标记已接种、待接种/逾期状态正确
- [ ] "我的"页疫苗提醒区正确显示数量

**权限与安全验收（必须重点验证）**
- [ ] 用账号 A 创建家庭并录入数据，账号 B（不同家庭）登录后**看不到 A 的任何数据**（含照片、生长、疫苗）
- [ ] 未登录状态无法通过 API 读到任何家庭数据
- [ ] 前端代码中无 service_role 密钥
- [ ] 照片桶为 private，未经授权无法直接访问图片 URL

**体验验收**
- [ ] 拍照→出现在时间线 ≤ 30 秒
- [ ] 任一条记录操作 ≤ 2 步完成
- [ ] 无报错、无白屏、弱网有加载态

---

## 九、风险与注意事项（Agent 与用户都需知晓）

1. **RLS 是安全底线**：任何绕过 RLS 的查询（如 service_role 调用）都不允许出现在前端。如果某个查询"拿不到数据"，先检查 RLS 策略而不是图方便禁用。
2. **signed URL 有效期**：照片显示统一走 `createSignedUrl`，注意过期刷新（前端拿到 1 小时有效 URL 足够）。
3. **邀请码冲突**：生成时校验唯一，冲突则重新生成。
4. **手机号映射账号**：`{手机号}@phone.local` 方案注册时若提示邮箱已存在，说明该手机号已注册，走登录即可；前端做友好提示。
5. **婴幼儿照片是高度敏感数据**：不做任何外部分享功能；如后续做产品化，需按《儿童个人信息网络保护规定》补监护人同意与隐私政策（本期自用阶段暂不涉及对外合规，但表结构已按多租户隔离设计）。

---

## 十、给 Agent 的执行规则（必读）

1. **严格按第七节步骤顺序执行**，每步完成自测（见该步"完成标准"）后再进入下一步。
2. **执行 SQL 前先展示给用户确认**；用户确认后再在 Supabase SQL Editor 执行。
3. 遇到文档未定义、字段含义不明、或官方 API 与文档描述不一致时（如 Supabase SDK 版本差异），**停止并列出问题向用户确认**，不要自行猜测实现。
4. 密钥管理：anon key 可进前端；service_role / 数据库密码绝不进前端代码或提交到仓库。
5. 编码规范：Vue3 组合式 API；页面与组件命名清晰；注释写清"业务意图"而非翻译代码。
6. 一期交付前必须跑通"八、验收清单"全部项目，并输出验收结论。
