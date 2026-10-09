/**
 * 安睡音播放器（**后台播放**）。
 *
 * 为什么是后台播放：小程序的音频绑在页面上，屏幕一黑、退到后台就会被系统挂起。
 * 要让「放一晚上」成立，只能用 `wx.getBackgroundAudioManager()` ——
 * WebAudio 与 `InnerAudioContext` 都做不到。
 *
 * 代价（官方 API 就是这么定的，绕不过去）：
 * 1. **没有 `volume`** —— 音量只能靠手机音量键，页面上的音量滑块已去掉；
 * 2. **没有 `loop`** —— 靠 `onEnded` 里 `seek(0)` 接上，1.2 秒还没播就重设 src 兜底；
 * 3. **必须填元数据** —— `title` 等不填 iOS 不给播；副作用是锁屏会出现媒体面板。
 *
 * 音源清单与「云存储下载 + 本地缓存」都在 `sound-library.js` 里，
 * 与放映背景声（`bgm.js`）**共用同一份**，这里只管后台播放这一件事。
 *
 * ⚠️ 只在微信小程序端可用；H5 / Supabase 后端下返回 false，页面显示兜底提示。
 */
import { fileIdOf, isCloudAudioReady, resolveSoundSrc } from './sound-library'

/** 续播兜底计时器：seek(0)+play() 没生效时改成重设 src（毫秒） */
const LOOP_RETRY_MS = 1200
/** 换音源守卫的最长存活时间（毫秒） */
const SWITCH_GUARD_MS = 3000
/** 新轨 onPlay 之后，守卫再多留一会儿，用来吞掉旧轨迟到的 onStop（毫秒） */
const SWITCH_SETTLE_MS = 800

/** 这个环境能不能后台播放（H5 / 非云开发后端下恒为 false） */
export function isSleepSoundSupported() {
  // #ifdef MP-WEIXIN
  return Boolean(
    typeof wx !== 'undefined' && typeof wx.getBackgroundAudioManager === 'function' && isCloudAudioReady(),
  )
  // #endif
  // #ifndef MP-WEIXIN
  return false
  // #endif
}

/**
 * 创建一个安睡音播放器。
 *
 * @param {object} [params]
 * @param {(state: {playing: boolean, key: string, loading: boolean, error: string}) => void} [params.onChange]
 *        状态变化回调。**必须挂**：用户可能在锁屏的媒体面板上直接暂停/播放，
 *        那样页面是收不到点击的，只能靠系统事件回传。
 * @returns {object|null} 环境不支持时返回 null
 */
