-- ============================================================================
-- 书遥贝贝（BabyUp）· 迁移 016
-- 目的：喂养记录补一列 leftover_ml（这一顿剩下多少毫升）
--
-- 背景：
--   amount_ml 记的是「冲/倒出来多少」，但宝宝不一定喝完：冲 90 剩 30，
--   实际只吃进去 60。家长过去一直把剩余量写在备注里（「剩了 30ml」），
--   而统计只能按 amount_ml 累加，导致每天奶量系统性偏高
--   （实测：家里 50 条配方奶记录合计虚高 490 ml）。
--
--   本迁移把剩余量结构化存下来，实际摄入 = amount_ml - leftover_ml，
--   由前端 src/services/feeding.js 的 netAmountMl() 统一计算，
--   今日小结 / 历史每天 / 成长报告 / AI 上下文全部走这个净值。
--
-- 说明：
--   1. 只对瓶喂（formula / water）有意义；母乳按时长计、辅食只记次数，
--      两者一律留空（前端 normalizeAmount() 会强制置空）。
--   2. 列可空：留空 = 喝完了，与「历史数据没填过剩余」同义，不影响旧行。
--   3. 幂等：带 if not exists / drop constraint if exists，可重复执行。
--
-- ⚠️ 本迁移**尚未在 Supabase 上执行**（当前运行的是微信云开发版，
--    其 feeding_records 是 NoSQL 集合，加字段不需要迁移）。
--    将来若回滚到 Supabase，必须先跑这个迁移，
--    否则前端查询里 select 的 leftover_ml 会因列不存在而整条报错。
-- ============================================================================

-- ---------- 1. 加列 ----------
alter table feeding_records
  add column if not exists leftover_ml numeric(6,1);

comment on column feeding_records.leftover_ml is
  '这一顿剩下的毫升数；空 = 喝完了。实际摄入 = amount_ml - leftover_ml';

-- ---------- 2. 约束 ----------
-- 只挡负数：上限（不得超过 amount_ml）由业务层保证，
-- 因为「剩余 = 总量」是合法场景（一口没喝），用列约束不好表达。
alter table feeding_records
  drop constraint if exists feeding_leftover_nonneg;
alter table feeding_records
  add constraint feeding_leftover_nonneg check (leftover_ml is null or leftover_ml >= 0);

-- ---------- 3. 历史数据回填（说明，不在本文件里执行） ----------
-- 微信云开发版已按备注原文人工回填 14 条（只填备注里写明数字的，
-- 「剩了一点点」这类含糊的一律不动，备注原文保留可追溯）。
-- 若以后把数据整体搬回 Supabase，需要单独做一次回填：
--   来源 = note 里的「剩 N」「喝了 N」「一半」，逐条人工确认后再写，
--   不要用正则批量刷 —— 备注里混着「喝完了剩下的 60」这类
--   「把上次剩的喝掉」的语义，正则会把它的剩余算反。
