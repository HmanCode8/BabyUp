# 婴儿成长记录小程序：初芽（BabyUp） · 一二期补丁开发需求文档

> **文档用途**：本文件是给 AI 开发 Agent 执行的**缺陷补丁与上线前置收尾**规格说明。在二期全部验收通过后、进入三期（公开推广）之前执行。
>
> **背景**：一、二期规划时聚焦核心功能，遗漏了若干"公开上线前必须补齐"的能力（账号安全、合规、分享、运维）。本补丁只做遗漏项，**不新增业务功能**（业务扩展全部留给三期）。
>
> **前置依赖**：一期、二期均已验收通过。执行本补丁前必须先备份数据库。
>
> **项目代号**：baby-record（补丁）

---

## 一、项目概述

### 1.1 补丁目标
把产品从"能自用"提升到"能安全公开上线"的状态，补齐四类缺失：
1. **账号安全**：找回密码、账号注销、数据导出（用户权利）。
2. **合规底线**：隐私政策、用户协议、儿童信息保护声明。
3. **推广基础**：小程序分享能力（onShareAppMessage）——此前完全缺失。
4. **运维可见**：轻量埋点与错误监控、数据备份提醒、旧邀请码停用。

### 1.2 关键原则
1. **只补缺失，不加业务**：本补丁不开发任何新业务模块；三期再谈会员、AI、订阅消息。
2. **破坏性操作全部前置确认**：数据库变更 SQL、注销功能、旧邀请码清理，执行前必须先向用户展示确认。
3. **安全优先**：埋点表"只写不可读"；注销/导出逻辑放 Edge Function（service_role 只存服务端）；任何绕过 RLS 的访问都禁止。

---

## 二、补丁范围

### 2.1 本期必做（12 项）

**A 类 · 账号安全与合规（5 项）**
1. **绑定真实邮箱 + 找回密码**：手机号用户补录真实邮箱（用于收重置邮件），登录页加"忘记密码"入口。
2. **账号注销**：我的页注销入口，Edge Function 级联删除；owner 注销 = 删除整个家庭数据（二次确认）。
3. **数据导出**：Edge Function 聚合导出该家庭全部数据为 JSON，前端保存到本地。
4. **隐私政策 + 用户协议 + 儿童信息保护声明**：静态页面 + 登录页入口 + 首次登录确认。
5. **旧邀请码停用**：一期 `families.invite_code` 全部置空，加入家庭只认二期 `family_invitations`。

**B 类 · 体验与留存（5 项，低成本高价值）**
6. **宝宝月龄展示**：档案卡片/首页显示"X岁X个月X天"（1 岁内显示"X个月X天"）。
7. **照片补录时间可编辑**：照片详情页可修改拍摄时间，补传老照片不串时间线。
8. **疫苗知识库**：内置国家免疫规划常见疫苗（一类/二类），疫苗页可"从推荐库一键添加"。
9. **喂养间隔提醒**：喂养表单/今日小结显示"距上次喂养 X 小时 X 分"。
10. **空状态与新手引导**：各核心页空状态文案 + 首次进入记录页的轻引导。

**C 类 · 运维可见（2 项，轻量）**
11. **轻量埋点与错误监控**：`app_logs` 表（只写不可读）+ 全局错误捕获 + 关键事件埋点。
12. **数据备份提醒**：我的页"数据与备份"入口，展示备份指引与免费项目暂停风险提示。

### 2.2 本期明确不做
- ❌ 订阅消息推送、会员、支付、AI、分享激励裂变（全部三期）
- ❌ 便便性状/颜色参考图（需图片素材，三期补）
- ❌ 夜醒次数统计（并入三期小结增强）
- ❌ 管理后台（埋点数据用 Supabase Dashboard 直接查看即可）

### 2.3 补丁验收一句话
> 用户能找回密码、能导出自己的数据、能注销账号；登录页有隐私政策入口；小程序转发带正确的卡片和页面；旧邀请码全部失效；App 里的关键报错和事件能在数据库查到。

---

## 三、技术栈与架构决策

| 层 | 选型 | 变更说明 |
|---|---|---|
| 小程序前端 | uni-app + Vue3 + Pinia（不变） | — |
| 后端 | Supabase（不变） | 新增 2 个 Edge Function：`delete-account`、`export-data` |
| 日志存储 | 新表 `app_logs`（只写不可读） | 查看用 Supabase Dashboard / SQL |
| 疫苗数据 | 新表 `vaccine_library` + 种子数据 | 种子数据仅供录入参考，需标注免责声明 |
| 找回密码 | Supabase `resetPasswordForEmail` | 前提：用户已绑定真实邮箱 |

