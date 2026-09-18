-- ============================================================================
-- 初芽（BabyUp）第一期 · 补丁 004
-- 为 storage.objects 补一条 update 策略
--
-- 背景：需求文档 4.5 只给出了照片桶的 read / insert / delete 三条策略。
-- 而宝宝头像路径固定为 {family_id}/{baby_id}/avatar.jpg，换头像时前端会带
-- x-upsert: true 覆盖同一路径，Storage 此时执行的是 UPDATE，
-- 因缺少 update 策略被拒，表现为「第一次能存、之后再改头像必失败」：
--   POST /storage/v1/object/baby-photos/{family}/{baby}/avatar.jpg -> HTTP 400
--   {"statusCode":"403","error":"Unauthorized","message":"new row violates row-level security policy"}
--
-- 修复方式与文档中 baby_photos 的写法保持一致：只放行本家庭成员。
-- （照片表自身的同类问题已在补丁 002 修掉。）
-- ============================================================================

create policy photos_storage_update on storage.objects for update
using (
  bucket_id = 'baby-photos'
  and exists (
    select 1 from family_members fm
    where fm.family_id = (storage.foldername(name))[1]::uuid
      and fm.user_id = auth.uid()
      and fm.status = 'active'
  )
)
with check (
  bucket_id = 'baby-photos'
  and exists (
    select 1 from family_members fm
    where fm.family_id = (storage.foldername(name))[1]::uuid
      and fm.user_id = auth.uid()
      and fm.status = 'active'
  )
);
