# 婴儿成长记录小程序：初芽（BabyUp） · 第三期开发需求文档

> **文档用途**：本文件是给 AI 开发 Agent 执行的第三期开发规格说明。**前置条件**：一期、二期、补丁全部验收通过（含隐私政策、注销、导出、分享、埋点等上线前置项已就绪）。Agent 按"七、分步开发计划"从 Step 0 开始逐步实现，每步完成自测后再进入下一步；遇到文档未覆盖或存在歧义的地方，列出问题向用户确认，禁止自行假设。
>
> **项目代号**：baby-record（三期）

---

## 一、项目概述

### 1.1 背景
- 一、二期 + 补丁后，产品已具备：核心记录闭环、家庭权限体系、微信登录、成长报告、合规前置（隐私政策/注销/导出/埋点）。
- 第三期目标：**公开上线并商业化**——把"自用工具"变成"能上线、能获客、能收钱"的完整产品。
- 三个关键词：**合规上线 → 裂变获客 → 会员变现**，AI 助手作为差异化竞争力。

### 1.2 产品定位
- 从"家庭私密记录工具"升级为"**可公开运营的母婴成长 SaaS**"：免费版养用户，会员版赚钱，AI 和报告建立口碑。

### 1.3 关键设计原则
1. **商业化不破坏体验**：免费版功能完整可用（1 宝宝 + 1GB + 基础记录），会员只解锁"多宝宝/大容量/高级输出"，绝不做"免费版记不了记录"这种逼氪设计。
2. **一切涉及钱和用户资产的逻辑放 Edge Function**：下单、回调验签、发放会员、AI 额度扣减、邀请奖励，全部服务端完成；前端只展示结果。
3. **订阅消息认清微信限制**：微信订阅消息为"一次性订阅"，只能做关键节点提醒，不承诺持续推送（见 3.4）。
4. **AI 可控成本**：用自己的模型账号（火山方舟/豆包），key 只放服务端，免费额度 + 会员额度 + 服务端限流三层控制。
5. **合规红线**：支付信息、订阅消息、AI 对话均涉及个人信息与儿童数据，隐私政策需在三期同步更新。

---

## 二、第三期范围

### 2.1 P0 本期必做（8 项，做完即可公开推广）
1. **会员订阅体系**：免费版/会员版权益矩阵；我的页会员中心。
2. **微信支付接入**：下单、JSAPI 支付、回调验签、会员发放、订单查询。
3. **照片容量管理**：用量统计、免费/会员配额、超限拦截、扩容引导。
4. **订阅消息推送**：疫苗/儿保/自定义提醒真正推送到微信（一次性订阅策略）。
5. **日报分享卡**：每日小结一键生成分享图（带小程序码，回流获客）。
6. **邀请有礼裂变**：邀请好友建家庭 → 双方获得会员天数奖励。
7. **用户反馈**：反馈表单（我的页入口），数据入 `feedback` 表。
8. **AI 育儿助手**：对话页 + Edge Function 代理模型 + 免费/会员额度 + 医疗免责。

### 2.2 P1 竞争力（看精力，可分批）
9. **儿保体检管理**：体检记录 + 建议下次日期 + WHO 百分位评估。
10. **生病/用药记录**：症状、用药、过敏史。
11. **年度成长报告**：跨年总结（照片+数据+里程碑），分享图。
12. **宝宝主页（在线只读分享）**：签名 token 链接，脱敏展示。

### 2.3 P2 探索变现（三期不做，仅记录方向）
- ❌ 成长册实体打印（对接第三方印刷服务）
- ❌ 母婴好物 CPS 推荐
- ❌ AI 相册/成长故事自动生成

### 2.4 三期验收一句话
> 新用户免费注册 → 记录 1 个月 → 收到疫苗订阅消息 → 月底生成日报分享到家族群 → 好友通过分享/邀请码加入 → 照片超 1GB 或想要多宝宝/年度报告 → 付费成会员 → 支付成功自动开通 → AI 助手解答疑问（额度内）→ 全程数据隔离与合规文案完整。

---

## 三、技术栈与架构决策

### 3.1 技术选型（延续，新增外部服务）

| 层 | 选型 | 说明 |
|---|---|---|
| 小程序前端 | uni-app + Vue3 + Pinia（不变） | — |
| 后端 | Supabase：Auth/Postgres/RLS/Storage/Edge Function | Edge Function 增至 6+ 个 |
| 支付 | **微信支付（商户号）API v3** | 个体户可申请；回调验签必须 |
| 推送 | **微信订阅消息**（一次性订阅） | 模板在 mp 后台申请 |
| AI | **火山方舟/豆包 API**（用户自己的模型账号） | key 只放服务端 |
| 定时任务 | Supabase Scheduled Functions / pg_cron | 用于提醒检查（以官方现状为准） |

