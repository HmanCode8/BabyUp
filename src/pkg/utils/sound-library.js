/**
 * 音源库（**安睡音、放映背景声、声音工坊共用**）。
 *
 * 为什么单独一个模块：这几处的音频曾经各管各的 —— 各存一个云存储目录、
 * 各写一份「下到本地再播」的逻辑。现在合并成一份：**同一份清单、同一个云存储目录、
 * 同一套解析与缓存**，页面只是各自渲染这份清单，不再有第二处真源。
 *
 * 清单由两部分拼成：
 *   1. **内置的 13 首**：素材是脚本合成的（`scripts/gen-audio.mjs`，
 *      公式在 `sound-gen.mjs`），产物归本项目，不碰任何第三方音乐 ——
 *      版权与「音乐类目」两条风险都靠这一点兜住；
 *   2. **自己存的**（声音工坊「存下来」的）：只记在**本机**（storage），
 *      因为那是这台手机主人的听感偏好，没必要跟账号走、也不该污染全家共享的清单。
 *
 * 文件名与清单里的 `file`、云存储里的路径、生成脚本的输出一一对应；
 * 改 key 等于让老用户存过的偏好失效。
 *
 * ⚠️ 素材放**云存储**（不进代码包）：单个分包有 2MB 上限，13 个 WAV 加起来 15MB+。
 */
import { ref } from 'vue'
import { CLOUD_FILE_ID_PREFIX } from '@/config'

/** 云存储里的目录名（内置音源与自定义音源都放这一个目录下） */
const SOUND_DIR = 'sleep-sound'

/**
 * 本机播放源模式覆盖（排查用，不用重新编译）。
 *
 * 在微信开发者工具的控制台里执行：
 *   wx.setStorageSync('babyup.soundSrc', 'cloud')   // 直接用云文件 ID 播
 *   wx.removeStorageSync('babyup.soundSrc')          // 回到默认的 local
 *
 * local（默认）：先下载到本地临时文件再播，循环时不用联网。
 *   ⚠️ 少数机型/iOS 版本对「后台音频播本地文件」支持不好，播不出来就切 cloud。
 * cloud：直接把云文件 ID 交给播放器，官方明确支持，但每次循环可能要重新加载。
 */
const SRC_MODE_KEY = 'babyup.soundSrc'

/** 自己存的音源记在本机的 key */
const CUSTOM_STORAGE_KEY = 'babyup.customSounds'
/** 最多留几条：storage 只放元数据，但列表太长页面也没法看 */
export const CUSTOM_LIMIT = 20

/**
 * 内置音源。desc 只管说听感，**刻意不出现「音乐 / 歌曲 / 曲库」这些词**（类目风险）。
 *
 * 前 3 个是宽带噪声（当「底色」最合适），中间 5 个是环境声，
 * 心跳与钟摆是节律，最后 3 个是有旋律的曲子 —— 需求原话就是「睡眠轻音乐 + 白噪音」。
 */
export const SOUNDS = [
  { key: 'white', name: '白噪音', desc: '均匀细密的沙沙声', file: 'white.wav' },
  { key: 'pink', name: '粉噪音', desc: '比白噪音柔和，像下雨天', file: 'pink.wav' },
  { key: 'brown', name: '棕噪音', desc: '低沉绵密，像远处的瀑布', file: 'brown.wav' },
  { key: 'rain', name: '雨声', desc: '稳定的雨点声', file: 'rain.wav' },
  { key: 'wave', name: '海浪', desc: '缓慢起伏的浪声', file: 'wave.wav' },
  { key: 'wind', name: '风', desc: '一阵一阵的呼呼声', file: 'wind.wav' },
  { key: 'stream', name: '溪流', desc: '细细的水声，很清亮', file: 'stream.wav' },
  { key: 'fan', name: '风扇', desc: '稳稳的转动声', file: 'fan.wav' },
  { key: 'heartbeat', name: '心跳', desc: '低频节律，像还在肚子里', file: 'heartbeat.wav' },
  { key: 'pendulum', name: '钟摆', desc: '一秒一下，像老座钟', file: 'pendulum.wav' },
  { key: 'lullaby', name: '摇篮曲', desc: '一句一句慢慢落下来', file: 'lullaby.wav' },
  { key: 'musicbox', name: '八音盒', desc: '轻轻的琶音，像在转的发条', file: 'musicbox.wav' },
  { key: 'starlight', name: '星光', desc: '很空很远，几乎不打扰', file: 'starlight.wav' },
]

