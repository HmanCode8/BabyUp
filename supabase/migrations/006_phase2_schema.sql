-- ============================================================================
-- 初芽（BabyUp）第二期 · 迁移 006
-- 对应《婴儿成长记录小程序-第二期开发需求文档》第四节（4.1 ~ 4.7）
--
-- 相对文档原文的 4 处必要修正（均已与用户确认）：
--   1. 【问题 1，安全】文档 4.6 只收紧了 insert / delete，漏了 3 条 update 策略
--      （photos_update 补丁 002、photos_storage_update 补丁 004、growth_update 补丁 005），
--      照原文执行的话 viewer 仍能改照片备注、覆盖已有照片对象、改生长记录，
--      与「viewer 只能读」的验收项冲突。本文件把这 3 条一并重建为「非 viewer 可写」。
--   2. 【问题 2，功能】4.8 的「输入邀请码 → 查 family_invitations → 插成员 → 置 used」
--      在纯 RLS 下走不通：invites_select 只放行本家庭 active 成员，外人根本查不到邀请码行；
--      且置 used 的操作者是刚加入的 member，会被 owner-only 的 invites_update 拒绝；
--      若让前端直接 insert family_members，role 由客户端传入即可伪造 owner 提权。
--      故把整个流程下沉为 SECURITY DEFINER 函数 join_family_by_invite(p_code)。
--   3. 【问题 3】邀请码唯一性无法在前端校验（读不到别家数据），
--      生成动作同样下沉为 SECURITY DEFINER 函数 create_family_invitation(...)，
--      并在函数内查重。
--   4. 【问题 4】invites_insert 由文档的「非 viewer 成员」收紧为「仅 owner」，
--      与 5.2 / P0-8「owner 可生成指定角色邀请码」的描述对齐。
--
-- 还需用户确认的第 5 处（见文件末尾 6.7）：
--   members_insert 与 members_delete 组合起来允许「成员自己删行再以 owner 身份插回」自我提权。
-- ============================================================================

-- ========== 6.1 新增表（文档 4.1，原文照抄） ==========

-- 用户资料表（微信绑定 + 昵称头像）
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

-- ========== 6.2 一期表结构变更（文档 4.2） ==========
-- 一期 role 约束是建表时内联写的、未命名，PostgreSQL 按
-- <表名>_<列名>_check 规则自动命名为 family_members_role_check。
alter table family_members drop constraint family_members_role_check;
alter table family_members add constraint family_members_role_check
  check (role in ('owner','member','viewer'));

-- ========== 6.3 索引（文档 4.3，原文照抄） ==========
create index idx_profiles_openid          on profiles(wechat_openid);
create index idx_feeding_family_baby      on feeding_records(family_id, baby_id, record_time desc);
create index idx_sleep_family_baby        on sleep_records(family_id, baby_id, started_at desc);
create index idx_diaper_family_baby       on diaper_records(family_id, baby_id, record_time desc);
create index idx_milestones_family_baby   on milestones(family_id, baby_id, achieved_date desc);
create index idx_invites_family           on family_invitations(family_id);
create index idx_invites_code             on family_invitations(invite_code);

-- ========== 6.4 开启 RLS（文档 4.4，原文照抄） ==========
alter table profiles            enable row level security;
alter table feeding_records     enable row level security;
alter table sleep_records       enable row level security;
alter table diaper_records      enable row level security;
alter table milestones          enable row level security;
alter table family_invitations  enable row level security;

-- ========== 6.5 二期新表 RLS 策略（文档 4.5） ==========
-- 权限模型：owner 全权 / member 可读写业务数据 / viewer 只读
-- 所有用户只能看到「自己是 active 成员」的家庭数据（延续一期）

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

-- ⑥ family_invitations：读=本家庭 active 成员；发邀请=仅 owner（修正 4）；撤销/改状态=仅 owner
create policy invites_select on family_invitations for select
using (exists (select 1 from family_members fm
              where fm.family_id = family_invitations.family_id
                and fm.user_id = auth.uid() and fm.status = 'active'));
create policy invites_insert on family_invitations for insert
with check (exists (select 1 from family_members fm
                    where fm.family_id = family_invitations.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'
                      and fm.role = 'owner'));
create policy invites_update on family_invitations for update
using (exists (select 1 from family_members fm
               where fm.family_id = family_invitations.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role = 'owner'));

-- ========== 6.6 一期表写策略收紧（文档 4.6 + 修正 1） ==========
-- 原先「active 成员可写」改为「active 且 role != 'viewer' 可写」；select 策略不动（viewer 可读）。

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