### 3.2 会员权益矩阵（示例定价，用户可调）

| 权益 | 免费版 | 会员版（示例：15 元/月，98 元/年） |
|---|---|---|
| 宝宝数量 | 1 个 | 不限 |
| 照片空间 | 1GB | 20GB |
| 基础记录（喂养/睡眠/便便/生长/疫苗/里程碑） | ✅ | ✅ |
| 月度成长报告 | ✅ | ✅ |
| 日报分享卡 | ❌ | ✅ |
| 年度成长报告 | ❌ | ✅ |
| AI 育儿助手 | 每日 3 次 | 每月 300 次 |
| 高级报告模板 | ❌ | ✅ |
| 数据导出 | ✅（法定权利，不锁） | ✅ |
| 家庭共享 | ✅（成员共享会员状态） | ✅ |

- **计费单位：按家庭（family_id）**，家庭成员共享会员；文档/UI 明确"一个家庭一份会员"。
- 定价为示例值，上线前由用户最终确认；代码中套餐常量集中管理（`plans` 常量，避免散落）。

### 3.3 微信支付流程（重点，安全底线）

```
前端                         Edge Function                    微信支付平台
───                          ──────────────                    ──────────
选套餐(月/年)
  → POST /create-order      1. 校验登录+套餐；生成订单号
   {plan}                  2. service_role 调微信支付 v3
                              JSAPI 下单（appid/商户号/openid）
  ← {payment 参数}          3. 订单落库 status=pending
wx.requestPayment(payment)  → 用户付款
                              ── 回调 notify ──►  POST /payment-callback
                                                   （微信服务器 → Edge Function）
                              4. 验签（v3 签名 + 解密）→ 校验金额/商户号/订单号
                              5. 更新 orders=paid → 发放 memberships
                              → 返回 200/FAIL
前端轮询 GET /order-status  ← {paid} → 刷新会员态
```

**实现要点（Agent 必读）**：
1. **下单**：Edge Function `create-order`：入参 `{ plan }` → 查套餐常量 → 调微信支付 API v3 `POST /v3/pay/transactions/jsapi`（参数：appid、mchid、description、out_trade_no、amount.total、payer.openid（从小程序登录态取 openid，需在登录时保存 profiles.wechat_openid）、notify_url）→ 返回 `prepay_id` → 前端 `wx.requestPayment` 所需参数（timeStamp/nonceStr/package=prepay_id/signType/RSA）→ 前端签名用商户私钥在 **Edge Function 内完成**（`wx.requestPayment` 的 paySign 由服务端生成，前端不做签名）。
2. **回调**：Edge Function `payment-callback`：接收微信通知 → **必须验签**（微信支付 v3 用微信支付平台证书验签 + AES-256-GCM 解密 resource）→ 校验 out_trade_no 与金额 → 幂等处理（同一单重复回调只发一次权益）→ 更新订单 → 更新/创建 `memberships` → 返回 `{ code: "SUCCESS" }`（失败返回非 200 让微信重试）。
3. **密钥**：商户号、API v3 Key、商户私钥、商户证书序列号全部环境变量（`WXPAY_MCHID`、`WXPAY_API_V3_KEY`、`WXPAY_PRIVATE_KEY`、`WXPAY_SERIAL_NO`），**严禁进前端**。
4. **测试**：微信支付支持沙箱环境（特约商户沙箱，官方文档为准）；若沙箱不可用，用真实小额支付测试（1 元档测试套餐或退款）。
5. **前端订单状态**：支付完成后轮询 `order-status`（3 次/2 秒），不轮询也允许用户手动刷新；超时提示"支付结果确认中，稍后刷新"。

### 3.4 订阅消息设计（认清限制）
- **微信限制**：订阅消息为"一次性订阅"——用户每次 `wx.requestSubscribeMessage` 授权，只能对该用户发送 1 条该模板消息；**无法做长期持续推送**。
- **策略**：
  1. 用户在小程序内点"开启提醒"→ 批量 `wx.requestSubscribeMessage` 请求多个模板授权（疫苗提醒/喂养提醒/儿保提醒）→ 授权结果存 `message_tokens`（计数，每授权 1 次 = 可发 1 条）。
  2. 发送侧：定时任务（Supabase Scheduled Functions 或 pg_cron，以官方现状为准）周期触发 Edge Function `send-reminders` → 查询待发送提醒（疫苗到期/自定义提醒到期）→ 对目标用户扣减 token → 调微信订阅消息 API（`POST /cgi-bin/message/subscribe/send`，需 access_token：appid+secret 换，缓存 2 小时）→ 写 `message_logs`。
  3. **库存意识**：token 不足的提醒顺延/降级为站内红点（复用一期疫苗提醒区），UI 文案说明"微信提醒次数有限，站内始终可见"。
