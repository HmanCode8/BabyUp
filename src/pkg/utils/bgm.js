/**
 * 放映页背景声播放器（**前台循环**）。
 *
 * 为什么不用 `wx.getBackgroundAudioManager()`（安睡音用的那个）：
 * 它是**全局单例**，设置 src 会把安睡音顶掉，反过来也一样；而且它会拉起锁屏媒体面板，
 * 进一步坐实「音乐播放器」的印象（类目风险）。放映页本来就是盯着屏幕看的场景，
 * 不需要后台播放，所以用 `wx.createInnerAudioContext()` —— 独立实例、
 * 自带 `loop` 与 `volume`，跟安睡音互不干扰。
 *
 * 代价：**息屏 / 切到别的应用就停**。页面在 `onHide` 里主动停，
 * 一来省电，二来不会出现「退出了还在响」。
 *
 * 音源清单与云存储解析都在 `sound-library.js` 里，与安睡音**共用同一份**；
 * 这里只管前台循环播放这一件事。
 *
 * ⚠️ 只在微信小程序端可用；H5 / Supabase 后端下创建失败时返回 null，页面隐藏入口。
 */
import { isCloudAudioReady, resolveSoundSrc } from './sound-library'

/** 默认音量。InnerAudioContext 有 volume，但用户侧键也能调，给一个偏轻的起点 */
const DEFAULT_VOLUME = 0.5

/** 这个环境能不能放背景声（H5 / 非云开发后端下恒为 false） */
export function isBgmSupported() {
  // #ifdef MP-WEIXIN
  return Boolean(
    typeof wx !== 'undefined' && typeof wx.createInnerAudioContext === 'function' && isCloudAudioReady(),
  )
  // #endif
  // #ifndef MP-WEIXIN
  return false
  // #endif
}

/**
 * 创建一个背景声播放器。
 *
 * @param {object} [params]
 * @param {(state: {playing: boolean, key: string, loading: boolean, error: string}) => void} [params.onChange]
 * @param {number} [params.volume] 0~1
 * @returns {object|null} 环境不支持时返回 null
 */
export function createBgmPlayer({ onChange, volume = DEFAULT_VOLUME } = {}) {
  if (!isBgmSupported()) return null

  /**
   * ⚠️ iOS 真机的坑：`innerAudioContext.obeyMuteSwitch = false` 这个**属性**在 iOS 上不生效 ——
   * 官方社区一手反馈：属性设了，手机打静音照样没声，把物理静音键关掉才有声。
   * 真正管用的是这个全局接口（默认 obeyMuteSwitch 是 true，所以必须显式关掉）。
   * 症状正好是「onPlay 正常触发、开发者工具 / 安卓正常，iOS 真机没声且不报错」。
   *
   * 必须放在 createInnerAudioContext 之前，保证设置作用到我们这个实例上。
   */
  try {
    wx.setInnerAudioOption({
      obeyMuteSwitch: false,
      fail: (err) => console.error('[SlideshowBgm] setInnerAudioOption 失败', err),
    })
  } catch (err) {
    console.error('[SlideshowBgm] setInnerAudioOption 调用异常', err)
  }

  const ctx = wx.createInnerAudioContext()
  ctx.loop = true
  ctx.volume = volume
  // 兜底：属性形式在 iOS 上不可靠，但设上无害
  ctx.obeyMuteSwitch = false
  /**
   * ⚠️ 真机上的坑：`ctx.src = ...` 之后立刻 `play()` 有时是**空操作** ——
   * 开发者工具（模拟器）里正常出声，一到手机就没声，且不报错。这是 InnerAudioContext
   * 有名的时序问题。开 autoplay 让播放器自己等加载好再起播，不依赖我们调 play() 的时机。
   */
  ctx.autoplay = true

  let currentKey = ''
  let playing = false
  let loading = false
  let error = ''
  /** 用户是不是希望它在响；onCanplay 据此决定要不要再补一次 play() */
  let wantPlay = false

  function notify() {
    if (typeof onChange !== 'function') return
    onChange({ playing, key: currentKey, loading, error })
  }

  // 第二道保险：播放器报告「可以播了」时，若我们想放而它还没动，就再推一次
  ctx.onCanplay(() => {
    if (wantPlay && ctx.paused) ctx.play()
  })

  ctx.onPlay(() => {
    playing = true
    loading = false
    error = ''
    notify()
  })

  ctx.onPause(() => {
    playing = false
    notify()
  })

  ctx.onStop(() => {
    playing = false
    notify()
  })

  ctx.onError((err) => {
    console.error('[SlideshowBgm] 播放出错', err)
    playing = false
    loading = false
    error = '背景声播放失败'
    notify()
  })

  return {
    get current() {
      return currentKey
    },
    get playing() {
      return playing
    },

    /** 切到某一首并开始播放 */
    async play(sound) {
      if (!sound) return false
      loading = true
      error = ''
      currentKey = sound.key
      wantPlay = true
      notify()

      const src = await resolveSoundSrc(sound)
      // 等下载的这段时间里用户可能已经切走 / 关掉了
      if (currentKey !== sound.key) return false
      ctx.src = src
      ctx.play()
      return true
    },

    pause() {
      playing = false
      loading = false
      wantPlay = false
      try {
        ctx.pause()
      } catch (err) {
        console.error('[SlideshowBgm] 暂停失败', err)
      }
      notify()
    },

    /** 退出页面时调用：销毁实例，否则会一直占着一个音频池 */
    destroy() {
      wantPlay = false
      try {
        ctx.destroy()
      } catch (err) {
        console.error('[SlideshowBgm] 销毁失败', err)
      }
    },
  }
}
