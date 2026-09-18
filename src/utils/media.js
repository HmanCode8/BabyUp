/**
 * 选择 / 压缩图片。
 *
 * 优先用 uni.chooseMedia（可同时覆盖拍照与相册，微信端推荐），
 * 个别平台没有该 API 时退回 uni.chooseImage。
 */
import { ensurePrivacyAuthorized } from '@/utils/privacy'

function pickPath(res) {
  if (res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath) {
    return res.tempFiles[0].tempFilePath
  }
  if (res.tempFilePaths && res.tempFilePaths[0]) return res.tempFilePaths[0]
  return ''
}

function isCancel(err) {
  return Boolean(err && /cancel/i.test(err.errMsg || ''))
}

/** 选择一张图片，返回本地临时路径；用户取消时返回空串 */
export async function chooseImage() {
  const allowed = await ensurePrivacyAuthorized()
  if (!allowed) throw new Error('需要同意隐私政策后才能选择图片')

  return new Promise((resolve, reject) => {
    const options = {
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => resolve(pickPath(res)),
      fail: (err) => {
        if (isCancel(err)) {
          resolve('')
          return
        }
        console.error('[Media] 选择图片失败', err)
        reject(new Error('打开相册/相机失败，请检查权限'))
      },
    }
    if (typeof uni.chooseMedia === 'function') {
      uni.chooseMedia({ ...options, mediaType: ['image'] })
    } else {
      uni.chooseImage(options)
    }
  })
}

/** 压缩图片；平台不支持或压缩失败时退回原图，保证上传不被阻断 */
export function compressImage(src) {
  return new Promise((resolve) => {
    if (!src || typeof uni.compressImage !== 'function') {
      resolve(src)
      return
    }
    uni.compressImage({
      src,
      quality: 80,
      success: (res) => resolve(res.tempFilePath || src),
      fail: (err) => {
        console.warn('[Media] 压缩失败，改用原图上传', err)
        resolve(src)
      },
    })
  })
}
