-- ============================================================================
-- 初芽（BabyUp）第三期 · 迁移 015
-- 补「儿保体检」在 Supabase 侧的两处服务端逻辑（对应文档 4.4）
--
-- 背景：
--   014 只建了 checkup_records 表和 RLS，没有业务逻辑。
--   云开发侧这两件事都写在 data 云函数里（服务端完成，客户端只发一条请求）：
--     (1) 体检 ↔ 生长 联动：填了身高或体重 → 自动建/更新一条同日期同数值的
--         生长记录，并把 id 记回 checkup_records.growth_id；编辑时把身高体重
--         都清空 → 删掉那条联动生长记录并清空 growth_id。
--     (2) 删除体检记录时，用户要选「联动的生长记录一并删除 / 保留」。
--         api.db.remove 只能传 where 条件、没有地方承载这个选择，
--         所以整件事必须下沉成一个 rpc。
--
-- 为什么用触发器而不是 rpc（(1) 部分）：
--   客户端新增/编辑体检都走 api.db.insert / upsert，与 Cloud 侧同一份业务代码。
--   触发器能让两侧行为完全对齐，且不需要改任何业务代码、不需要客户端多发请求。
--   BEFORE 触发器可以直接改 NEW，回写 growth_id 不用再来一次 UPDATE。
--
-- ⚠️ 本文件是「只写不执行」的交付物：当前生产后端是云开发（BACKEND='cloud'），
--    不需要执行；仅在未来要回滚到 Supabase 时才按顺序执行。
--
-- 幂等：create or replace function / drop trigger if exists 后重建，重复执行不报错。
--
-- 与云函数 syncCheckupGrowth 刻意保持一致的两点：
--   1. 同步只覆盖 record_date 和三个数值，不碰家长在生长页写的 note；
--   2. growth_id 对应的生长记录必须同 family_id 同 baby_id 才认，否则当没有关联
--      （防客户端拿别人家的生长记录 id 填进来）。
-- ============================================================================

-- ========== 15.1 体检 → 生长 联动（BEFORE INSERT / UPDATE） ==========
create or replace function public.sync_checkup_growth()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_growth growth_records;
begin
  -- 只填了头围不触发联动：头围单独看没有意义，生长曲线也不画它
  if new.height_cm is null and new.weight_kg is null then
    if new.growth_id is not null then
      delete from growth_records g
      where g.id = new.growth_id
        and g.family_id = new.family_id
        and g.baby_id = new.baby_id;
      new.growth_id := null;
    end if;
    return new;
  end if;

  -- growth_id 只信库里那条：客户端可以把它改成别的家庭的生长记录 id
  if new.growth_id is not null then
    select * into v_growth from growth_records g
    where g.id = new.growth_id
      and g.family_id = new.family_id
      and g.baby_id = new.baby_id;
  end if;

  if v_growth.id is not null then
    -- 已有关联：原地更新，不新增记录（否则每存一次体检就多一条生长记录）
    update growth_records
       set record_date = new.checkup_date,
           height_cm   = new.height_cm,
           weight_kg   = new.weight_kg,
           head_cm     = new.head_cm
     where id = v_growth.id;
  else
    insert into growth_records (family_id, baby_id, record_date, height_cm, weight_kg, head_cm, created_by)
    values (new.family_id, new.baby_id, new.checkup_date, new.height_cm, new.weight_kg, new.head_cm, new.created_by)
    returning * into v_growth;
    new.growth_id := v_growth.id;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_checkup_growth on checkup_records;
create trigger trg_sync_checkup_growth
before insert or update on checkup_records
for each row execute function public.sync_checkup_growth();

-- ========== 15.2 删除体检记录（可选一并删除联动生长记录） ==========
-- 前端调用：api.db.rpc('remove_checkup_record', { p_id, p_delete_growth })
-- 与云函数 rpcRemoveCheckupRecord 同形，返回值 { growth_deleted: boolean }
create or replace function public.remove_checkup_record(p_id uuid, p_delete_growth boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user   uuid := auth.uid();
  v_row    checkup_records;
  v_deleted boolean := false;
begin
  if v_user is null then
    raise exception '未登录，请先登录';
  end if;

  select * into v_row from checkup_records where id = p_id;
  if v_row.id is null then
    raise exception '该体检记录不存在';
  end if;

  -- 与云函数 assertMember(userId, family_id, true) 对齐：active 且非 viewer 才能删
  if not exists (
    select 1 from family_members fm
    where fm.family_id = v_row.family_id
      and fm.user_id = v_user and fm.status = 'active'
      and fm.role != 'viewer'
  ) then
    raise exception '没有权限删除该体检记录';
  end if;

  if coalesce(p_delete_growth, false) and v_row.growth_id is not null then
    -- 只在确实同一个宝宝时删，避免历史脏数据误删别人家的记录
    delete from growth_records g
    where g.id = v_row.growth_id
      and g.family_id = v_row.family_id
      and g.baby_id = v_row.baby_id;
    v_deleted := found;
  end if;

  delete from checkup_records where id = p_id;

  return jsonb_build_object('growth_deleted', v_deleted);
end;
$$;
