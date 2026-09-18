-- ============================================================================
-- 初芽（BabyUp）第一期 · 数据库初始化
-- 对应《婴儿成长记录小程序-第一期开发需求文档》第四节
--
-- 相对文档原文的 3 处必要修正（已与用户确认）：
--   1. family_members 的 members_update 策略原写法在自身策略里再查自身，会触发
--      PostgreSQL「infinite recursion detected in policy for relation "family_members"」，
--      改用 SECURITY DEFINER 辅助函数 is_family_owner() 判断，彻底消除自我引用。
--   2. members_select 原策略只放行 auth.uid() = user_id，导致成员列表永远只显示自己，
--      且「按邀请码加入」时无法读取目标家庭。改为「自己的行 + 本家庭成员的行」。
--   3. families_select 只放行「自己已是成员」的家庭，因此按 invite_code 查家庭必然返回空，
--      邀请码加入流程走不通；同时前端也无法校验邀请码唯一性。
--      改用两个 SECURITY DEFINER 函数把「建家庭（含邀请码生成）」和「按邀请码加入」下沉到数据库。
-- 除上述修正外，表结构、索引、其余 RLS 策略与文档原文保持一致。
-- ============================================================================

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

-- ========== 4.3.1 RLS 辅助函数（修正 1 / 修正 3 引入） ==========
-- SECURITY DEFINER 让函数以属主身份查询，绕过 RLS，从而避免策略自我引用导致的无限递归。
-- 三个函数都在入口校验 auth.uid()，未登录（anon）调用一律拒绝。

-- 当前用户是否是某家庭的 active 成员
create or replace function public.is_family_member(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from family_members fm
    where fm.family_id = p_family_id
      and fm.user_id = auth.uid()
      and fm.status = 'active'
  );
$$;

-- 当前用户是否是某家庭的 owner
create or replace function public.is_family_owner(p_family_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from family_members fm
    where fm.family_id = p_family_id
      and fm.user_id = auth.uid()
      and fm.role = 'owner'
      and fm.status = 'active'
  );
$$;

-- 生成 6 位邀请码：去掉易混淆的 I / O / 0 / 1
create or replace function public.generate_invite_code()
returns text
language sql
volatile
as $$
  select string_agg(
           substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', (random() * 31)::int + 1, 1),
           ''
         )
  from generate_series(1, 6);
$$;

-- 创建家庭：生成唯一邀请码 + 把当前用户写成 owner（原子操作，前端只需一次调用）
create or replace function public.create_family(p_name text default '我的家')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_code   text;
  v_family families;
  v_tries  int := 0;
begin
  if v_user is null then
    raise exception '未登录，请先登录后再创建家庭';
  end if;

  if exists (select 1 from family_members where user_id = v_user and status = 'active') then
    raise exception '你已加入一个家庭，一期暂不支持同时属于多个家庭';
  end if;

  -- 邀请码查重（唯一索引兜底极小概率的并发冲突）
  loop
    v_tries := v_tries + 1;
    v_code := public.generate_invite_code();
    exit when not exists (select 1 from families where invite_code = v_code);
    if v_tries >= 20 then
      raise exception '邀请码生成失败，请重试';
    end if;
  end loop;

  insert into families (name, invite_code)
  values (coalesce(nullif(btrim(coalesce(p_name, '')), ''), '我的家'), v_code)
  returning * into v_family;

  insert into family_members (family_id, user_id, role, status)
  values (v_family.id, v_user, 'owner', 'active');

  return jsonb_build_object('family', to_jsonb(v_family));
end;
$$;

-- 按邀请码加入家庭（校验 + 写入成员关系，前端无法直接查 families 也能完成加入）
create or replace function public.join_family_by_code(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_code   text := upper(btrim(coalesce(p_code, '')));
  v_family families;
begin
  if v_user is null then
    raise exception '未登录，请先登录后再加入家庭';
  end if;

  if v_code = '' then
    raise exception '请输入邀请码';
  end if;

  select * into v_family from families where invite_code = v_code;
  if v_family.id is null then
    raise exception '邀请码无效';
  end if;

  if exists (
    select 1 from family_members
    where family_id = v_family.id and user_id = v_user and status = 'active'
  ) then
    return jsonb_build_object('family', to_jsonb(v_family), 'alreadyMember', true);
  end if;

  if exists (
    select 1 from family_members
    where user_id = v_user and status = 'active' and family_id <> v_family.id
  ) then
    raise exception '你已加入一个家庭，一期暂不支持同时属于多个家庭';
  end if;

  insert into family_members (family_id, user_id, role, status)
  values (v_family.id, v_user, 'member', 'active')
  on conflict (family_id, user_id) do update set status = 'active';

  return jsonb_build_object('family', to_jsonb(v_family), 'alreadyMember', false);
end;
$$;

-- ========== 4.4 RLS 策略 ==========
-- 核心权限模型：
--  - 用户只能看到"自己是 active 成员"的家庭及其下所有数据
--  - family_members：自己那行始终可见；本家庭成员之间互相可见（修正 2）
--  - 家庭创建者（owner）可改家庭信息、可管理本家庭成员
--  - 所有 active 成员可读写宝宝及记录

-- families
create policy families_select on families for select
using (exists (select 1 from family_members fm
               where fm.family_id = families.id
                 and fm.user_id = auth.uid()
                 and fm.status = 'active'));
create policy families_insert on families for insert
with check (true);  -- 任何登录用户可创建家庭（前端实际走 create_family() 函数）
create policy families_update on families for update
using (exists (select 1 from family_members fm
               where fm.family_id = families.id
                 and fm.user_id = auth.uid()
                 and fm.role = 'owner'
                 and fm.status = 'active'));

-- family_members（修正 2：消除自我引用递归 + 成员列表可见）
create policy members_select on family_members for select
using (auth.uid() = user_id or public.is_family_member(family_id));
create policy members_insert on family_members for insert
with check (auth.uid() = user_id);
create policy members_update on family_members for update
using (public.is_family_owner(family_id))
with check (public.is_family_owner(family_id));
create policy members_delete on family_members for delete
using (auth.uid() = user_id or public.is_family_owner(family_id));

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