- **模板**：在 mp.weixin.qq.com 申请模板（如"疫苗接种提醒""宝宝日常提醒"），模板 ID 填环境变量/配置表。

### 3.5 AI 育儿助手设计
- Edge Function `ai-chat`：入参 `{ message }` → 校验登录 + 额度 → 组装上下文（宝宝月龄、近 7 天喂养/睡眠/生长摘要、用户问题）→ 调火山方舟/豆包 Chat API（HTTP，key 环境变量）→ 流式或一次性返回 → **扣减额度**（membership 字段或计数表）。
- **额度控制**：免费用户每日 3 次（按 user_id 当日计数）；会员每月 300 次（按 family_id 月度计数）；超限返回友好提示"今日免费次数已用完，开通会员解锁更多"。**限流在 Edge Function 内做，前端按钮隐藏只是体验层。**
- **System Prompt 硬约束**：① 定位为"育儿记录助理"，基于用户记录数据回答，不编造；② 涉及症状/用药/发育异常时，必须提示"建议咨询儿科医生，本回答不能替代医疗诊断"；③ 不回答处方、剂量建议；④ 不承诺医疗效果。
- **成本**：按 token 计费（以所选模型官方价格为准，估算：正常家庭月问答量费用极低，通常在几元以内；此为本项目的粗略估算，上线后按实际账单监控）。
- 上下文隐私：对话内容只用于生成回复，不用于模型训练（API 配置关闭训练选项，以服务商设置为准）。

### 3.6 容量管理
- 用量 = 该 family 下 storage 桶 `baby-photos` 内全部对象大小之和。
- 实现：Edge Function `check-quota`：统计用量 + 查会员 → 返回 `{ used_bytes, quota_bytes, plan }`；上传前前端调用校验，超限弹"扩容引导"（跳会员中心）。
- 统计性能：对象多时遍历慢，MVP 接受；后续可加用量缓存表（三期不实现，留说明）。
- 免费 1GB / 会员 20GB 为配置常量，集中管理。

### 3.7 宝宝主页（P1，在线只读分享）
- 生成：Edge Function `create-share-link`：校验 owner/member → 生成 `token = HMAC(family_id+baby_id+expiry, 服务端密钥)` → 返回 `/pages/baby-share/baby-share?token=xxx`。
- 读取：分享页带 token 调 Edge Function `get-share-page` → 验 token + 有效期 → 返回**脱敏数据**（宝宝昵称首字+照片缩略图 9 张+里程碑名称列表+月龄；**不含**健康明细、家族成员、联系方式）。
- 安全：token 不可逆推、有过期时间、可撤销（owner 在分享管理页作废）。

---

## 四、数据库设计（三期 SQL，可整段执行）

> 在 Supabase SQL Editor 中整段执行。执行前向用户展示确认。

