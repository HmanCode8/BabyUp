/**
 * 选择 / 压缩图片。
 *
 * 优先用 uni.chooseMedia（可同时覆盖拍照与相册，微信端推荐），
 * 个别平台没有该 API 时退回 uni.chooseImage。
 */
import { ensurePrivacyAuthorized } from '@/utils/privacy'
import { PHOTO_MAX_COUNT, VIDEO_MAX_DURATION_SEC } from '@/config'

function pickPath(res) {
  if (res.tempFiles && res.tempFiles[0] && res.tempFiles[0].tempFilePath) {
    return res.tempFiles[0].tempFilePath
  }
  if (res.tempFilePaths && res.tempFilePaths[0]) return res.tempFilePaths[0]
  return ''
}

function pickPaths(res) {
  if (res.tempFiles && res.tempFiles.length) {
    return res.tempFiles.map((item) => item.tempFilePath).filter(Boolean)
  }
  if (res.tempFilePaths && res.tempFilePaths.length) {
    return res.tempFilePaths.filter(Boolean)
  }
  return []
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

/** 选择多张图片，返回本地临时路径数组；用户取消时返回空数组 */
export async function chooseImages(count = PHOTO_MAX_COUNT) {
  const allowed = await ensurePrivacyAuthorized()
  if (!allowed) throw new Error('需要同意隐私政策后才能选择图片')

  return new Promise((resolve, reject) => {
    const options = {
      count,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (res) => resolve(pickPaths(res)),
      fail: (err) => {
        if (isCancel(err)) {
          resolve([])
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

/**
 * 选择一段视频，返回 { path, posterPath, duration }；用户取消时返回 null。
 *
 * 为什么用 chooseMedia 而不是 chooseVideo：只有 chooseMedia 会顺带返回
 * thumbTempFilePath（视频首帧缩略图），列表页要靠它当封面。
 *
 * 注意：maxDuration 只约束「拍摄」时的录制长度，从相册挑老视频不受它限制，
 * 所以选完必须自己看 duration，超限与否由调用方决定怎么提示。
 */
export async function chooseVideo(maxDurationSec = VIDEO_MAX_DURATION_SEC) {
  const allowed = await ensurePrivacyAuthorized()
  if (!allowed) throw new Error('需要同意隐私政策后才能选择视频')

  return new Promise((resolve, reject) => {
    if (typeof uni.chooseMedia !== 'function') {
      reject(new Error('当前微信版本过低，请升级微信后再试'))
      return
    }
    uni.chooseMedia({
      count: 1,
      mediaType: ['video'],
      sourceType: ['album', 'camera'],
      maxDuration: maxDurationSec,
      camera: 'back',
      success: (res) => {
        const file = (res.tempFiles && res.tempFiles[0]) || null
        if (!file || !file.tempFilePath) {
          resolve(null)
          return
        }
        resolve({
          path: file.tempFilePath,
          posterPath: file.thumbTempFilePath || '',
          duration: Math.round(file.duration || 0),
        })
      },
      fail: (err) => {
        if (isCancel(err)) {
          resolve(null)
          return
        }
        console.error('[Media] 选择视频失败', err)
        reject(new Error('打开相册/相机失败，请检查权限'))
      },
    })
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

/** 压缩视频；平台不支持或压缩失败时退回原视频，保证上传不被阻断 */
export function compressVideo(src) {
  return new Promise((resolve) => {
    if (!src || typeof uni.compressVideo !== 'function') {
      resolve(src)
      return
    }
    uni.compressVideo({
      src,
      quality: 'medium',
      success: (res) => resolve(res.tempFilePath || src),
      fail: (err) => {
        console.warn('[Media] 视频压缩失败，改用原视频上传', err)
        resolve(src)
      },
    })
  })
}

/**
 * 把网络图片换成本地可绘制路径（canvas 的 drawImage 在部分平台不接受网络地址）。
 * getImageInfo 会顺带把图片下载到本地；取不到时返回空串，由调用方决定兜底画法。
 */
export function loadImage(src) {
  return new Promise((resolve) => {
    if (!src || typeof uni.getImageInfo !== 'function') {
      resolve('')
      return
    }
    uni.getImageInfo({
      src,
      success: (res) => resolve(res.path || ''),
      fail: (err) => {
        console.warn('[Media] 读取图片失败，改用兜底画法', err)
        resolve('')
      },
    })
  })
}

/**
 * 保存图片到相册；用户拒绝过授权时引导去设置页打开。
 *
 * 写入相册属于隐私接口，所以先确认隐私协议已同意。失败时抛出 Error，
 * 权限类失败已经在弹窗里引导过，调用方按 message === '未获得相册权限' 静默即可。
 */
export async function saveImageToAlbum(filePath) {
  const allowed = await ensurePrivacyAuthorized()
  if (!allowed) throw new Error('需要同意隐私政策后才能保存到相册')

  return new Promise((resolve, reject) => {
    uni.saveImageToPhotosAlbum({
      filePath,
      success: () => resolve(),
      fail: (err) => {
        const message = (err && err.errMsg) || ''
        console.error('[Media] 保存相册失败', err)
        if (/auth|deny|denied|permission/i.test(message)) {
          uni.showModal({
            title: '需要相册权限',
            content: '保存图片需要「保存到相册」权限，去设置里打开后即可保存',
            confirmText: '去设置',
            success: (res) => {
              if (res.confirm && typeof uni.openSetting === 'function') uni.openSetting()
            },
          })
          reject(new Error('未获得相册权限'))
          return
        }
        reject(new Error('保存失败，请重试'))
      },
    })
  })
}
