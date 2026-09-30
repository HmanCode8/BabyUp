/**
 * 广告位（云开发版）。
 *
 * 配置存在 app_config 集合的 `ads` 文档里（读写见 cloudfunctions/data 的
 * actionAdsConfig / actionAdminAds / actionAdminSetAds），只有超管能在运维后台改。
 *
 * Supabase 版没有这套东西，所以本文件只在 cloud 侧存在，
 * 业务层通过 capabilities.ads 判断可用性（见 @/services/ads）。
 */
import { callData } from './db'

/**
 * 当前广告位配置。
 * 没配过 / 读失败时服务端也会回 `{ enabled: false, bannerUnitId: '' }`，
 * 调用方不需要再兜一层。
 */
export async function status() {
  return callData({ action: 'adsConfig' })
}

export const ads = { status }

export default ads
