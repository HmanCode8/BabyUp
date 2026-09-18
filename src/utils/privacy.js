/**
 * 微信小程序用户隐私保护授权。
 *
 * 背景：2023-10-17 起微信强制启用隐私相关功能，凡是在《小程序用户隐私保护指引》
 * 中未声明的隐私接口一律直接禁用（errno 112 api scope is not declared）。
 * 本项目用到的隐私接口（对应后台需声明的信息类型）：
 *   - uni.chooseMedia / uni.chooseImage →「收集你选中的照片或视频信息」
 *   - uni.saveImageToPhotosAlbum       →「使用你的相册（仅写入）权限」
 *   - uni.setClipboardData             →「读取你的剪切板」
 *
 * 本项目没有注册 wx.onNeedPrivacyAuthorization，因此调用 wx.requirePrivacyAuthorize
 * 会走微信官方隐私弹窗（用户首次触发时弹出），无需自建弹窗 UI。
 * 详见 https://developers.weixin.qq.com/miniprogram/dev/framework/user-privacy/PrivacyAuthorize.html
 */

/** 基础库 < 2.32.3 时不存在这些接口，此时微信不拦截隐私接口，直接放行 */
function isPrivacyCheckAvailable() {
  return typeof wx !== 'undefined' && typeof wx.getPrivacySetting === 'function'
}

/**
 * 确保用户已同意隐私协议后再调用隐私接口。
 * @returns {Promise<boolean>} true = 可以继续调用；false = 用户拒绝或查询失败
 */
export function ensurePrivacyAuthorized() {
  if (!isPrivacyCheckAvailable()) return Promise.resolve(true)

  return new Promise((resolve) => {
    wx.getPrivacySetting({
      success: (res) => {
        // needAuthorization 为 false 表示用户已经同意过，可直接调用
        if (!res || !res.needAuthorization) {
          resolve(true)
          return
        }
        if (typeof wx.requirePrivacyAuthorize !== 'function') {
          resolve(true)
          return
        }
        // 模拟一次隐私接口调用，触发微信官方隐私弹窗
        wx.requirePrivacyAuthorize({
          success: () => resolve(true),
          fail: (err) => {
            console.warn('[Privacy] 用户未同意隐私协议', err)
            resolve(false)
          },
        })
      },
      fail: (err) => {
        // 查询失败按放行处理，避免因平台异常阻断正常功能
        console.warn('[Privacy] 查询隐私授权状态失败', err)
        resolve(true)
      },
    })
  })
}
