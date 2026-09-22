-- ============================================================================
-- 初芽（BabyUp）第三期 · 迁移 014
-- 对应《婴儿成长记录小程序-第三期开发需求文档（云开发版）》5.1 ~ 5.3
--
-- 目的：为第三期的三个新功能补 Supabase 侧的表。
--   云开发侧对应 init-db/index.js 的 COLLECTIONS 新增 3 个集合：
--     feedbacks / illness_records / checkup_records
--
-- 为什么必须有这一份（文档 5.4「两侧同步要求」）：
--   项目是双后端并存，`src/services/api.js` 是唯一切换点，同一份业务代码在两侧跑。
--   Supabase 侧缺表 → 把 BACKEND 切回 'supabase' 时这些功能会直接报错。
--
-- ⚠️ 本文件是「只写不执行」的交付物：当前生产后端是云开发（BACKEND='cloud'），
--    不需要执行；仅在未来要回滚到 Supabase 时才按顺序执行。
--
-- 幂等：create table / create index 均带 if not exists，policy 先 drop 再 create，
--       重复执行不报错。
--
-- 相对文档 5.3 字段清单的 1 处增加（已与用户确认）：
--   checkup_records 多一列 growth_id，指向体检时自动生成的那条生长记录，
--   用于「改体检 → 同步改生长」「删体检 → 可选删生长」。文档只说了联动要求，
--   没给关联方式；不存这个 id 就只能靠「同日期同数值」猜，一改日期就丢关联。
-- ============================================================================

-- ========== 14.1 feedbacks（用户反馈，账号维度） ==========
-- 无 family_id / baby_id：反馈可能在用户还没建家庭时就要提交。
-- user_id 与 created_by 在云开发侧都是 openid，这里都指向 auth.uid()。
create table if not exists feedbacks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  created_by uuid not null references auth.users(id) on delete cascade,
  content text not null,                                   -- 问题描述（5 ~ 500 字，长度由服务端校验）
  type text not null default 'other' check (type in ('bug','suggestion','content','other')),
  contact text,                                            -- 联系方式（可选，用于回访）
  images text[] not null default '{}',                     -- Storage 相对路径，最多 3 张
  status text not null default 'pending' check (status in ('pending','done')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_feedbacks_user on feedbacks(user_id, created_at desc);

alter table feedbacks enable row level security;

-- 只给自己看、只由自己写；status 由管理员在控制台改，故不开放 update/delete 策略
drop policy if exists feedbacks_select on feedbacks;
create policy feedbacks_select on feedbacks for select
using (user_id = auth.uid());

drop policy if exists feedbacks_insert on feedbacks;
create policy feedbacks_insert on feedbacks for insert
with check (user_id = auth.uid());

-- ========== 14.2 illness_records（生病 / 用药，家庭子表） ==========
create table if not exists illness_records (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  baby_id uuid not null references babies(id) on delete cascade,
  occurred_at timestamptz not null,                        -- 发病时间
  symptoms text[] not null default '{}',                   -- 症状标签（至少 1 项，由服务端校验）
  temperature numeric(4,1),                                -- 体温 ℃
  medicines jsonb not null default '[]'::jsonb,            -- [{ name, dose, unit, frequency, days, note }]
  hospital text,                                           -- 就诊医院
  doctor text,                                             -- 医生
  diagnosis text,                                          -- 诊断
  allergy_note text,                                       -- 过敏 / 不良反应
  photos text[] not null default '{}',                     -- Storage 相对路径，最多 3 张
  note text,
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_illness_family_baby on illness_records(family_id, baby_id, occurred_at desc);

alter table illness_records enable row level security;

-- 读 = 本家庭 active 成员；写 = active 且非 viewer（同 milestones 模式）
drop policy if exists illness_select on illness_records;
create policy illness_select on illness_records for select
using (exists (select 1 from family_members fm
              where fm.family_id = illness_records.family_id
                and fm.user_id = auth.uid() and fm.status = 'active'));

drop policy if exists illness_insert on illness_records;
create policy illness_insert on illness_records for insert
with check (exists (select 1 from family_members fm
                    where fm.family_id = illness_records.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'
                      and fm.role != 'viewer'));

drop policy if exists illness_update on illness_records;
create policy illness_update on illness_records for update
using (exists (select 1 from family_members fm
               where fm.family_id = illness_records.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));

drop policy if exists illness_delete on illness_records;
create policy illness_delete on illness_records for delete
using (exists (select 1 from family_members fm
               where fm.family_id = illness_records.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));

-- ========== 14.3 checkup_records（儿保体检，家庭子表） ==========
create table if not exists checkup_records (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  baby_id uuid not null references babies(id) on delete cascade,
  checkup_date date not null,                              -- 体检日期
  month_age integer,                                       -- 月龄（由 checkup_date 与宝宝生日算出，前端只读）
  growth_id uuid references growth_records(id) on delete set null,  -- 联动生成的生长记录（见文件头说明）
  hospital text,                                           -- 体检机构
  height_cm numeric(5,1),
  weight_kg numeric(5,2),
  head_cm numeric(5,1),
  hemoglobin numeric(5,1),
  development text,                                        -- 发育评估
  doctor_advice text,                                      -- 医生建议
  next_date date,                                          -- 建议下次体检日期
  photos text[] not null default '{}',                     -- 体检本照片，最多 3 张
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_checkup_family_baby on checkup_records(family_id, baby_id, checkup_date desc);

alter table checkup_records enable row level security;

drop policy if exists checkup_select on checkup_records;
create policy checkup_select on checkup_records for select
using (exists (select 1 from family_members fm
              where fm.family_id = checkup_records.family_id
                and fm.user_id = auth.uid() and fm.status = 'active'));

drop policy if exists checkup_insert on checkup_records;
create policy checkup_insert on checkup_records for insert
with check (exists (select 1 from family_members fm
                    where fm.family_id = checkup_records.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'
                      and fm.role != 'viewer'));

drop policy if exists checkup_update on checkup_records;
create policy checkup_update on checkup_records for update
using (exists (select 1 from family_members fm
               where fm.family_id = checkup_records.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));

drop policy if exists checkup_delete on checkup_records;
create policy checkup_delete on checkup_records for delete
using (exists (select 1 from family_members fm
               where fm.family_id = checkup_records.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));
