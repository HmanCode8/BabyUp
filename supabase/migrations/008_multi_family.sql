-- ============================================================================
-- 初芽（BabyUp）· 迁移 008
-- 放开「一个用户只能属于一个家庭」的限制（支持一个用户加入多个家庭）
--
-- 背景：一期文档写的是「一期一个用户只属于一个家庭」，因此 create_family /
-- join_family_by_code / join_family_by_invite 里都有「已加入一个家庭就报错」的判断。
-- 现在产品要求一个用户可以同时属于多个家庭（例如爸爸既是自己小家的成员、
-- 又是岳父母家的成员），所以在数据库层去掉这三处拒绝逻辑。
--
-- 说明：
--   - 表结构不用改：family_members 的唯一约束是 (family_id, user_id)，
--     本来就允许同一个 user_id 出现在多个 family_id 下。
--   - RLS 一行不动：策略都是「我是该家庭 active 成员就能看该家庭的数据」，
--     一个用户有两条成员关系时，两个家庭的数据都能看到，互相之间仍然隔离。
--   - 「已是该家庭成员则直接返回、不重复插入」的幂等逻辑保留。
--   - 前端需配合：登录后不再只取一条成员关系，而是取回全部并支持切换当前家庭。
-- ============================================================================

-- 创建家庭：去掉「已加入一个家庭就报错」，允许创建/拥有多个家庭
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

-- 按邀请码加入家庭（一期旧邀请码，保留兼容）：去掉跨家庭限制
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

  -- 已经是该家庭成员：直接返回，不重复插入
  if exists (
    select 1 from family_members
    where family_id = v_family.id and user_id = v_user and status = 'active'
  ) then
    return jsonb_build_object('family', to_jsonb(v_family), 'alreadyMember', true);
  end if;

  insert into family_members (family_id, user_id, role, status)
  values (v_family.id, v_user, 'member', 'active')
  on conflict (family_id, user_id) do update set status = 'active';

  return jsonb_build_object('family', to_jsonb(v_family), 'alreadyMember', false);
end;
$$;

-- 用新版邀请码加入家庭（二期带角色邀请码）：去掉跨家庭限制
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