### 3.1 找回密码的架构说明（重要）
- **缺陷背景**：一期登录方案把手机号映射为 `{手机号}@phone.local` 假邮箱，Supabase 的重置邮件发不到真实邮箱——**纯手机号用户无法找回密码**。
- **补丁方案**：
  1. 我的页新增"账号与安全"：绑定真实邮箱（输入邮箱 → 发送验证邮件 → 用户点邮件内链接完成验证 → `profiles.email` 落库。若无独立邮箱字段，复用 `auth.users.email` 更新为真实邮箱——**注意：一期账号的 email 就是 `{手机号}@phone.local`，更新 email 会同时改变登录标识，需评估**；更稳妥：给 `profiles` 加 `recovery_email` 字段，登录逻辑不动，找回密码时用 `profiles.recovery_email`）。
  2. 登录页"忘记密码"：输入手机号 → 查 `profiles.recovery_email` → 有则 `supabase.auth.resetPasswordForEmail(recovery_email)` → 提示查收邮件；无则提示"请先在『我的-账号与安全』绑定邮箱"。
- **采用**：`profiles` 加 `recovery_email text` 字段（见 4.1），**不改 auth.users.email**，登录逻辑零影响。

### 3.2 Edge Function 约定
- `delete-account`：入参 `{ confirm: string }`（前端要求用户输入"删除"二字）→ 校验登录态 → 事务内：删除该用户为 owner 的家庭（含全部业务数据，靠外键级联）→ 删除该用户在其他家庭的 family_members 行 → 删除 profiles → 删除 auth 用户。**只能由本人触发，严禁删除他人数据。**
- `export-data`：入参 `{}` → 校验登录态 → 查该用户所属家庭 → 聚合导出：families、family_members、babies、baby_photos（含对象名，不含原图二进制）、growth_records、vaccinations、feeding_records、sleep_records、diaper_records、milestones → 返回 `{ json }`。
- 两个函数都必须：仅允许登录用户调用（Edge Function 内用 `Authorization: Bearer <user token>` 解析 `auth.uid()`，或依赖 Supabase 自动注入的 `x-caller-identity`/`request.headers`，以官方文档现状为准）；**service_role 密钥只放服务端环境变量**。

### 3.3 分享能力设计
- 全局分享：在 `App.vue` 或公共 mixin 中统一配置 `onShareAppMessage`（页面级覆盖时以页面为准），默认标题"用初芽记录宝宝每一天"，默认图用宝宝最近照片或品牌图，路径 `/pages/index/index`。
- 邀请分享：家庭页点击"分享邀请"→ 生成带参数路径 `/pages/join-family/join-family?code={code}` → `wx.shareAppMessage` 或调用分享面板。**注意：小程序分享 path 参数需要接收页在 onLoad 解析 code 并自动带出**。
- 报告分享：成长报告页保存图片后，提示用户"保存后自行转发"（三期再接入带参回流）。

---

## 四、数据库设计（补丁 SQL，可整段执行）

> 在 Supabase SQL Editor 中整段执行。执行前向用户展示确认。

