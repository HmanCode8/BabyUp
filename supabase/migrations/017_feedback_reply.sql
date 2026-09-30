-- ============================================================================
-- 书遥贝贝（BabyUp）· 迁移 017
-- 目的：意见反馈补三列 —— reply（一句回复）/ handled_at / handled_by
--
-- 背景：
--   过去 feedbacks.status 只能在云开发控制台手工改，家长看不到任何回应；
--   现在管理动作搬进了小程序里的运维后台（超管在「意见反馈」页签处理并写一句回复），
--   「我的 → 意见反馈」要把这句回复显示给提交人。
--   于是 feedbacks 需要落地这三个字段，前端 src/services/feedback.js 的
--   FEEDBACK_COLUMNS 里已经按列名 select 了它们。
--
-- 说明：
--   1. 三列全部可空：历史反馈没有回复，读了就是空，不影响旧行。
--   2. handled_by 记「谁处理的」（云开发侧是 openid，这里指向 auth.users）。
--      只用于排障，前端不展示。
--   3. 幂等：add column if not exists，可重复执行。
--
-- ⚠️ 本迁移**尚未在 Supabase 上执行**（当前运行的是微信云开发版，
--    其 feedbacks 是 NoSQL 集合，加字段不需要迁移）。
--    将来若回滚到 Supabase，必须先跑这个迁移，
--    否则前端 select 里的 reply 会因列不存在而整条报错。
--
--    另外：云开发侧「处理反馈」走的是 data 云函数的 actionAdminSetFeedbackStatus，
--    按写死的 openid 名单判定超管；Supabase 侧没有运维后台（capabilities.admin 为 false），
--    这三列只能由 service_role / 控制台写。因此这里**不新增 update 策略**，
--    保持 014 里「只给自己看、只由自己写」的既有规则不变。
-- ============================================================================

-- ---------- 1. 加列 ----------
alter table feedbacks
  add column if not exists reply text,
  add column if not exists handled_at timestamptz,
  add column if not exists handled_by uuid references auth.users(id) on delete set null;

comment on column feedbacks.reply is
  '管理员处理这条反馈时写的一句回复；空 = 没写回复，只改了状态';
comment on column feedbacks.handled_at is
  '标记为「已处理」的时间；标回待处理会清空';
comment on column feedbacks.handled_by is
  '处理人（云开发侧是 openid）；仅排障用，前端不展示';

-- ---------- 2. 约束 ----------
-- 一句回复，长度上限与 data 云函数的 FEEDBACK_MAX_REPLY 保持一致（200 字）。
-- 服务端已经拦过，这里再兜一层，免得别的写入路径绕过业务层。
alter table feedbacks
  drop constraint if exists feedback_reply_len;
alter table feedbacks
  add constraint feedback_reply_len check (reply is null or char_length(reply) <= 200);
