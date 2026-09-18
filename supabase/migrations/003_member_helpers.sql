-- ============================================================================
-- 初芽（BabyUp）第一期 · 补丁 003
-- 为「家庭成员管理」（需求文档 5.2 / Step 8）补两个数据库函数
--
-- 背景：
--  1) members_update 策略是 owner-only（这是刻意收紧的：若允许成员更新自己那一行，
--     被移除的成员就能把 status 改回 active 重新拿到数据）。因此成员无法直接设置自己的昵称，
--     而 5.2 要求成员列表展示「昵称 + 角色」，昵称必须有地方可写。
--  2) 微信小程序不支持 PATCH，前端更新一律走 upsert（INSERT ... ON CONFLICT DO UPDATE），
--     该语句要求 INSERT 策略也放行；而 members_insert 是 auth.uid() = user_id，
--     owner 更新别人那一行会被 INSERT 检查拦下。
--  因此把这两件事下沉为 SECURITY DEFINER 函数，只放行必要的字段与操作，不放宽任何现有策略。
-- ============================================================================

-- 成员设置自己的昵称（只改 nickname 一个字段）
create or replace function public.set_my_nickname(p_nickname text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_name text := nullif(btrim(coalesce(p_nickname, '')), '');
  v_row  family_members;
begin
  if v_user is null then
    raise exception '未登录，请先登录';
  end if;

  if v_name is not null and length(v_name) > 12 then
    raise exception '昵称最多 12 个字';
  end if;

  update family_members
     set nickname = v_name
   where user_id = v_user
     and status = 'active'
  returning * into v_row;

  if v_row.id is null then
    raise exception '你还没有加入任何家庭';
  end if;

  return jsonb_build_object('member', to_jsonb(v_row));
end;
$$;

-- 家庭创建者移除成员：软删除（status = 'removed'），保留成员行以便日后重新加入
create or replace function public.remove_family_member(p_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_target family_members;
begin
  if v_user is null then
    raise exception '未登录，请先登录';
  end if;

  select * into v_target from family_members where id = p_member_id;
  if v_target.id is null then
    raise exception '该成员不存在';
  end if;

  if not public.is_family_owner(v_target.family_id) then
    raise exception '只有家庭创建者可以移除成员';
  end if;
  if v_target.user_id = v_user then
    raise exception '不能移除自己';
  end if;
  if v_target.role = 'owner' then
    raise exception '不能移除家庭创建者';
  end if;

  update family_members
     set status = 'removed'
   where id = p_member_id
  returning * into v_target;

  return jsonb_build_object('member', to_jsonb(v_target));
end;
$$;