```sql
-- ========== 4.1 表结构变更 ==========

-- profiles 增加真实邮箱字段（用于找回密码，不影响登录邮箱）
alter table profiles add column if not exists recovery_email text;

-- 疫苗知识库表（内置常见疫苗，仅供录入参考）
create table vaccine_library (
  id uuid primary key default gen_random_uuid(),
  name text not null,                       -- 疫苗名称（如：乙肝疫苗）
  dose text,                                -- 剂次（第1剂/第2剂...；单剂次写 '1剂'）
  min_age_month numeric(4,1) not null,      -- 建议接种月龄（最小）
  max_age_month numeric(4,1),               -- 建议接种月龄（最大，可空=不限）
  category text not null check (category in ('free','paid')),  -- free=一类(免费) paid=二类(自费)
  note text,
  sort_order integer not null default 0
);

-- 埋点/错误日志表（只写不可读：不建 select 策略，前端读不到）
create table app_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id),
  family_id uuid,                           -- 冗余，便于按家庭分析
  event_type text not null check (event_type in ('error','page_view','action')),
  event_name text not null,                 -- 如 photo_upload_fail / report_share
  payload jsonb,                            -- 附加信息（错误信息/页面路径等）
  created_at timestamptz not null default now()
);

-- ========== 4.2 索引 ==========
create index idx_vaccine_lib_category on vaccine_library(category, sort_order);
create index idx_logs_created on app_logs(created_at desc);
create index idx_logs_user on app_logs(user_id);
create index idx_logs_family on app_logs(family_id);

-- ========== 4.3 开启 RLS ==========
alter table vaccine_library enable row level security;
alter table app_logs enable row level security;

-- ========== 4.4 RLS 策略 ==========
-- vaccine_library：任何登录用户可读（公共知识库）；不可写（数据由开发者维护）
create policy vaccine_lib_select on vaccine_library for select
using (auth.uid() is not null);

-- app_logs：登录用户只能写自己的日志；不可读（查看走 Dashboard）
create policy logs_insert on app_logs for insert
with check (auth.uid() = user_id);

-- ========== 4.5 种子数据（国家免疫规划常见疫苗，仅供录入参考） ==========
-- 免责声明：以下接种月龄为常见程序参考，实际以当地接种门诊及《预防接种证》为准。
insert into vaccine_library (name, dose, min_age_month, max_age_month, category, sort_order, note) values
('乙肝疫苗',  '第1剂', 0,  0,  'free', 1,  '出生24小时内'),
('卡介苗',    '1剂',   0,  0,  'free', 2,  '出生时'),
('乙肝疫苗',  '第2剂', 1,  1,  'free', 3,  '1月龄'),
('脊灰疫苗',  '第1剂', 2,  2,  'free', 4,  '2月龄'),
('脊灰疫苗',  '第2剂', 3,  3,  'free', 5,  '3月龄'),
('百白破疫苗','第1剂', 3,  3,  'free', 6,  '3月龄'),
('百白破疫苗','第2剂', 4,  4,  'free', 7,  '4月龄'),
('脊灰疫苗',  '第3剂', 4,  4,  'free', 8,  '4月龄'),
('百白破疫苗','第3剂', 5,  5,  'free', 9,  '5月龄'),
('乙肝疫苗',  '第3剂', 6,  6,  'free', 10, '6月龄'),
('流脑A群疫苗','第1剂',6,  6,  'free', 11, '6月龄'),
('麻腮风疫苗','第1剂', 8,  8,  'free', 12, '8月龄'),
('乙脑减毒活疫苗','第1剂',8, 8, 'free', 13, '8月龄'),
('流脑A群疫苗','第2剂',9,  9,  'free', 14, '9月龄'),
('甲肝减毒活疫苗','1剂',18, 18, 'free', 15, '18月龄'),
('百白破疫苗','第4剂', 18, 18, 'free', 16, '18月龄'),
('麻腮风疫苗','第2剂', 18, 18, 'free', 17, '18月龄'),
('乙脑减毒活疫苗','第2剂',24, 24, 'free', 18, '2岁'),
('流脑A+C群疫苗','第1剂',36, 36, 'free', 19, '3岁'),
('脊灰疫苗',  '第4剂', 48, 48, 'free', 20, '4岁'),
('流脑A+C群疫苗','第2剂',72, 72, 'free', 21, '6岁'),
('白破疫苗',  '1剂',   72, 72, 'free', 22, '6岁');

-- ========== 4.6 旧邀请码停用（破坏性操作，执行前确认） ==========
-- 一期 families.invite_code 永久有效，存在安全隐患；置空停用。
-- 加入家庭逻辑二期已改为只查 family_invitations，确认前端无其它引用。
update families set invite_code = null where invite_code is not null;
```

### 4.7 数据流约定
- **找回密码**：前端输入手机号 → 查 `profiles.recovery_email`（按 user_id 关联 family_members → auth 用户）→ 有邮箱则 `supabase.auth.resetPasswordForEmail(该邮箱)` → toast"重置链接已发送，请查收邮件"；无邮箱 → 提示先绑定。
- **绑定邮箱**：我的页输入邮箱 → `supabase.auth.updateUser({ email: 新邮箱 })` 会触发二次验证邮件，**但会改变登录邮箱**——本补丁不采用；改为：先校验邮箱格式 → 调 Edge Function `send-recovery-binding` 发送一次性绑定验证码（或复用 `resetPasswordForEmail` 流程的变体）→ 用户输入验证码 → 更新 `profiles.recovery_email`。**若实现复杂度高，最小可用版：直接要求用户输入"能收到邮件的真实邮箱"并保存到 `profiles.recovery_email`（不做邮箱真实性验证，风险提示：填错将收不到重置邮件），并在 UI 明确提示。实现取舍以"能跑通、不破坏登录"为准，遇到歧义停下来问用户。**
- **埋点**：前端 `utils/tracker.js` 提供 `track(eventType, eventName, payload)` → `supabase.from('app_logs').insert({ user_id, family_id, event_type, event_name, payload })`；**所有埋点调用 try/catch 静默失败，绝不影响业务**。全局错误：`App.onError`、页面 `onError` 钩子统一上报 `track('error','global_error',{msg, stack})`。
- **导出**：Edge Function 返回 `{ json: '...' }`（字符串）→ 前端 `wx.getFileSystemManager().writeFile` 写入 `wx.env.USER_DATA_PATH + '/baby-export.json'` → `wx.openDocument` 预览 → 提示用户可用"文件传输助手"发送到电脑保存。
- **月龄计算**：`utils/age.js` 提供 `formatAge(birthday, now)`：不足 1 岁 → "X个月X天"；满 1 岁 → "X岁X个月X天"；跨月按自然月天数差精确计算（用日期运算，不用 30 天近似）。

