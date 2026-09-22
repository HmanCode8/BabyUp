/**
 * 账号级数据操作（补丁 Step 3）：数据导出与账号注销。
 *
 * 两件事都必须用 service_role 才能做（跨表聚合 / 删 auth 用户），
 * 因此放在 Edge Function 里；前端只负责调用与结果展示，不接触任何密钥。
 * 页面只与本模块打交道，不直接拼函数名。
 */
import { DELETE_ACCOUNT_FUNCTION, EXPORT_DATA_FUNCTION } from '@/config'
import { api } from './api'

/**
 * 导出「我有权限的全部家庭」数据。
 * Edge Function 返回 { json: '<JSON 字符串>' }，这里直接把字符串交出去，
 * 由页面决定怎么写文件（小程序写沙箱文件、H5 触发下载）。
 */
export async function exportAllData() {
  const res = await api.functions.invoke(EXPORT_DATA_FUNCTION, {})
  const text = res && typeof res.json === 'string' ? res.json : ''
  if (!text) {
    throw new api.ApiError('导出失败，请稍后重试', 0, 'EXPORT_EMPTY', res)
  }
  return text
}

/**
 * 注销账号（破坏性，不可恢复）。
 *
 * @param {string} confirm 用户输入的确认词，必须严格等于「删除」二字；
 *                         这是双确认的第二道，缺省或写错服务端一律拒绝。
 * @returns {Promise<{ ok: boolean, deletedFamilies: number, removedFiles: number }>}
 */
export async function deleteAccount(confirm) {
  const res = await api.functions.invoke(DELETE_ACCOUNT_FUNCTION, { confirm })
  if (!res || !res.ok) {
    throw new api.ApiError('注销失败，请稍后重试', 0, 'DELETE_ACCOUNT_FAILED', res)
  }
  return res
}