```sql
-- ========== 4.1 新增表 ==========

-- 家庭会员表（按家庭计费，成员共享）
create table memberships (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null unique references families(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free','monthly','yearly')),
  started_at timestamptz,
  expires_at timestamptz,              -- 空 = 免费版（无到期概念）
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 订单表（微信支付订单）
create table orders (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  user_id uuid not null references auth.users(id),
  plan text not null check (plan in ('monthly','yearly')),
  amount_cents integer not null,       -- 金额（分）
  out_trade_no text not null unique,   -- 商户订单号
  wx_transaction_id text,              -- 微信支付单号
  status text not null default 'pending' check (status in ('pending','paid','failed','refunded')),
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

-- 邀请奖励记录
create table invite_rewards (
  id uuid primary key default gen_random_uuid(),
  inviter_family_id uuid not null references families(id) on delete cascade,
  inviter_user_id uuid not null references auth.users(id),
  invitee_user_id uuid not null references auth.users(id),
  reward_days integer not null,        -- 奖励会员天数（双方各得）
  status text not null default 'pending' check (status in ('pending','granted','failed')),
  created_at timestamptz not null default now()
);

-- 提醒任务表（订阅消息发送目标）
create table reminders (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  baby_id uuid references babies(id) on delete cascade,
  created_by uuid references auth.users(id),
  title text not null,
  remind_type text not null check (remind_type in ('vaccine','feeding','checkup','custom')),
  remind_at timestamptz not null,
  repeat_type text not null default 'once' check (repeat_type in ('once','daily')),
  template_id text,                    -- 微信订阅消息模板 ID
  status text not null default 'pending' check (status in ('pending','sent','cancelled')),
  sent_at timestamptz,
  created_at timestamptz not null default now()
);

-- 订阅消息授权库存表（每授权一次可发一条）
create table message_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  family_id uuid not null references families(id) on delete cascade,
  template_id text not null,           -- 对应哪个模板
  count integer not null default 0,    -- 可用发送次数
  updated_at timestamptz not null default now(),
  unique (user_id, template_id)
);

-- 消息发送日志
create table message_logs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id),
  family_id uuid not null references families(id) on delete cascade,
  remind_id uuid references reminders(id),
  template_id text,
  status text not null check (status in ('sent','fail')),
  error text,
  created_at timestamptz not null default now()
);

-- 用户反馈表
create table feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  family_id uuid references families(id) on delete set null,
  content text not null,
  contact text,                        -- 联系方式（可选）
  status text not null default 'new' check (status in ('new','read','done')),
  created_at timestamptz not null default now()
);

-- AI 使用额度表（免费按日 / 会员按月；服务端计数，防止客户端绕过）
create table ai_usage (
  id bigint generated always as identity primary key,
  scope text not null check (scope in ('user','family')),
  owner_id uuid not null,              -- user_id 或 family_id
  period text not null,                -- 'YYYY-MM-DD'（日）或 'YYYY-MM'（月）
  count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (scope, owner_id, period)
);

-- ========== 4.2 一期表变更 ==========
-- profiles 增加微信 openid 已在二期存在；本期末端展示会员用不到新字段。
-- （若需记录"最后一次订阅授权时间"等运营字段，三期 P1 再追加，本期不扩展）

-- ========== 4.3 索引 ==========
create index idx_memberships_family on memberships(family_id);
create index idx_orders_family on orders(family_id, created_at desc);
create index idx_orders_out_trade_no on orders(out_trade_no);
create index idx_reminders_family_status on reminders(family_id, status, remind_at);
create index idx_message_logs_family on message_logs(family_id, created_at desc);
create index idx_feedback_status on feedback(status, created_at desc);
create index idx_ai_usage_scope on ai_usage(scope, owner_id, period);

-- ========== 4.4 开启 RLS ==========
alter table memberships    enable row level security;
alter table orders         enable row level security;
alter table invite_rewards enable row level security;
alter table reminders      enable row level security;
alter table message_tokens enable row level security;
alter table message_logs   enable row level security;
alter table feedback       enable row level security;
alter table ai_usage       enable row level security;

-- ========== 4.5 RLS 策略 ==========
-- 通用：本家庭 active 成员可读；写操作（除 feedback 外）一律走 Edge Function，
-- 前端不直接写订单/会员/奖励/额度类表。

-- memberships：本家庭 active 成员可读（会员状态展示用）
create policy memberships_select on memberships for select
using (exists (select 1 from family_members fm
              where fm.family_id = memberships.family_id
                and fm.user_id = auth.uid() and fm.status = 'active'));

-- orders：本家庭 active 成员可读自己家庭的订单；写入仅服务端（无 insert 策略=前端不可写）
create policy orders_select on orders for select
using (exists (select 1 from family_members fm
              where fm.family_id = orders.family_id
                and fm.user_id = auth.uid() and fm.status = 'active'));

-- invite_rewards：本家庭 active 成员可读；写入仅服务端
create policy invite_rewards_select on invite_rewards for select
using (exists (select 1 from family_members fm
              where fm.family_id = invite_rewards.inviter_family_id
                and fm.user_id = auth.uid() and fm.status = 'active'));

-- reminders：本家庭 active 成员可读；成员(非viewer)可写
create policy reminders_select on reminders for select
using (exists (select 1 from family_members fm
              where fm.family_id = reminders.family_id
                and fm.user_id = auth.uid() and fm.status = 'active'));
create policy reminders_insert on reminders for insert
with check (exists (select 1 from family_members fm
                    where fm.family_id = reminders.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'
                      and fm.role != 'viewer'));
create policy reminders_update on reminders for update
using (exists (select 1 from family_members fm
               where fm.family_id = reminders.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));
create policy reminders_delete on reminders for delete
using (exists (select 1 from family_members fm
               where fm.family_id = reminders.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));

-- message_tokens / message_logs：本家庭 active 成员可读（展示剩余次数）；写入仅服务端
create policy message_tokens_select on message_tokens for select
using (exists (select 1 from family_members fm
              where fm.family_id = message_tokens.family_id
                and fm.user_id = auth.uid() and fm.status = 'active'));
create policy message_logs_select on message_logs for select
using (exists (select 1 from family_members fm
              where fm.family_id = message_logs.family_id
                and fm.user_id = auth.uid() and fm.status = 'active'));

-- feedback：用户写自己的反馈；写后不可改；读取仅服务端（前端不读他人反馈）
create policy feedback_insert on feedback for insert
with check (auth.uid() = user_id);

-- ai_usage：前端不可读不可写（额度判断全部走 Edge Function）
-- 注意：无任何 select/insert 策略 → RLS 默认拒绝前端访问

-- ========== 4.6 初始化 ==========
-- 为既有家庭补 memberships（免费版）
insert into memberships (family_id)
select f.id from families f
left join memberships m on m.family_id = f.id
where m.id is null;

-- 新家庭创建时自动带免费会员：由 setup 流程（前端）在创建家庭后插入 memberships(family_id)。
```

