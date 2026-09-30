-- ============================================================================
-- 书遥贝贝 · 迁移 018：照片文件夹（相册）
--
-- 目的：给「时光」页加一层文件夹管理（文件夹 / 按月 / 全部 三个视图）。
--   云开发侧对应新建集合 photo_albums，并登记进 init-db/index.js 的 COLLECTIONS。
--
-- 为什么必须有这一份（双后端并存）：
--   `src/services/api.js` 是唯一切换点，同一份业务代码在两侧跑。
--   Supabase 侧缺表/缺列 → 把 BACKEND 切回 'supabase' 时照片页会直接报错。
--
-- 两处刻意的设计（已与用户确认）：
--   1. `baby_photos.album_id` 是 `on delete set null`：删文件夹时里面的照片**不删**，
--      只是回到「未分类」。照片不可再生，级联删除一个文件夹就丢掉一整叠照片太危险。
--      云开发侧没有外键，同样的清空动作写在 data 云函数的删相册分支里，两侧行为对齐。
--   2. 相册挂在 family + baby 两个维度下：与「按月」视图口径一致（时光页按当前宝宝看），
--      所以「一岁」文件夹属于某个宝宝，不是全家共用。
--
-- 幂等：create table / index 带 if not exists；alter 用 add column if not exists；
--       policy 一律先 drop 再 create，重复执行不报错。
-- ============================================================================

-- ========== 18.1 相册表 photo_albums ==========
create table if not exists photo_albums (
  id uuid primary key default gen_random_uuid(),
  family_id uuid not null references families(id) on delete cascade,
  baby_id uuid not null references babies(id) on delete cascade,
  name text not null,                       -- 文件夹名（≤ 20 字，长度与重名由服务端校验）
  sort_order integer not null default 0,    -- 越小越靠前；文件夹拖拽排序写这一列
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);

create index if not exists idx_albums_family_baby_sort
  on photo_albums(family_id, baby_id, sort_order);

-- 同一宝宝下不允许重名（云开发侧对应唯一索引 idx_album_unique_name）
create unique index if not exists idx_albums_unique_name
  on photo_albums(family_id, baby_id, name);

alter table photo_albums enable row level security;

-- 读 = 本家庭 active 成员；写 = active 且非 viewer（同 milestones / illness_records 模式）
drop policy if exists albums_select on photo_albums;
create policy albums_select on photo_albums for select
using (exists (select 1 from family_members fm
              where fm.family_id = photo_albums.family_id
                and fm.user_id = auth.uid() and fm.status = 'active'));

drop policy if exists albums_insert on photo_albums;
create policy albums_insert on photo_albums for insert
with check (exists (select 1 from family_members fm
                    where fm.family_id = photo_albums.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'
                      and fm.role != 'viewer'));

drop policy if exists albums_update on photo_albums;
create policy albums_update on photo_albums for update
using (exists (select 1 from family_members fm
               where fm.family_id = photo_albums.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));

drop policy if exists albums_delete on photo_albums;
create policy albums_delete on photo_albums for delete
using (exists (select 1 from family_members fm
               where fm.family_id = photo_albums.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'
                 and fm.role != 'viewer'));

-- ========== 18.2 baby_photos 加 album_id ==========
-- 为何不必新增 update 策略：小程序不支持 PATCH，更新一律走 upsert，
-- 而 baby_photos 的 update 策略（002 建、006 收紧为非 viewer）是对整行生效的，
-- 新列自动被覆盖。
alter table baby_photos
  add column if not exists album_id uuid references photo_albums(id) on delete set null;

create index if not exists idx_photos_family_baby_album
  on baby_photos(family_id, baby_id, album_id);