export function createSleepPlayer({ onChange } = {}) {
  if (!isSleepSoundSupported()) return null

  const manager = wx.getBackgroundAudioManager()

  let currentKey = ''
  /** 用户是不是「想要在放」：用来区分「播完了该续播」和「用户主动停的」 */
  let wantPlaying = false
  let loading = false
  let error = ''
  /** 正在用的 src（循环时要用它兜底重播） */
  let activeSrc = ''
  /** 续播兜底计时器 */
  let loopTimer = 0
  /**
   * 正在「换音源」的窗口。
   *
   * ⚠️ 换 src 时，微信会为**上一首**补发一次 onStop / onPause。那不是用户想停，
   * 只是换轨的副作用。不把这段时间挡掉的话，wantPlaying 会被置回 false：
   * 表现就是「切到下一个声音，有时候选中状态没了」（踩过）。
   */
  let switching = false
  let switchTimer = 0
  /** 封面图的签名地址，取一次就够（一次会话内有效） */
  let coverUrl = ''

  function notify() {
    if (typeof onChange !== 'function') return
    // 只用「想不想放」：换轨时 manager.paused 会短暂为 true，
    // 拿它做与运算会让页面上的选中高亮闪一下（踩过）
    onChange({ playing: wantPlaying, key: currentKey, loading, error })
  }

  function clearLoopTimer() {
    if (loopTimer) {
      clearTimeout(loopTimer)
      loopTimer = 0
    }
  }

  /** 重设守卫自动解除的时限 */
  function armSwitch(ms) {
    if (switchTimer) clearTimeout(switchTimer)
    switchTimer = setTimeout(() => {
      switching = false
      switchTimer = 0
    }, ms)
  }

  function beginSwitch() {
    switching = true
    armSwitch(SWITCH_GUARD_MS)
  }

  function endSwitch() {
    switching = false
    if (switchTimer) {
      clearTimeout(switchTimer)
      switchTimer = 0
    }
  }

  /** 拿封面图的临时地址（拿不到就算了，不挡播放） */
  async function ensureCover() {
    if (coverUrl) return coverUrl
    try {
      const res = await wx.cloud.getTempFileURL({ fileList: [fileIdOf('cover.png')] })
      const first = res && res.fileList && res.fileList[0]
      if (first && first.tempFileURL) coverUrl = first.tempFileURL
    } catch (err) {
      console.error('[SleepSound] 取封面图地址失败，锁屏不显示封面', err)
    }
    return coverUrl
  }

  /** 真正把 src 交给播放器（设置 src 会自动开始播放） */
  function applySrc(src, sound) {
    activeSrc = src
    manager.title = sound.name
    manager.epname = '宝宝安睡音'
    manager.singer = '书遥贝贝'
    if (coverUrl) manager.coverImgUrl = coverUrl
    manager.src = src
  }

  manager.onPlay(() => {
    // 不能立刻 endSwitch：新轨的 onPlay 可能先于旧轨的 onStop 到达，
    // 提前解除守卫会让迟到的 onStop 又被当成「用户停了」。留一小段宽限期。
    if (switching) armSwitch(SWITCH_SETTLE_MS)
    loading = false
    error = ''
    notify()
  })

  manager.onPause(() => {
    // 换音源途中的暂停是副作用，不是用户想停
    if (switching) return
    wantPlaying = false
    notify()
  })

  manager.onStop(() => {
    if (switching) return
    wantPlaying = false
    notify()
  })

  manager.onEnded(() => {
    if (!wantPlaying) return
    // 一级兜底：回到 0 秒接着播（不重新加载文件，接缝最短）
    try {
      manager.seek(0)
      manager.play()
    } catch (err) {
      console.error('[SleepSound] seek(0) 续播失败，改为重设 src', err)
    }
    // 二级兜底：1.2 秒后还没开始播，就把 src 重设一遍（会重新加载，但能保证不停）
    clearLoopTimer()
    loopTimer = setTimeout(() => {
      loopTimer = 0
      if (wantPlaying && manager.paused && activeSrc) {
        console.warn('[SleepSound] seek(0) 未生效，重设 src 续播')
        manager.src = activeSrc
      }
    }, LOOP_RETRY_MS)
  })

  manager.onError((err) => {
    console.error('[SleepSound] 后台播放出错', err)
    endSwitch()
    loading = false
    error = '播放失败，请检查网络或稍后重试'
    wantPlaying = false
    notify()
  })

  return {
    get current() {
      return currentKey
    },
    get playing() {
      // 用「想不想放」而不是 manager.paused：换轨时 paused 会短暂抖动，
      // 界面（选中高亮、按钮文案）跟着抖会像「点了没反应」
      return wantPlaying
    },

    /** 切到某个音源并开始播放 */
    async play(sound) {
      if (!sound) return false
      clearLoopTimer()
      loading = true
      error = ''
      wantPlaying = true
      currentKey = sound.key
      notify()

      await ensureCover()
      const src = await resolveSoundSrc(sound)
      // 等下载的这段时间里用户可能已经切走 / 停掉了
      if (!wantPlaying || currentKey !== sound.key) return false
      beginSwitch()
      applySrc(src, sound)
      return true
    },

    pause() {
      clearLoopTimer()
      endSwitch()
      wantPlaying = false
      loading = false
      try {
        manager.pause()
      } catch (err) {
        console.error('[SleepSound] 暂停失败', err)
      }
      notify()
    },
  }
}