-- 【修正 1】文档 4.6 漏掉的三条 update 策略（一期补丁 002 / 004 / 005 加的），
-- 不处理的话 viewer 依然能改照片备注、覆盖已有照片文件、改生长记录。
drop policy if exists photos_update on baby_photos;
create policy photos_update on baby_photos for update
using (exists (select 1 from family_members fm
               where fm.family_id = baby_photos.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'))
with check (exists (select 1 from family_members fm
                    where fm.family_id = baby_photos.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'
                      and fm.role != 'viewer'));

drop policy if exists growth_update on growth_records;
create policy growth_update on growth_records for update
using (exists (select 1 from family_members fm
               where fm.family_id = growth_records.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'))
with check (exists (select 1 from family_members fm
                    where fm.family_id = growth_records.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'
                      and fm.role != 'viewer'));

-- 存储桶策略收紧：viewer 可读不可传不可删不可覆盖
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
drop policy if exists photos_storage_update on storage.objects;
create policy photos_storage_update on storage.objects for update
using (
  bucket_id = 'baby-photos'
  and exists (select 1 from family_members fm
              where fm.family_id = (storage.foldername(name))[1]::uuid
                and fm.user_id = auth.uid() and fm.status = 'active'
                and fm.role != 'viewer')
)
with check (
  bucket_id = 'baby-photos'
  and exists (select 1 from family_members fm
              where fm.family_id = (storage.foldername(name))[1]::uuid
                and fm.user_id = auth.uid() and fm.status = 'active'
                and fm.role != 'viewer')
);

-- ========== 6.7 家庭成员表策略补漏（修正 5，待用户确认） ==========
-- 一期 members_insert = (auth.uid() = user_id)、members_delete = (auth.uid() = user_id)，
-- 两条组合起来，任何成员（含二期新增的 viewer）都能：
--   删掉自己那行 → 再插入 (family_id, me, role='owner') → 自我提权成 owner。
-- 由于「建家庭」「按邀请码加入」都走 SECURITY DEFINER 函数（绕过 RLS），
-- 前端从不需要直接往 family_members 插行，故把 insert 直接封掉最安全；
-- 退出家庭用的 delete 策略保持不变。
drop policy if exists members_insert on family_members;
create policy members_insert on family_members for insert
with check (false);

-- ========== 6.8 邀请码相关函数（修正 2 / 3） ==========

-- 生成一次性带角色邀请码：仅 owner 可发；6 位码在函数内查重
create or replace function public.create_family_invitation(
  p_family_id uuid,
  p_role text default 'member',
  p_expires_days integer default 7
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user  uuid := auth.uid();
  v_role  text := coalesce(nullif(btrim(coalesce(p_role, '')), ''), 'member');
  v_code  text;
  v_row   family_invitations;
  v_tries int := 0;
begin
  if v_user is null then
    raise exception '未登录，请先登录后再生成邀请码';
  end if;

  if not exists (
    select 1 from family_members fm
    where fm.family_id = p_family_id
      and fm.user_id = v_user and fm.status = 'active' and fm.role = 'owner'
  ) then
    raise exception '只有家庭创建者可以生成邀请码';
  end if;

  if v_role not in ('member', 'viewer') then
    raise exception '邀请角色只能是 member（成员）或 viewer（只读）';
  end if;

  if p_expires_days is not null and p_expires_days <= 0 then
    raise exception '有效期必须大于 0 天';
  end if;

  loop
    v_tries := v_tries + 1;
    v_code := public.generate_invite_code();
    exit when not exists (select 1 from family_invitations where invite_code = v_code);
    if v_tries >= 20 then
      raise exception '邀请码生成失败，请重试';
    end if;
  end loop;

  insert into family_invitations (family_id, invite_code, role, expires_at, status, created_by)
  values (
    p_family_id,
    v_code,
    v_role,
    case when p_expires_days is null then null
         else now() + make_interval(days => p_expires_days) end,
    'active',
    v_user
  )
  returning * into v_row;

  return to_jsonb(v_row);
end;
$$;

-- 用邀请码加入家庭：校验 -> 按邀请码上的角色写入成员关系 -> 邀请码置 used
-- （role 只能来自邀请码，客户端无法指定，避免提权）
create or replace function public.join_family_by_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_code text := upper(btrim(coalesce(p_code, '')));
  v_inv  family_invitations;
begin
  if v_user is null then
    raise exception '未登录，请先登录后再加入家庭';
  end if;

  if v_code = '' then
    raise exception '请输入邀请码';
  end if;

  select * into v_inv from family_invitations where invite_code = v_code;
  if v_inv.id is null then
    raise exception '邀请码无效';
  end if;

  -- 「已过期」只按 expires_at 判定，不在这里改 status：
  -- 同一事务里 RAISE 会把 status 的更新一起回滚，前端按 expires_at 展示「已过期」即可
  if v_inv.status = 'used' then
    raise exception '邀请码已被使用';
  end if;
  if v_inv.status = 'revoked' then
    raise exception '邀请码已被撤销';
  end if;
  if v_inv.status = 'expired'
     or (v_inv.expires_at is not null and v_inv.expires_at <= now()) then
    raise exception '邀请码已过期';
  end if;

  -- 已经是该家庭的 active 成员：直接返回，不消耗邀请码
  if exists (
    select 1 from family_members
    where family_id = v_inv.family_id and user_id = v_user and status = 'active'
  ) then
    return jsonb_build_object(
      'family_id', v_inv.family_id, 'role', v_inv.role, 'alreadyMember', true
    );
  end if;

  -- 一期约定：一个用户同时只属于一个家庭
  if exists (
    select 1 from family_members
    where user_id = v_user and status = 'active' and family_id <> v_inv.family_id
  ) then
    raise exception '你已加入一个家庭，暂不支持同时属于多个家庭';
  end if;

  -- 曾被移除/退出过的用户：on conflict 直接复活并更新为新角色
  insert into family_members (family_id, user_id, role, status)
  values (v_inv.family_id, v_user, v_inv.role, 'active')
  on conflict (family_id, user_id) do update
    set role = excluded.role, status = 'active';

  update family_invitations set status = 'used' where id = v_inv.id;

  return jsonb_build_object(
    'family_id', v_inv.family_id, 'role', v_inv.role, 'alreadyMember', false
  );
end;
$$;

-- ========== 6.9 数据迁移（文档 4.7，原文照抄） ==========
-- 为既有用户补 profiles 行（微信字段留空，后续绑定时再更新）
insert into profiles (id, updated_at)
select u.id, now() from auth.users u
left join profiles p on p.id = u.id
where p.id is null;
