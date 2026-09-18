-- ============================================================================
-- 初芽（BabyUp）第二期 · 迁移 007
-- 补一个「修改成员角色」的 SECURITY DEFINER 函数（Step 8 家庭页要用）
--
-- 背景（006 执行后自测发现的回归）：
--   006 把 members_insert 收紧为 with check (false)，用来封掉
--   「删掉自己那行 → 再以 role='owner' 插回」的自我提权路径，这一步是有效的；
--   但同时也挡掉了「owner 修改成员角色」，因为微信小程序不支持 PATCH，
--   前端所有更新都走 upsert（INSERT ... ON CONFLICT DO UPDATE），
--   而 PostgreSQL 对这条语句会一并校验 INSERT 策略的 WITH CHECK（实测返回 403）。
--   另外，即便不封 insert，一期的 members_insert = (auth.uid() = user_id)
--   也只能写自己那行，owner 改「别人」的角色同样走不通。
--
-- 结论：成员表的写操作一律下沉到 SECURITY DEFINER 函数，
--       与一期 set_my_nickname / remove_family_member / create_family 保持一致。
--       - 隐藏策略 members_insert = with check (false) 保持不变（006 已建）
--       - members_update（owner-only）保持不变，只是不再被前端直接使用
--       - 退出家庭仍用 members_delete（auth.uid() = user_id），不受影响
-- ============================================================================

-- 修改成员角色：仅 owner 可调用；只能改成 member / viewer，不能动创建者
create or replace function public.set_member_role(p_member_id uuid, p_role text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_role text := btrim(coalesce(p_role, ''));
  v_row  family_members;
begin
  if v_user is null then
    raise exception '未登录，请先登录';
  end if;

  select * into v_row from family_members where id = p_member_id;
  if v_row.id is null then
    raise exception '成员不存在';
  end if;

  if not exists (
    select 1 from family_members fm
    where fm.family_id = v_row.family_id
      and fm.user_id = v_user and fm.status = 'active' and fm.role = 'owner'
  ) then
    raise exception '只有家庭创建者可以修改成员角色';
  end if;

  if v_row.role = 'owner' then
    raise exception '不能修改家庭创建者的角色';
  end if;

  if v_row.status <> 'active' then
    raise exception '该成员已被移除';
  end if;

  if v_role not in ('member', 'viewer') then
    raise exception '角色只能是 member（成员）或 viewer（只读）';
  end if;

  update family_members set role = v_role where id = p_member_id
  returning * into v_row;

  return jsonb_build_object('member', to_jsonb(v_row));
end;
$$;