---

## 五、页面结构（修改与新增）

```
新增页面：
├── pages/privacy/privacy              ← 隐私政策（静态内容）
├── pages/terms/terms                  ← 用户协议（静态内容）
├── pages/forgot-password/forgot-password  ← 忘记密码（输入手机号→走邮箱重置）
└── pages/account/account              ← 账号与安全（绑定邮箱 / 导出数据 / 注销入口）
     （也可并入"我的"页作为分区，二选一，以结构简单为准）

修改页面：
├── pages/login/login                  ← 加"忘记密码"链接 + 底部"隐私政策/用户协议"链接
├── pages/photo-detail/photo-detail    ← 加"编辑拍摄时间"（taken_at 可改）
├── pages/vaccine/vaccine              ← 加"从推荐库添加"入口（按类别/月龄浏览，一键添加）
├── pages/record/record                ← 顶部小结加"距上次喂养"；空状态引导文案
├── pages/index/index                  ← 空状态引导；宝宝月龄展示（档案卡）
├── pages/profile/profile              ← 加"账号与安全""数据与备份""关于与法律"入口
├── pages/family/family                ← 加"分享邀请"按钮（带参 path）
└── pages/milestone/milestone 等空态页 ← 统一空状态文案
```

### 5.1 关键页面要点
- **隐私政策/用户协议内容结构（Agent 起草，交用户确认后上线）**：① 我们收集哪些信息（手机号/邮箱/宝宝档案/照片/健康记录）；② 信息用途（记录展示、账号服务）；③ 存储与安全（Supabase 云存储、RLS 隔离）；④ 儿童信息保护（监护人同意、最小化收集、监护人权利：查询/更正/删除/导出）；⑤ 数据导出与注销方式；⑥ 联系方式。**禁止编造监管机关备案号、不得虚构客服电话；内容须人工复核。**
- **账号与安全页**：绑定邮箱区（输入+保存）、导出数据按钮（调 Edge Function → 下载）、注销账号区（红色警示，点击后二次弹窗要求输入"删除"确认 → 调 `delete-account` → 退出登录）。
- **疫苗知识库交互**：疫苗页"从推荐库添加"→ 列表按类别 tab（一类/二类）→ 每行显示名称/剂次/建议月龄/类别标签 → 点击"添加"→ 弹表单（可改接种日期/计划日期，默认按当前月龄推荐）→ 插入 `vaccinations`（复制 vaccine_library 的名称/剂次字段）。
- **分享**：所有页面统一走公共 mixin 的 `onShareAppMessage`；家庭页覆盖为带 code 的邀请路径；接收页 `onLoad(options)` 解析 `options.code` 自动进入"确认加入"流程（复用二期 join-family 逻辑）。

---

## 六、核心交互流程（用户故事）

### 流程 1：绑定邮箱并找回密码
1. 我的页 → 账号与安全 → 绑定邮箱 → 输入真实邮箱 → 保存 → `profiles.recovery_email` 更新。
2. 登录页点"忘记密码" → 输入手机号 → 系统查 recovery_email → 发送重置邮件。
3. 用户打开邮件 → 点重置链接 → 设置新密码 → 用手机号+新密码登录成功。
4. 未绑定邮箱的用户 → 提示"请先绑定邮箱"并引导到账号与安全页。