/** 页面第一次打开、还没选过时高亮的那一个 */
export const DEFAULT_SOUND_KEY = 'rain'

/**
 * 自己存的音源（工坊「存下来」的）。
 * 形状：`{ key, name, desc, fileId, recipe, createdAt }` —— 存的是**完整 fileID**，
 * 因为上传时云存储已经把路径定好了，没必要再拼一次。
 */
export const customSounds = ref([])

/** 从本机读一遍自定义音源。页面 `onShow` 调它，保证回到页面时是最新的 */
export function loadCustomSounds() {
  try {
    const raw = uni.getStorageSync(CUSTOM_STORAGE_KEY)
    const saved = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : null
    customSounds.value = Array.isArray(saved) ? saved.filter((item) => item && item.key) : []
  } catch (err) {
    console.error('[Sound] 读取自己存的声音失败，按没有处理', err)
    customSounds.value = []
  }
  return customSounds.value
}

function persistCustomSounds(list) {
  try {
    uni.setStorageSync(CUSTOM_STORAGE_KEY, JSON.stringify(list))
  } catch (err) {
    console.error('[Sound] 保存自己存的声音失败', err)
  }
}

/** 新增一条；返回 true 表示存下了（超过上限会拒绝） */
export function addCustomSound(sound) {
  const list = customSounds.value.slice()
  if (list.length >= CUSTOM_LIMIT) return false
  list.unshift(sound)
  customSounds.value = list
  persistCustomSounds(list)
  return true
}

export function removeCustomSound(key) {
  const list = customSounds.value.filter((item) => item.key !== key)
  customSounds.value = list
  persistCustomSounds(list)
  return list
}

/** 全部可用音源：内置在前、自己存的在后 */
export function listSounds() {
  return SOUNDS.concat(customSounds.value)
}

export function findSound(key) {
  return listSounds().find((item) => item.key === key) || null
}

/** 是不是「自己存的」——删除时要用到 */
export function isCustomSound(key) {
  return customSounds.value.some((item) => item.key === key)
}

/** 云存储 fileID（形如 cloud://<环境ID>.<桶ID>/<路径>） */
export function fileIdOf(file) {
  return `cloud://${CLOUD_FILE_ID_PREFIX}${SOUND_DIR}/${file}`
}

/** 云存储这条路走不走得通（H5 / 非云开发后端下为 false） */
export function isCloudAudioReady() {
  // #ifdef MP-WEIXIN
  return Boolean(typeof wx !== 'undefined' && wx.cloud && wx.cloud.downloadFile)
  // #endif
  // #ifndef MP-WEIXIN
  return false
  // #endif
}

/** 已下载好的本地临时文件：key → 本地路径。整个会话共用一份 */
const localPaths = {}

function readSrcMode() {
  try {
    return uni.getStorageSync(SRC_MODE_KEY) === 'cloud' ? 'cloud' : 'local'
  } catch (err) {
    return 'local'
  }
}

/**
 * 解析出某个音源该交给播放器的 src。
 *
 * 内置音源拼出云文件 ID；自己存的直接用记录里的 fileId。
 * 默认先 `wx.cloud.downloadFile` 拉到本地临时文件（循环时不用再联网），
 * 同一个音源只下一次；下载失败就退回云文件 ID，至少还能播。
 */
export async function resolveSoundSrc(sound) {
  const cloudSrc = sound.fileId || fileIdOf(sound.file)
  if (readSrcMode() === 'cloud') return cloudSrc
  if (localPaths[sound.key]) return localPaths[sound.key]
  try {
    const res = await wx.cloud.downloadFile({ fileID: cloudSrc })
    if (res && res.tempFilePath) {
      localPaths[sound.key] = res.tempFilePath
      return res.tempFilePath
    }
  } catch (err) {
    console.error('[Sound] 下载音频失败，改用云文件直连', err)
  }
  return cloudSrc
}