### 4.7 数据流约定
- **会员判断（前端）**：启动时查 `memberships`（按 family_id）→ store 存 `myMembership`；`expires_at < now` 视为免费版（Edge Function 判断同理，前端仅展示）。
- **额度扣减（AI）**：Edge Function 内事务：`select ... for update` ai_usage → 计数+1 → 超限返回 429 语义错误码。免费=scope 'user' + period 'YYYY-MM-DD'；会员=scope 'family' + period 'YYYY-MM'。
- **提醒任务**：`reminders` 到点后由定时任务捞取（status='pending' and remind_at <= now()）→ 检查 message_tokens → 有 token 则发送并扣减、写 message_logs、reminders 置 sent；无 token 则 reminders 置 cancelled（或顺延，文档采用置 cancelled + 站内红点替代）。
- **邀请有礼**：邀请路径 `join-family?code=xxx&inviter=<family_id>` → 新用户加入成功（成为 active member）→ Edge Function `grant-invite-reward`：校验邀请人家庭存在 → 双方各 +7 天会员（邀请人家庭 membership 顺延 7 天；被邀请人所在新家庭若已是会员则顺延，否则开通 7 天免费体验）→ 写 invite_rewards（防重复：invitee 唯一）。
- **日报分享卡**：复用二期 report 页 canvas 逻辑，改为"今日数据"卡片（含今日统计 + 当日照片 + 小程序码）。小程序码：调微信 `getwxacodeunlimit`（access_token，服务端）生成带参小程序码图片，Edge Function 返回图片 URL，canvas 合成时绘制。

---

## 五、页面结构与信息架构

### 5.1 页面清单（三期新增 8 页 + 修改 6 页，TabBar 不变）

```
新增页面：
├── pages/member/member                ← 会员中心（权益对比/套餐选择/支付入口）
├── pages/pay-result/pay-result        ← 支付结果（成功/失败/确认中）
├── pages/feedback/feedback            ← 用户反馈表单
├── pages/ai-chat/ai-chat              ← AI 育儿助手（对话页）
├── pages/checkup/checkup              ← 儿保体检列表（P1）
├── pages/checkup-edit/checkup-edit    ← 体检记录表单（P1）
├── pages/health/health                ← 生病/用药记录列表（P1）
├── pages/health-edit/health-edit      ← 记录表单（P1）
└── pages/baby-share/baby-share        ← 宝宝主页（在线只读分享，P1，token 鉴权）

修改页面：
├── pages/profile/profile              ← 加会员中心入口（含容量进度条）、AI 入口、反馈入口
├── pages/record/record                ← 小结卡片加"生成日报分享图"按钮（会员可见）
├── pages/vaccine/vaccine              ← 加"开启微信提醒"（订阅授权）入口
├── pages/family/family                ← 加"邀请有礼"分享（带 inviter 参数）
├── pages/setup/setup                  ← 创建家庭后补插 memberships(free)
└── pages/login/login                  ← 隐私政策入口（补丁已做，确认保留）
```

### 5.2 关键页面职责与要点
- **会员中心（member）**：
  - 顶部当前状态：免费版/会员版 + 到期时间。
  - 权益对比表（免费 vs 会员，见 3.2）；容量进度条（用量/配额）。
  - 套餐卡片（月卡 15 元 / 年卡 98 元，示例价）→ 点购买 → create-order → wx.requestPayment → 跳 pay-result。
  - 已支付过、进行中订单显示状态（轮询 order-status）。
- **AI 对话页（ai-chat）**：输入框 + 消息列表；顶部显示"今日剩余次数/会员剩余次数"；点击示例问题快捷输入；长回复支持复制；底部固定免责声明"AI 内容仅供参考，不能替代医生诊断"；额度用尽显示开通引导卡片。
- **日报分享（record 页按钮）**：会员可见可点；免费版点击 → 弹会员引导（不弹支付，只说明权益）。生成流程复用 report 页 canvas 能力，输出今日卡片（统计+照片+小程序码）。
- **提醒开启（vaccine 页）**：一键 `wx.requestSubscribeMessage`（批量请求疫苗/儿保/自定义模板）→ 成功后提示"已开启，提醒次数用完可再次授权"；我的页可查看剩余次数（message_tokens）。
- **邀请有礼（family 页）**：分享按钮生成 `join-family?code=xxx&inviter=<family_id>`；文案"邀请好友建家庭，双方各得 7 天会员"；我的邀请记录（invite_rewards 列表）。

