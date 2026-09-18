-- ============================================================================
-- 初芽（BabyUp）· 一二期补丁 · 迁移 009
-- 对应《婴儿成长记录小程序-一二期补丁开发需求文档》第四节（4.1 ~ 4.6）
--
-- 相对文档原文的 3 处修正（执行前已逐条向用户说明并确认）：
--   1.【文档缺陷，必修】4.6 的 `update families set invite_code = null` 在本库执行会失败：
--      families.invite_code 是一期建表时内联的 NOT NULL 约束（实测 OpenAPI 里为 required）。
--      修正：先 `drop not null` 再置空——一期前端已不再引用该字段（二期起只认
--      family_invitations），join_family_by_code() 用 `invite_code = v_code` 匹配，
--      null 永远匹配不上，旧码自然全部失效。
--   2.【文档缺陷，必修】app_logs.user_id 原文没写 on delete 行为，默认 NO ACTION；
--      而补丁 Step 3 的「账号注销」要删 auth 用户，只要该用户产生过一条埋点日志，
--      删除就会因外键约束失败（埋点覆盖登录/记录等高频动作，属于必现而非边缘情况）。
--      修正：`references auth.users(id) on delete set null`
--      —— 日志保留用于排障，但不再指向已注销用户。
--   3.【幂等】补 if not exists / drop policy if exists / 种子数据判空，
--      便于重复执行或在回滚后重跑（文档原文重复执行会因「对象已存在」报错）。
--
-- 备份：执行前已完成全表备份 supabase/backups/backup-20260918-1416.json
-- ============================================================================

-- ========== 4.1 表结构变更 ==========

-- profiles 增加真实邮箱字段（用于找回密码，不影响登录邮箱）
alter table profiles add column if not exists recovery_email text;

-- 疫苗知识库表（内置常见疫苗，仅供录入参考）
create table if not exists vaccine_library (
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
create table if not exists app_logs (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  family_id uuid,                           -- 冗余，便于按家庭分析
  event_type text not null check (event_type in ('error','page_view','action')),
  event_name text not null,                 -- 如 photo_upload_fail / report_share
  payload jsonb,                            -- 附加信息（错误信息/页面路径等）
  created_at timestamptz not null default now()
);

-- ========== 4.2 索引 ==========
create index if not exists idx_vaccine_lib_category on vaccine_library(category, sort_order);
create index if not exists idx_logs_created on app_logs(created_at desc);
create index if not exists idx_logs_user on app_logs(user_id);
create index if not exists idx_logs_family on app_logs(family_id);

-- ========== 4.3 开启 RLS ==========
alter table vaccine_library enable row level security;
alter table app_logs enable row level security;

-- ========== 4.4 RLS 策略 ==========
-- vaccine_library：任何登录用户可读（公共知识库）；不可写（数据由开发者维护）
drop policy if exists vaccine_lib_select on vaccine_library;
create policy vaccine_lib_select on vaccine_library for select
using (auth.uid() is not null);

-- app_logs：登录用户只能写自己的日志；不可读（查看走 Dashboard）
drop policy if exists logs_insert on app_logs;
create policy logs_insert on app_logs for insert
with check (auth.uid() = user_id);

-- ========== 4.5 种子数据（国家免疫规划常见疫苗，仅供录入参考） ==========
-- 免责声明：以下接种月龄为常见程序参考，实际以当地接种门诊及《预防接种证》为准。
-- 用「表为空才插入」包裹，重复执行不会产生重复数据。
do $$
begin
  if not exists (select 1 from vaccine_library) then
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
  end if;
end $$;

-- ========== 4.6 旧邀请码停用 ==========
-- 【本次不执行】用户未确认停用，已拆分为独立迁移 010_disable_legacy_invite_code.sql，
-- 待用户单独确认后再执行。切勿在本文件内恢复该段，以免误执行破坏性操作。