### 流程 2：导出数据
1. 我的页 → 数据与备份 → 点"导出全部数据" → 确认弹窗（说明导出含宝宝档案/照片清单/全部记录）。
2. 调 Edge Function `export-data` → 生成 JSON → 前端写入本地文件 → `wx.openDocument` 打开预览。
3. 用户点"发送给朋友/文件传输助手"把 JSON 存到电脑备份。
4. 失败兜底：导出失败 toast"请稍后重试"。

### 流程 3：注销账号（破坏性，双确认）
1. 我的页 → 账号与安全 → 注销账号 → 弹窗一（说明后果：作为创建者将删除整个家庭及全部照片/记录，不可恢复）。
2. 弹窗二：输入"删除"二字 → 按钮变可点 → 调 Edge Function `delete-account`。
3. 成功后清除本地 session → 跳登录页。失败（非本人/未确认）提示。

### 流程 4：分享小程序
1. 用户在任何页面点右上角"..."→ 转发 → 卡片显示"用初芽记录宝宝每一天"+ 最近照片。
2. 家庭页点"分享邀请" → 生成带 `?code=xxx` 的邀请 path → 转发到家族群。
3. 好友点开卡片 → 进入 join-family 页 → 自动带出邀请码 → 走加入流程。

### 流程 5：从疫苗库添加疫苗
1. 疫苗页点"从推荐库添加" → 默认选中与当前宝宝月龄匹配的疫苗（min_age_month ≤ 月龄 ≤ max_age_month）高亮。
2. 用户点某条"添加" → 预填名称/剂次/计划日期（按推荐月龄推算）→ 可改 → 保存 → 插入 vaccinations。
3. 页面底部免责声明："接种程序以当地接种门诊及《预防接种证》为准"。

### 流程 6：补录照片时间
1. 照片详情页点"编辑" → 修改拍摄时间（默认当前值）→ 保存 → 更新 taken_at。
2. 返回时光页 → 照片按新时间重新排序。

---

## 七、分步开发计划（Agent 按此顺序执行）

### Step 0：环境确认与备份
- 确认一、二期验收全部通过；Supabase SQL Editor 可用；Edge Function 可部署。
- **执行数据库备份**（Supabase Dashboard → Database → Backups 手动备份，或导出 SQL）。
- 完成标准：备份完成，记录备份时间。

### Step 1：数据库补丁
- 执行第四节 SQL（4.1~4.6）全部语句，逐条核对无报错。
- 确认：`families.invite_code` 已全部置空；vaccine_library 种子 22 条；app_logs 可 insert。
- **执行前必须向用户展示并确认**（含旧邀请码停用）。
- 完成标准：SQL 无报错；`select count(*) from vaccine_library` = 22。

### Step 2：账号安全（绑定邮箱 + 找回密码）
- profiles 加 recovery_email（SQL 已含）；我的页账号与安全 UI；绑定邮箱保存逻辑；登录页忘记密码入口 + 流程。
- 完成标准：绑定邮箱成功写入；忘记密码对已绑邮箱用户发送重置邮件（可先本地验证调用不报错；真实邮件送达依赖 Supabase SMTP，若未配置则记录为已知限制并告知用户）；未绑定用户提示引导正确。

### Step 3：注销与导出（Edge Function）
- 创建并部署 `delete-account`、`export-data`；前端账号与安全页接入；双确认注销；导出文件下载打开。
- 完成标准：测试账号（临时建的家庭）注销后，Dashboard 中该家庭全部数据消失；导出 JSON 打开后包含全部 6+4 类记录；非 owner 成员注销只移除自己、不动家庭。
- **用测试账号验证，严禁在真实家庭数据上直接测删除。**

### Step 4：分享能力
- 公共 mixin 全局 onShareAppMessage；家庭页邀请分享带参；join-family 解析 code 自动带出。
- 完成标准：转发卡片标题/图片正确；好友点开进入 join-family 且邀请码已带出；普通页面分享路径正确。

### Step 5：体验补丁（月龄/照片时间/喂养间隔/空状态）
- utils/age.js + 档案卡月龄展示；photo-detail 编辑 taken_at；record 页"距上次喂养"；各空态文案 + 首次引导气泡。
- 完成标准：跨月跨年年龄计算正确；改时间后时间线重排；无记录时各页显示引导文案。

### Step 6：疫苗知识库
- vaccine 页"从推荐库添加"入口 + 类别 tab + 月龄匹配高亮 + 一键添加。
- 完成标准：能浏览、筛选、添加；添加后出现在疫苗列表并可标记接种。