---

## 六、核心交互流程（用户故事）

### 流程 1：购买会员（全链路）
1. 我的页 → 会员中心 → 看到权益对比与容量条（已用 800MB/1GB）。
2. 点"年卡 98 元" → 确认弹窗 → 前端调 `create-order`。
3. Edge Function 下单成功 → 返回支付参数 → `wx.requestPayment` 拉起微信支付。
4. 用户付款 → 微信回调 Edge Function → 验签通过 → 订单 paid → memberships 写入（年卡，expires_at=+365 天）。
5. 前端轮询 order-status → 显示支付成功 → 会员中心状态刷新为会员版。
6. 失败/取消 → pay-result 显示"未完成"，可重新发起。

### 流程 2：容量超限引导
1. 上传照片 → 前端调 `check-quota` → 用量 1.05GB > 配额 → 拦截并提示。
2. 弹窗"免费空间已用完，升级会员获得 20GB"→ 跳会员中心（不强制，可关闭继续用旧照片）。
3. 免费版用户删除部分照片释放空间后仍可上传（容量实时重算）。

### 流程 3：疫苗订阅消息
1. 疫苗页点"开启微信提醒" → 微信授权弹窗（疫苗提醒模板）→ 授权成功 → message_tokens 计数 +1。
2. 用户添加一条"计划日期=明天"的疫苗（补丁后疫苗库/手动均可）。
3. 定时任务到点触发 `send-reminders` → 查该用户有 token → 调微信发送"明天接种 XX 疫苗"→ message_logs 记录 → reminders 置 sent。
4. 用户微信收到服务通知；App 内疫苗红点同步存在（兜底）。

### 流程 4：邀请有礼
1. 家庭页点"邀请有礼" → 生成带 `inviter` 参数的邀请卡片 → 转发家族群。
2. 好友注册 → 微信登录 → 输入/自动带出邀请码 → 加入家庭成功。
3. Edge Function `grant-invite-reward`：邀请人家庭 +7 天会员；被邀请人家庭开通/顺延 7 天。
4. 双方在会员中心看到"邀请奖励 +7 天"记录；防刷：同一被邀请人只计一次。

### 流程 5：AI 育儿助手（额度控制）
1. 我的页进 AI 助手 → 顶部显示"今日剩余 3 次"（免费）或"本月剩余 300 次"（会员）。
2. 用户问"宝宝 3 个月晚上频繁夜醒怎么办" → Edge Function 组装上下文（宝宝月龄+近 7 天睡眠记录）→ 调模型 → 返回回答（含"建议咨询医生"免责）。
3. 免费用户第 4 次提问 → Edge Function 拒绝 → 前端显示"今日免费次数已用完，开通会员解锁更多"。
4. 回答中涉及症状/用药 → 模型按 System Prompt 强制附加就医提示。

### 流程 6：日报分享（会员）
1. 记录页今日小结卡片 → 点"生成日报" → canvas 绘制（统计 + 当日照片 + 小程序码）。
2. 保存相册 → 转发家族群 → 好友长按识别小程序码 → 打开小程序（带场景值）→ 进入注册/登录 → 成为新用户。
3. 免费版无此按钮，点击提示权益说明。

### 流程 7：反馈
1. 我的页 → 意见反馈 → 填写内容 + 可选联系方式 → 提交 → 插入 feedback → toast"感谢反馈"。
2. 无登录也可？**要求登录**（便于定位问题）；投诉/建议内容 48 小时内人工查看（用户在 Dashboard 查看 feedback 表）。

### 流程 8：宝宝主页（P1，在线只读）
1. owner 在分享页点"生成分享链接" → Edge Function 签发 token（7 天有效）→ 得到 `/pages/baby-share/baby-share?token=xxx`。
2. 转发后任何人打开该链接 → 只看到：宝宝昵称首字、月龄、9 张照片缩略、里程碑名称（脱敏）。
3. 点照片不展示原图大图（仅缩略）；无任何健康记录/成员信息；token 过期或撤销后显示"链接已失效"。

---

## 七、分步开发计划（Agent 按此顺序执行）

> 每步含：目标 / 涉及内容 / 完成标准。**严格按顺序**，前一步未验证通过不进入下一步。P1 步骤（10、11、12）可按用户精力裁量，但 P0（Step 0~9）必须全部完成才可公开推广。

### Step 0：环境与资质准备（需用户配合）
- 目标：拿到三期全部外部凭证。
- 内容：
  1. 微信支付商户号：用户以个体户资质在 pay.weixin.qq.com 申请（需营业执照、法人银行卡、微信认证）；Agent 拿到 mchid、API v3 Key、商户私钥（apiclient_key.pem）、证书序列号。
  2. 订阅消息模板：mp.weixin.qq.com → 功能 → 订阅消息 → 申请模板（疫苗/日常提醒），记录模板 ID。
  3. AI 模型账号：用户在火山方舟/豆包开放平台开通并创建 API Key；记录模型名称（如 doubao-seed 系列，以用户所选为准）。
  4. 小程序码能力：确认小程序已认证（getwxacodeunlimit 需认证）。
