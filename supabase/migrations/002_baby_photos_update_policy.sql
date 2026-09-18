-- ============================================================================
-- 初芽（BabyUp）第一期 · 补丁 002
-- 为 baby_photos 补一条 update 策略
--
-- 背景：需求文档 4.4 只给出了 baby_photos 的 select / insert / delete 三条策略，
-- 但 5.1 要求「照片详情（看大图/编辑备注/删除）」，即需要更新备注。
-- 又因微信小程序不支持 PATCH，前端所有更新统一走 upsert
-- （POST + Prefer: resolution=merge-duplicates，即 INSERT ... ON CONFLICT DO UPDATE），
-- 该语句需要 INSERT 与 UPDATE 两条策略同时放行，因此这里补一条 update 策略。
-- 写法与需求文档中 babies / vaccinations 的更新策略保持一致。
-- ============================================================================

create policy photos_update on baby_photos for update
using (exists (select 1 from family_members fm
               where fm.family_id = baby_photos.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'))
with check (exists (select 1 from family_members fm
                    where fm.family_id = baby_photos.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'));
