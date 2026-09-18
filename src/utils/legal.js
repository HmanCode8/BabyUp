/**
 * 合规确认（补丁 Step 2）。
 *
 * 只把「已同意的协议版本」记在本地：
 * - 协议文案更新后，改 config 里的 LEGAL_VERSION，老用户会重新看到确认弹层；
 * - 记录不分账号（登录前就要确认，此时还不知道用户是谁），
 *   同一台设备同意过一次就不再打扰。
 */
import { LEGAL_CONSENT_STORAGE_KEY, LEGAL_VERSION } from '@/config'

/** 当前设备是否已同意当前版本的协议 */
export function hasAgreedLegal() {
  try {
    return uni.getStorageSync(LEGAL_CONSENT_STORAGE_KEY) === LEGAL_VERSION
  } catch (err) {
    console.error('[Legal] 读取合规确认记录失败', err)
    return false
  }
}

/** 记录「已同意当前版本协议」 */
export function markLegalAgreed() {
  try {
    uni.setStorageSync(LEGAL_CONSENT_STORAGE_KEY, LEGAL_VERSION)
  } catch (err) {
    console.error('[Legal] 保存合规确认记录失败', err)
  }
}