- 完成标准：以上凭证齐全并安全存放（不提交仓库，由用户保管或环境变量管理）；不具备的项**如实记录为阻塞项**，向用户说明后再继续。

### Step 1：数据库落地
- 执行第四节 SQL（4.1~4.6），逐条核对；确认旧家庭 memberships(free) 已补齐。
- 完成标准：8 张新表 + 索引 + RLS 全部成功；`select count(*) from memberships` = 家庭数；前端对 orders/ai_usage 无任何策略可读（用未登录 SQL 验证为空）。

### Step 2：会员体系骨架
- 前端：member 页（权益对比 + 容量条 + 套餐卡片）、store 增加 membership 状态（启动时查 memberships）。
- 后端：`check-quota` Edge Function（用量统计 + 配额返回）。
- 完成标准：member 页正确展示当前权益与容量；setup 创建家庭后 memberships(free) 自动存在。

### Step 3：微信支付闭环
- 创建 `create-order`、`payment-callback`、`order-status` 三个 Edge Function；前端 member 页接入下单 + wx.requestPayment + 结果页轮询。
- 完成标准（用沙箱或真实小额测试）：
  - 支付成功 → 订单 paid → memberships 正确写入/顺延；
  - 回调重复投递不重复发权益（幂等）；
  - 伪造回调（无签名/改金额）被拒绝；
  - 取消支付 → 订单 pending，前端可重新发起。

### Step 4：容量管理
- 上传链路接入 `check-quota`；超限拦截 + 扩容引导弹窗；删除照片后用量实时下降。
- 完成标准：构造超限场景（临时改小配额常量验证）→ 拦截正确；释放后恢复。

### Step 5：订阅消息
- 申请模板（Step 0）；疫苗页"开启提醒"授权流程；message_tokens 维护；`send-reminders` 定时任务（Scheduled Function 或 pg_cron）+ 发送 + 日志 + 站内红点兜底。
- 完成标准：授权后 message_tokens 计数 +1；定时任务能对到期提醒发送订阅消息（真机验证收到）；token 用尽后任务降级为站内红点且不报错。

### Step 6：日报分享卡
- 复用二期 canvas 报告逻辑，生成"今日卡片"（统计+照片+小程序码）；会员可见；免费版引导。
- 完成标准：卡片生成并可保存；小程序码可被微信识别进入正确页面；免费版无按钮。

### Step 7：邀请有礼
- 家庭页邀请分享带 inviter 参数；join-family 解析并记录邀请关系；`grant-invite-reward` 发奖；防重复。
- 完成标准：新用户经邀请加入后，双方会员天数正确 +7；同一被邀请人重复邀请不重复发奖；奖励记录可查。

### Step 8：用户反馈
- feedback 页表单 + 提交；我的页入口。
- 完成标准：提交成功入库；未登录不可提交；Dashboard 可查看 feedback 列表。

### Step 9：AI 育儿助手
- `ai-chat` Edge Function（上下文组装 + 模型调用 + 额度扣减 + 免责 System Prompt）；ai-chat 页（对话 UI + 剩余次数 + 快捷问题 + 额度用尽引导）。
- 完成标准：免费 3 次/日限制生效（第 4 次被拒）；会员 300 次/月生效；涉及症状的回答含就医提示；模型 key 不在前端。

### Step 10：P1-儿保体检（可选）
- checkup 表 + 列表/表单页 + WHO 百分位评估（引入 WHO 0-2 岁标准数据，标注数据来源；开发时若无法取得权威数据，先做"录入+趋势展示"，百分位标注"数据待接入"）。
- 完成标准：可录入、列表展示、下次体检提醒（复用提醒体系）。

### Step 11：P1-生病/用药记录（可选）
- health_records 表 + 列表/表单页（类型：生病/用药/过敏）。
- 完成标准：增删改查 + RLS 隔离；录入时提示"用药请遵医嘱"。

### Step 12：P1-年度报告 + 宝宝主页（可选）
- 年度成长报告（跨年聚合 + canvas 分享）；宝宝主页（签名 token + 脱敏展示 + 撤销）。
- 完成标准：年度报告生成分享；分享链接 7 天有效、可撤销、只含脱敏数据。

### Step 13：全量联调与验收
- 按第八节验收清单逐项自测；三账号（owner/member/viewer）+ 两家庭回归 RLS。
- 完成标准：验收清单全部通过。

---

## 八、验收清单（Agent 交付前逐项勾选）