### Step 7：埋点与错误监控
- utils/tracker.js；App/页面 onError 上报；关键事件埋点（注册成功/创建家庭/首次记录/报告生成/分享）。
- 完成标准：埋点调用不报错、不影响业务；Dashboard 执行 `select * from app_logs order by created_at desc limit 20` 能看到记录；前端读 app_logs 被 RLS 拒绝。

### Step 8：联调与验收
- 按第八节验收清单逐项自测；用两个账号（owner/member/viewer）回归权限。
- 完成标准：验收清单全部通过。

---

## 八、验收清单（Agent 交付前逐项勾选）

**账号安全**
- [ ] 绑定真实邮箱成功写入 profiles.recovery_email，不改变登录手机号/邮箱
- [ ] 忘记密码：已绑定邮箱用户收到重置邮件并可重置成功；未绑定用户得到引导提示
- [ ] 注销：owner 注销删除整个家庭数据（用测试家庭验证）；member 注销仅移除自己
- [ ] 注销需双重确认（含输入"删除"）

**数据导出**
- [ ] 导出 JSON 文件可下载并打开，包含宝宝档案、照片清单、生长/疫苗/喂养/睡眠/便便/里程碑全部记录
- [ ] 导出仅限本人家庭数据，无越权

**合规**
- [ ] 隐私政策/用户协议/儿童信息保护声明页面可访问，登录页有入口
- [ ] 内容已由用户人工确认（未虚构备案号/联系方式）

**分享**
- [ ] 所有页面转发卡片正常（标题/图片/路径）
- [ ] 家庭页邀请分享带 code，接收页自动带出并完成加入流程

**体验**
- [ ] 月龄展示跨月/跨年正确（0岁11个月30天→1岁0个月0天边界）
- [ ] 照片拍摄时间可编辑，时间线正确重排
- [ ] 疫苗库可浏览/筛选/一键添加，免责声明可见
- [ ] 喂养间隔显示正确（无记录时隐藏）
- [ ] 各核心页空状态与首次引导正常

**安全与运维**
- [ ] app_logs 前端不可读（RLS），只可写；埋点不影响业务
- [ ] 旧邀请码全部失效（families.invite_code 为空，旧码加入被拒）
- [ ] 前端无 service_role / AppSecret
- [ ] 注销/导出 Edge Function 校验登录态与归属

---

## 九、风险与注意事项（Agent 与用户都需知晓）

1. **找回密码的固有缺陷**：一期假邮箱方案决定了"纯手机号用户无法自助找回"，补丁方案（绑定 recovery_email）是缓解而非根治；根治需三期微信登录（微信身份可重置密码）。文档如实告知用户。
2. **疫苗种子数据**：仅作录入参考，接种程序各地区有差异，必须保留免责声明；不提供"自动提醒打疫苗"的医学建议。
3. **注销的破坏性**：owner 注销 = 家庭全部数据（含所有成员共享的照片记录）一并删除，前端文案必须显著说明；验证只允许用测试家庭。
4. **埋点数据含个人信息**（user_id/family_id/页面路径）：app_logs 前端不可读，查看仅限 Dashboard；payload 内不记录照片 URL、聊天内容等敏感字段。
5. **Supabase 邮件服务**：重置邮件需要项目启用 SMTP（Dashboard → Authentication → SMTP）。若未配置，找回密码的"发信"环节无法真实送达，执行时如实检查并告知用户，不要假装成功。
6. **分享带参**：小程序分享 path 参数长度有限制，code 为 6 位安全；解析 code 失败时回退到手动输入邀请码。

---

## 十、给 Agent 的执行规则（必读）

1. **先备份再动手**：Step 0 备份未完成前不执行任何 SQL。
2. **SQL 与 Edge Function 部署前先展示给用户确认**；`families.invite_code` 置空属破坏性操作，必须单独确认。
3. **注销功能用测试账号验证**，严禁在真实家庭数据上直接测试删除路径。
4. 遇到文档未定义、字段含义不明、或官方 API 与文档描述不一致时（尤其 Edge Function 获取当前用户、resetPasswordForEmail 行为），**停止并列出问题向用户确认**，不要自行猜测实现。
5. 密钥管理：anon key 可进前端；service_role / AppSecret / 数据库密码绝不进前端代码或提交到仓库。
6. 埋点、导出、注销的调用全部 try/catch 静默降级，绝不因埋点失败影响主流程。
7. 编码规范延续一、二期：Vue3 组合式 API；注释写清"业务意图"。
8. 交付前必须跑通"八、验收清单"全部项目，输出验收结论；已知限制（如 SMTP 未配置）如实列出，不隐藏。
