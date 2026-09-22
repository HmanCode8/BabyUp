-- ============================================================================
-- 初芽（BabyUp）· 一二期补丁 · 迁移 013
-- 目的：彻底移除一期 families.invite_code（永久邀请码），并让 create_family() 不再写入
--
-- 背景：
--   补丁文档 4.6「旧邀请码停用」要求把 families.invite_code 置空停用。
--   用户已确认该字段没有保留价值（「没啥大作用就去掉吧」），故本次直接删列，
--   二期的一次性邀请码（family_invitations.invite_code）完全不受影响。
--
-- ⚠️ 破坏性操作，已获用户单独确认。
--
-- 内容：
--   1. 丢弃已废弃的 join_family_by_code()：它按 families.invite_code 匹配，
--      前端自二期起只走 family_invitations，云开发侧也未实现该接口（data/index.js 有注）；
--   2. 删除 families.invite_code 列（NOT NULL 与唯一约束随列一起消失）；
--   3. 重建 create_family()：不再生成/写入邀请码，只写家庭 + owner 成员关系。
--
-- 影响面：families 表全部行的 invite_code 被删除，不可恢复。
--         前端已无任何引用（family.js 的 FAMILY_COLUMNS 已去掉该列）。
--
-- 与迁移 010 的关系：010 只做「置空 + 放开 NOT NULL」，已被本文件完全覆盖，
--   且 010 从未执行过，已从仓库删除。只需执行本文件，不要再执行 010。
--
-- 幂等：drop ... if exists / create or replace，重复执行不报错。
-- ============================================================================

-- 1. 废弃接口：按一期永久邀请码加入家庭
drop function if exists public.join_family_by_code(text);

-- 2. 直接删列
alter table families drop column if exists invite_code;

-- 3. 创建家庭：去掉邀请码生成，允许一个用户创建/拥有多个家庭（沿用迁移 008 的语义）
create or replace function public.create_family(p_name text default '我的家')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_family families;
begin
  if v_user is null then
    raise exception '未登录，请先登录后再创建家庭';
  end if;

  insert into families (name)
  values (coalesce(nullif(btrim(coalesce(p_name, '')), ''), '我的家'))
  returning * into v_family;

  insert into family_members (family_id, user_id, role, status)
  values (v_family.id, v_user, 'owner', 'active');

  return jsonb_build_object('family', to_jsonb(v_family));
end;
$$;
