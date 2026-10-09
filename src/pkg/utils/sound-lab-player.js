/**
 * 声音工坊的**实时播放器**（WebAudio，前台）。
 *
 * 为什么用 `wx.createWebAudioContext()` 而不是另外两个：
 * 安睡音要息屏，只能用能播真实文件的 `BackgroundAudioManager`；
 * `InnerAudioContext` 也只能播文件或 URL。而工坊要的是「改一个条件马上听到变化」——
 * 只有 WebAudio 能在**内存里**现算出样本、`loop` 循环播放，零文件、零上传。
 *
 * 代价（必须说清楚）：**息屏 / 切到别的应用就停**，因为小程序的前台音频会被系统挂起。
 * 所以工坊的定位是「调音台 + 试听」；满意之后要靠「存下来」（生成 WAV 传云存储）
 * 才能拿到息屏播放的能力。
 *
 * 合成公式全在 `sound-gen.mjs`，这里只管「算成 AudioBuffer、接上播放设备、换曲」。
 *
 * ⚠️ 只在微信小程序端可用（基础库 ≥ 2.19.0）；其余环境返回 null，页面走降级提示。
 */
import { LAB_SECONDS, renderRecipe } from './sound-gen.mjs'

/** 默认音量。前端调不了系统音量，给一个偏轻的起点 */
export const DEFAULT_VOLUME = 0.6

/** 这个环境支不支持实时合成 */
export function isSoundLabSupported() {
  // #ifdef MP-WEIXIN
  return Boolean(typeof wx !== 'undefined' && typeof wx.createWebAudioContext === 'function')
  // #endif
  // #ifndef MP-WEIXIN
  return false
  // #endif
}

/**
 * 创建一个工坊播放器。
 *
 * @param {object} [params]
 * @param {(state: {playing: boolean, loading: boolean, error: string}) => void} [params.onChange]
 * @param {number} [params.volume] 0~1
 * @returns {object|null} 环境不支持时返回 null
 */
export function createLabPlayer({ onChange, volume = DEFAULT_VOLUME } = {}) {
  if (!isSoundLabSupported()) return null

  const ctx = wx.createWebAudioContext()
  const gain = ctx.createGain()
  gain.gain.value = volume
  gain.connect(ctx.destination)

  /** 当前正在响的那个源；换配方时要先把它停掉，否则会叠着响 */
  let source = null
  let playing = false
  let loading = false
  let error = ''
  let currentVolume = volume
  /** 每次 start 递增，用来丢弃「算到一半就被新的一次顶掉」的旧结果 */
  let token = 0

  function notify() {
    if (typeof onChange !== 'function') return
    onChange({ playing, loading, error })
  }

  function stopSource() {
    if (!source) return
    try {
      source.stop()
    } catch (err) {
      console.error('[SoundLab] 停止旧音源失败', err)
    }
    try {
      source.disconnect()
    } catch (err) {
      // 已经断开也没关系
    }
    source = null
  }

  /** 按配方算出 AudioBuffer */
  function buildBuffer(recipe) {
    const samples = renderRecipe(recipe, { sampleRate: ctx.sampleRate, seconds: LAB_SECONDS })
    const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate)
    buffer.getChannelData(0).set(samples)
    return buffer
  }

  return {
    get playing() {
      return playing
    },
    get loading() {
      return loading
    },
    get volume() {
      return currentVolume
    },

    setVolume(value) {
      currentVolume = value
      try {
        gain.gain.value = value
      } catch (err) {
        console.error('[SoundLab] 设置音量失败', err)
      }
    },

    /**
     * 用新配方开始（或换成）播放。
     *
     * 合成是同步的 CPU 活，先让出一帧再算 —— 否则「生成中」这三个字根本没机会画出来。
     */
    start(recipe) {
      token += 1
      const mine = token
      loading = true
      error = ''
      notify()

      setTimeout(() => {
        // 已经被后一次 start 顶掉了（用户连着改了好几个条件）
        if (mine !== token) return
        try {
          const buffer = buildBuffer(recipe)
          if (mine !== token) return
          // 上下文偶尔会以 suspended 起来（比如被系统中断过），不恢复就没声音
          try {
            if (ctx.state === 'suspended') ctx.resume()
          } catch (err) {
            console.error('[SoundLab] 恢复音频上下文失败', err)
          }
          stopSource()
          const node = ctx.createBufferSource()
          node.buffer = buffer
          node.loop = true
          node.connect(gain)
          node.start()
          source = node
          playing = true
        } catch (err) {
          console.error('[SoundLab] 合成或播放失败', err)
          playing = false
          error = '声音准备失败，换个组合试试'
        } finally {
          if (mine === token) {
            loading = false
            notify()
          }
        }
      }, 0)
    },

    stop() {
      token += 1
      stopSource()
      playing = false
      loading = false
      notify()
    },

    /** 退出页面时调用：关掉上下文，否则会一直占着音频设备 */
    destroy() {
      token += 1
      stopSource()
      try {
        ctx.close()
      } catch (err) {
        console.error('[SoundLab] 关闭音频上下文失败', err)
      }
    },
  }
}
