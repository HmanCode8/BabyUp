-- ============================================================================
-- 初芽（BabyUp）第一期 · 补丁 005
-- 为 growth_records 补一条 update 策略（支持"填错了能改"）
--
-- 背景：需求文档 4.4 只给出了 growth_records 的 select / insert / delete 三条策略。
-- 而实际使用中记录可能填错，需要能重新编辑保存；又因微信小程序不支持 PATCH，
-- 前端编辑统一走 upsert（POST + Prefer: resolution=merge-duplicates，
-- 即 INSERT ... ON CONFLICT DO UPDATE），该语句需要 INSERT 与 UPDATE 两条策略同时放行。
-- 判定条件与文档中 babies / vaccinations 的更新策略保持一致：仅本家庭成员。
--
-- 其余两张要支持编辑的表无需改动：
--   vaccinations 文档已带 vaccines_update 策略
--   families     文档已带 families_update 策略（仅 owner 可改，成员改不了家庭名）
-- ============================================================================

create policy growth_update on growth_records for update
using (exists (select 1 from family_members fm
               where fm.family_id = growth_records.family_id
                 and fm.user_id = auth.uid() and fm.status = 'active'))
with check (exists (select 1 from family_members fm
                    where fm.family_id = growth_records.family_id
                      and fm.user_id = auth.uid() and fm.status = 'active'));