**会员与支付**
- [ ] 会员中心正确显示免费/会员状态与到期时间
- [ ] 下单 → 微信支付 → 回调 → 会员发放全链路通（沙箱或真实小额测试）
- [ ] 回调幂等：重复回调不重复发权益；伪造回调被拒
- [ ] 年卡/月卡到期时间计算正确（顺延场景：续费在到期前 = 原到期日 + 新时长）
- [ ] 前端无商户私钥 / API v3 Key

**容量**
- [ ] 用量统计正确（增删照片实时变化）；超限拦截 + 扩容引导正常
- [ ] 免费 1GB / 会员 20GB 为集中配置，可调整

**订阅消息**
- [ ] 授权流程正常，message_tokens 正确计数
- [ ] 定时任务能发送到期提醒（真机收到订阅消息）；token 用尽降级站内红点
- [ ] message_logs 完整记录发送结果

**AI 助手**
- [ ] 免费 3 次/日、会员 300 次/月限制生效（服务端强制，非仅前端）
- [ ] 上下文含宝宝月龄与近期记录；涉及症状/用药的回答含就医提示
- [ ] 模型 key 仅在服务端环境变量

**邀请与反馈**
- [ ] 邀请加入后双方 +7 天会员；重复邀请不重复发奖
- [ ] 反馈可提交入库，未登录不可提交

**日报分享**
- [ ] 会员可生成日报卡片（统计+照片+小程序码）；免费版无入口
- [ ] 小程序码扫码进入正确页面（可带场景值）

**权限与安全回归**
- [ ] 跨家庭数据隔离依然成立（含新增 8 表）
- [ ] viewer 对新增表（reminders 等）只读；orders/memberships/ai_usage 前端不可写
- [ ] 未登录无法访问任何业务数据
- [ ] 前端无 service_role / AppSecret / 商户密钥

**体验**
- [ ] 支付失败/取消/确认中有清晰提示，不卡死
- [ ] 弱网加载态正常；无白屏无报错
- [ ] 真机（安卓/苹果）全流程通过

---

## 九、风险与注意事项（Agent 与用户都需知晓）

1. **微信支付回调安全是底线**：验签 + 金额校验 + 幂等三者缺一不可；回调逻辑写完后必须做"伪造回调"攻击测试。
2. **订阅消息是"一次性"的**：别设计成"持续推送"；token 用完顺延站内红点；用户感知文案要诚实（"提醒次数有限，站内始终可见"）。
3. **AI 合规**：医疗相关回答必须带就医提示；对话内容不用于训练；额度服务端强制；免费额度是获客钩子不是漏洞（严禁客户端改计数）。
4. **儿童数据合规升级**：三期新增支付（订单含金额）、订阅消息（模板内容）、AI 对话（可能含健康描述）——隐私政策必须同步更新并在登录页可查；支付信息按平台要求留存。
5. **资质与真实测试**：微信支付需真实商户号（个体户可申请）；沙箱不可用则用真实小额支付测试并退款；**不要用伪造的"假支付"跳过验证**。
6. **容量统计性能**：对象多时 list 遍历慢，MVP 接受；上线后如慢再加用量缓存表（三期文档留说明，不实现）。
7. **邀请防刷**：同一被邀请人只奖励一次；同一设备/手机号多次注册需人工风控（MVP 用唯一约束 + 提示，不做复杂风控）。
8. **定价与文案**：会员定价为示例值，上线前用户最终确认；所有价格展示集中配置，避免改价遗漏。

---

## 十、给 Agent 的执行规则（必读）

1. **前置条件**：一期、二期、补丁全部验收通过后才开始三期；Step 0 资质未齐之前，**不实现支付/AI/订阅消息的假逻辑占位**，如实向用户报告阻塞项。
2. **严格按第七节步骤顺序执行**，每步完成自测后再进入下一步；P1（Step 10~12）由用户决定是否全部执行。
3. **执行 SQL 前先展示给用户确认**；涉及真实金钱的测试（支付）必须提前告知用户并征得同意。
4. **密钥管理**：anon key 可进前端；service_role、AppSecret、商户私钥、API v3 Key、AI Key 全部只放服务端环境变量，绝不进前端代码或提交仓库。
5. 遇到文档未定义、字段含义不明、或官方 API 与文档描述不一致时（尤其微信支付 v3 回调验签、订阅消息发送、Scheduled Function 用法），**停止并列出问题向用户确认**，不要自行猜测实现。
6. 编码规范延续：Vue3 组合式 API；金额一律用"分"存储避免浮点误差；时间统一 UTC 存储、展示转本地时区。
7. 交付前必须跑通"八、验收清单"全部项目（含 P0 全项与权限回归），输出验收结论；未完成项如实列出，不隐瞒。
