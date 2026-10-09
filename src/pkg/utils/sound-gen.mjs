/**
 * 声音合成（**唯一实现**）。
 *
 * 这里放的是纯计算：给一组参数，算出 Float32Array 样本、或一段 WAV 字节。
 * 不碰 `wx` / `uni` / Node 的任何 API，所以两边都能用：
 *   - **端上实时**：`sound-lab-player.js` 拿它算 AudioBuffer，改参数立刻重算重放；
 *   - **离线生成**：`scripts/gen-audio.mjs` 拿它跑出固定的 WAV 传云存储。
 * 公式只写这一份 —— 以前生成脚本和端上各存一套，改一处漏一处。
 *
 * 三类用法：
 *   - `renderNoise(kind, opts)`   单个固定环境音（`SOUNDS` 里的前 6 个）
 *   - `renderMelody(kind, opts)`  单个固定旋律（`SOUNDS` 里的后 3 个）
 *   - `renderRecipe(recipe, opts)` 安睡音工坊那种「几层叠加」的配方
 *   - `toWavBytes(samples, sampleRate)` 写成 16-bit 单声道 WAV
 *
 * 无缝循环的两种做法（都在这儿）：
 *   1. **交叉淡化**：多算一小段尾巴，叠回开头再截断。用于噪声（无周期性）。
 *   2. **周期对齐**：让所有起伏的周期正好整除循环长度，再让**音符余韵绕回开头**
 *      （越界采样 `% len`）。用于旋律与配方 —— 交叉淡化会把音符尾巴抹掉。
 */

/* ===========================================================================
 * 一、环境音（噪声类）
 * ========================================================================= */

/** 固定环境音用 16kHz：噪声能量主要在中低频，够用且文件只有 22.05k 的 73% */
export const NOISE_SAMPLE_RATE = 16000
/** 固定环境音的时长（秒） */
export const NOISE_SECONDS = 30
/** 交叉淡化时长（秒） */
export const SEAM_FADE_SECONDS = 0.5
/** 目标响度（RMS） */
export const TARGET_RMS = 0.18
/** 放大上限：心跳这类「大部分是静音」的波形别被放太狠 */
const MAX_GAIN = 8

/** 可作为「底色」的宽带噪声（其余是特征层，见 `LAYER_OPTIONS`） */
export const NOISE_KINDS = [
  'white',
  'pink',
  'brown',
  'rain',
  'wave',
  'heartbeat',
  'wind',
  'stream',
  'fan',
  'pendulum',
]

function fillWhite(data, n) {
  for (let i = 0; i < n; i += 1) data[i] = Math.random() * 2 - 1
}

/** 粉噪音：Paul Kellet 近似（-3dB/倍频程） */
function fillPink(data, n) {
  let b0 = 0
  let b1 = 0
  let b2 = 0
  let b3 = 0
  let b4 = 0
  let b5 = 0
  let b6 = 0
  for (let i = 0; i < n; i += 1) {
    const white = Math.random() * 2 - 1
    b0 = 0.99886 * b0 + white * 0.0555179
    b1 = 0.99332 * b1 + white * 0.0750759
    b2 = 0.969 * b2 + white * 0.153852
    b3 = 0.8665 * b3 + white * 0.3104856
    b4 = 0.55 * b4 + white * 0.5329522
    b5 = -0.7616 * b5 - white * 0.016898
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11
    b6 = white * 0.115926
  }
}

/** 棕噪音：带泄漏的积分（-6dB/倍频程） */
function fillBrown(data, n) {
  let last = 0
  for (let i = 0; i < n; i += 1) {
    const white = Math.random() * 2 - 1
    last = (last + 0.02 * white) / 1.02
    data[i] = last * 3.5
  }
}

/** 雨声：低通底噪 + 高通残差（雨点颗粒）+ 强度起伏 */
function fillRain(data, n, sampleRate, loopSeconds) {
  let low = 0
  const wobblePeriod = sampleRate * (loopSeconds || 9)
  for (let i = 0; i < n; i += 1) {
    const white = Math.random() * 2 - 1
    low += 0.15 * (white - low)
    const hiss = white - low
    const wobble = 0.85 + 0.15 * Math.sin((2 * Math.PI * i) / wobblePeriod)
    data[i] = (low * 0.5 + hiss * 0.35) * wobble
  }
}

/** 海浪：棕噪音 × 往复包络 + 一点高频当浪花 */
function fillWave(data, n, sampleRate, loopSeconds) {
  let last = 0
  const period = sampleRate * (loopSeconds || 7)
  for (let i = 0; i < n; i += 1) {
    const white = Math.random() * 2 - 1
    last = (last + 0.02 * white) / 1.02
    const s = Math.sin((Math.PI * i) / period)
    const env = 0.35 + 0.65 * Math.pow(s * s, 1.5)
    data[i] = last * 3 * env + white * 0.06 * env
  }
}

function addThump(data, start, sampleRate, freq, duration, amp) {
  const len = Math.floor(duration * sampleRate)
  for (let i = 0; i < len; i += 1) {
    const index = start + i
    if (index >= data.length) return
    const t = i / sampleRate
    data[index] += Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 14) * amp
  }
}

/** 心跳：1 秒一拍、每拍两下（lub 低而重、dub 略高略轻） */
function fillHeartbeat(data, n, sampleRate) {
  const beats = Math.floor(n / sampleRate)
  for (let b = 0; b < beats; b += 1) {
    const base = b * sampleRate
    addThump(data, base, sampleRate, 52, 0.22, 1)
    addThump(data, base + Math.floor(0.3 * sampleRate), sampleRate, 42, 0.2, 0.7)
  }
}

/**
 * 风：极低频的「呼呼」底噪 + 阵风包络。
 * 包络周期取 `loopSeconds`，所以循环点上阵风是接得上的。
 */
function fillWind(data, n, sampleRate, loopSeconds) {
  let low = 0
  let mid = 0
  const period = sampleRate * (loopSeconds || 15)
  for (let i = 0; i < n; i += 1) {
    const white = Math.random() * 2 - 1
    low = (low + 0.012 * white) / 1.012
    mid += 0.16 * (white - mid)
    const gust = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.sin((2 * Math.PI * i) / period), 1.3)
    data[i] = (low * 5 + mid * 0.45) * gust
  }
}

/** 溪流：高通残差（明亮、连续）+ 一点点点缀，比雨声更「细碎」 */
function fillStream(data, n, sampleRate, loopSeconds) {
  let high = 0
  const period = sampleRate * (loopSeconds || 10)
  for (let i = 0; i < n; i += 1) {
    const white = Math.random() * 2 - 1
    high += 0.5 * (white - high)
    const grit = white - high
    const flow = 0.9 + 0.1 * Math.sin((2 * Math.PI * i) / period)
    data[i] = (grit * 0.62 + white * 0.1) * flow
  }
}

/**
 * 风扇：宽带底噪 + 叶片扫过的周期性起伏。
 * 叶片频率固定 14 转/秒，能整除 12 秒与 30 秒，所以循环点不会「多转半圈」。
 */
function fillFan(data, n, sampleRate) {
  let low = 0
  const bladePeriod = sampleRate / 14
  for (let i = 0; i < n; i += 1) {
    const white = Math.random() * 2 - 1
    low += 0.1 * (white - low)
    const blade = 0.85 + 0.15 * Math.sin((2 * Math.PI * i) / bladePeriod)
    data[i] = (low * 2.4 + white * 0.16) * blade
  }
}

/**
 * 钟摆：每秒一记柔和的「嗒」，像老座钟。
 *
 * ⚠️ 这里刻意做成「一秒一下、衰减慢（半秒左右）」而不是「两秒一下、极短」：
 * 后者 96% 的时间是静音，为了把平均响度抬到和其他素材一样，增益会把那一记推到削平
 * （实测峰值顶到 1.0 被削平），而加了峰值上限后它的 RMS 只剩 0.04 —— 单独播放等于没声音。
 * 拉长驻留时间，峰值和响度才能同时站得住。
 * 1 秒正好整除 12 秒与 30 秒，循环点不会「多响一下」。
 */
function fillPendulum(data, n, sampleRate) {
  const period = sampleRate
  const ticks = Math.floor(n / period) + 1
  for (let k = 0; k < ticks; k += 1) {
    const start = Math.round(k * period)
    const len = Math.floor(0.6 * sampleRate)
    for (let i = 0; i < len; i += 1) {
      const idx = start + i
      if (idx >= data.length) break
      const t = i / sampleRate
      // 5ms 起音：直接给正弦的 0 相位会在开头堆出一个很高的尖峰
      const env = Math.min(1, t / 0.005) * Math.exp(-t * 7)
      const s = Math.sin(2 * Math.PI * 620 * t) * 0.62 + Math.sin(2 * Math.PI * 930 * t) * 0.24
      data[idx] += s * env
    }
  }
}

const NOISE_FILLS = {
  white: fillWhite,
  pink: fillPink,
  brown: fillBrown,
  rain: fillRain,
  wave: fillWave,
  heartbeat: fillHeartbeat,
  wind: fillWind,
  stream: fillStream,
  fan: fillFan,
  pendulum: fillPendulum,
}

/**
 * 合成一段可无缝循环的噪声。
 *
 * @param {string} kind NOISE_KINDS 里的一个
 * @param {object} opts
 * @param {number} opts.sampleRate
 * @param {number} opts.seconds
 * @param {number} [opts.seamFade] 交叉淡化时长（秒）
 * @param {number} [opts.loopSeconds] 内部起伏的周期基准；传了就能让起伏也整除循环长度
 * @param {number} [opts.gain] 相对强度
 * @returns {Float32Array}
 */
export function renderNoise(kind, opts) {
  const fill = NOISE_FILLS[kind]
  if (!fill) throw new Error(`未知的环境音：${kind}`)
  const sampleRate = opts.sampleRate
  const len = Math.floor(sampleRate * opts.seconds)
  const fade = Math.floor(sampleRate * (opts.seamFade == null ? SEAM_FADE_SECONDS : opts.seamFade))
  const gain = opts.gain == null ? 1 : opts.gain
  const raw = new Float32Array(len + fade)
  fill(raw, len + fade, sampleRate, opts.loopSeconds)

  const out = new Float32Array(len)
  for (let i = 0; i < len; i += 1) out[i] = raw[i]
  for (let i = 0; i < fade; i += 1) {
    const t = i / fade
    out[i] = raw[i] * t + raw[len + i] * (1 - t)
  }
  for (let i = 0; i < len; i += 1) out[i] *= gain
  return out
}

/** 归一化到目标峰值，再硬限幅兜底（避免任何越界采样爆音） */
export function normalizePeak(samples, targetPeak) {
  let peak = 0
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.abs(samples[i])
    if (v > peak) peak = v
  }
  const gain = peak > 0 ? targetPeak / peak : 0
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i] * gain
    samples[i] = v > 1 ? 1 : v < -1 ? -1 : v
  }
  return samples
}

/**
 * 归一化到目标响度（RMS），用于噪声。
 *
 * ⚠️ 光按 RMS 归一是不够的：心跳、钟摆这类「大部分是静音、偶尔一下很响」的波形，
 * 为了把平均响度抬到目标，增益会把那一下推到削平（实测心跳有 899 个样本被削平）。
 * 所以再加一道**峰值上限** —— 有尖峰的素材就整体轻一点，也不能爆。
 */
export function normalizeRms(samples, targetRms, peakLimit = 0.95) {
  let sum = 0
  let peak = 0
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i]
    sum += v * v
    const a = v < 0 ? -v : v
    if (a > peak) peak = a
  }
  const rms = Math.sqrt(sum / samples.length)
  let gain = rms > 0 ? Math.min(targetRms / rms, MAX_GAIN) : 0
  if (peak > 0) gain = Math.min(gain, peakLimit / peak)
  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i] * gain
    samples[i] = v > 1 ? 1 : v < -1 ? -1 : v
  }
  return samples
}

/* ===========================================================================
 * 二、旋律（八音盒音色 + 五声音阶）
 * ========================================================================= */

/** 旋律用 22.05kHz：八音盒的泛音能上好几 kHz，16k 会明显发闷 */
export const MELODY_SAMPLE_RATE = 22050
/** 固定旋律的速度与长度：72 BPM、8 小节 */
export const MELODY_BPM = 72
export const MELODY_BEATS = 32
export const MELODY_KINDS = ['lullaby', 'musicbox', 'starlight']

/** 用到的音（C 大调五声音阶为主，怎么排都不会太难听） */
const N = {
  G2: 98.0,
  A2: 110.0,
  C3: 130.81,
  E3: 164.81,
  G3: 196.0,
  A3: 220.0,
  C4: 261.63,
  D4: 293.66,
  E4: 329.63,
  G4: 392.0,
  A4: 440.0,
  C5: 523.25,
  D5: 587.33,
  E5: 659.25,
  G5: 783.99,
  A5: 880.0,
  C6: 1046.5,
  D6: 1174.66,
}

/**
 * 一个「八音盒 / 钢片琴」音色的音符：基频 + 几个泛音，指数衰减。
 *
 * 余韵（tail）会超出音符本身的时值，越界的部分靠 `% len` 绕回缓冲区开头 ——
 * 这既是「循环点连续」的关键，也让贴在末尾的音符听起来是自然收尾而不是被切断。
 */
function addBell(buf, freq, startBeat, durBeats, amp, sampleRate, beat, len) {
  const start = Math.round(startBeat * beat * sampleRate)
  const total = Math.round(durBeats * beat * sampleRate)
  const tail = Math.round(1.8 * sampleRate)
  const totalLen = total + tail
  // 泛音比例：第 4.2 个泛音是刻意错开的（非整数倍），八音盒那种「金属味」靠它
  const partials = [1, 2, 3, 4.2]
  const gains = [1, 0.32, 0.13, 0.06]
  for (let i = 0; i < totalLen; i += 1) {
    const t = i / sampleRate
    const env = (t < 0.004 ? t / 0.004 : 1) * Math.exp(-t * 3.2)
    if (env < 0.0005) continue
    let s = 0
    for (let p = 0; p < partials.length; p += 1) {
      s += Math.sin(2 * Math.PI * freq * partials[p] * t) * gains[p]
    }
    buf[(start + i) % len] += s * env * amp * 0.42
  }
}

/** 低音：正弦 + 慢起慢落，给旋律一个地基 */
function addBass(buf, freq, startBeat, durBeats, amp, sampleRate, beat, len) {
  const start = Math.round(startBeat * beat * sampleRate)
  const totalLen = Math.round((durBeats * beat + 0.8) * sampleRate)
  for (let i = 0; i < totalLen; i += 1) {
    const t = i / sampleRate
    const env = Math.min(1, t / 0.06) * Math.exp(-t * 1.5)
    buf[(start + i) % len] += Math.sin(2 * Math.PI * freq * t) * env * amp
  }
}

/**
 * 铺底长音（pad）。
 *
 * ⚠️ 颤音的周期必须**正好等于整首循环长度**，否则循环点会听到音量跳一下。
 * 所以这里用 `1 / loopSec` 当 LFO 频率 —— 一个循环正好一个周期。
 */
function addPad(buf, freq, amp, sampleRate, len) {
  const loopSec = len / sampleRate
  const lfo = 1 / loopSec
  for (let i = 0; i < len; i += 1) {
    const t = i / sampleRate
    const trem = 0.7 + 0.3 * Math.sin(2 * Math.PI * lfo * t)
    const s = Math.sin(2 * Math.PI * freq * t) * 0.7 + Math.sin(2 * Math.PI * freq * 2 * t) * 0.15
    buf[i] += s * amp * trem
  }
}

/** 旋律描述：[起始拍, 音名, 时值（拍）] */
const LULLABY_MELODY = [
  [0, 'E4', 1], [1, 'G4', 1], [2, 'E4', 2],
  [4, 'D4', 1], [5, 'E4', 1], [6, 'C4', 2],
  [8, 'E4', 1], [9, 'G4', 1], [10, 'A4', 2],
  [12, 'G4', 1], [13, 'E4', 1], [14, 'D4', 2],
  [16, 'C4', 1], [17, 'D4', 1], [18, 'E4', 2],
  [20, 'G4', 1], [21, 'E4', 1], [22, 'D4', 2],
  [24, 'E4', 1], [25, 'G4', 1], [26, 'A4', 2],
  [28, 'D4', 1], [29, 'E4', 1], [30, 'C4', 2],
]

/** 摇篮曲的两小节动机：落回主音 C4，正好能原样接回自己 */
const LULLABY_MOTIF = [
  [0, 'E4', 1], [1, 'G4', 1], [2, 'E4', 2],
  [4, 'D4', 1], [5, 'E4', 1], [6, 'C4', 2],
]
const LULLABY_MOTIF_ROOTS = ['C3', 'A2']

/** 摇篮曲：音符少、时值长，一句一句往下落 */
function renderLullaby(sampleRate, beats) {
  const beat = 60 / MELODY_BPM
  const len = Math.round(sampleRate * beat * beats)
  const buf = new Float32Array(len)
  for (const [b, name, dur] of LULLABY_MELODY) {
    if (b >= beats) continue
    addBell(buf, N[name], b, dur, 0.9, sampleRate, beat, len)
  }
  // 每小节一个低音，走向 C → Am → C → Am → C → Am → G → C
  const roots = ['C3', 'A2', 'C3', 'A2', 'C3', 'A2', 'G2', 'C3']
  roots.forEach((name, bar) => {
    if (bar * 4 >= beats) return
    addBass(buf, N[name], bar * 4, 4, 0.5, sampleRate, beat, len)
  })
  // 铺底：C + G 的空五度，和五声音阶永远不打架
  addPad(buf, N.C3, 0.1, sampleRate, len)
  addPad(buf, N.G3, 0.045, sampleRate, len)
  return buf
}

/** 八音盒：八分音符的琶音，比摇篮曲活泼一点 */
function renderMusicbox(sampleRate, beats) {
  const beat = 60 / MELODY_BPM
  const len = Math.round(sampleRate * beat * beats)
  const buf = new Float32Array(len)
  const triads = {
    C: [N.C5, N.E5, N.G5],
    Am: [N.A4, N.C5, N.E5],
    G: [N.G4, N.D5, N.G5],
  }
  // 琶音的音序（下标指向三和弦里的音）：低-中-高-中-高-中-低-中
  const pattern = [0, 1, 2, 1, 2, 1, 0, 1]
  const bars = ['C', 'Am', 'C', 'Am', 'C', 'Am', 'G', 'C']
  bars.forEach((name, bar) => {
    if (bar * 4 >= beats) return
    const triad = triads[name]
    pattern.forEach((idx, slot) => {
      // 每小节第 1、5 个音高八度，八音盒的「叮」就是这么来的
      const octave = slot === 0 || slot === 4 ? 2 : 1
      addBell(buf, triad[idx] * octave, bar * 4 + slot * 0.5, 0.7, 0.5, sampleRate, beat, len)
    })
    addBass(buf, N[name === 'Am' ? 'A2' : name === 'G' ? 'G2' : 'C3'], bar * 4, 4, 0.32, sampleRate, beat, len)
  })
  addPad(buf, N.C4, 0.05, sampleRate, len)
  return buf
}

/** 星光：很慢、很空，高音零散地闪一下，底下垫一片长音 */
function renderStarlight(sampleRate, beats) {
  const beat = 60 / MELODY_BPM
  const len = Math.round(sampleRate * beat * beats)
  const buf = new Float32Array(len)
  const notes = [
    [0, 'C6', 4],
    [4, 'A5', 3],
    [7.5, 'G5', 3],
    [11, 'E5', 4],
    [16, 'G5', 3],
    [19.5, 'A5', 3],
    [23, 'C6', 4],
    [27, 'D6', 3],
    [30, 'C6', 4],
  ]
  for (const [b, name, dur] of notes) {
    if (b >= beats) continue
    addBell(buf, N[name], b, dur, 0.55, sampleRate, beat, len)
  }
  addPad(buf, N.C4, 0.08, sampleRate, len)
  addPad(buf, N.G4, 0.05, sampleRate, len)
  addPad(buf, N.E5, 0.03, sampleRate, len)
  addBass(buf, N.C3, 0, beats, 0.22, sampleRate, beat, len)
  return buf
}

const MELODY_RENDERERS = {
  lullaby: renderLullaby,
  musicbox: renderMusicbox,
  starlight: renderStarlight,
}

/**
 * 合成一首可无缝循环的旋律。
 *
 * @param {string} kind MELODY_KINDS 里的一个
 * @param {object} [opts]
 * @param {number} [opts.sampleRate]
 * @param {number} [opts.beats] 总拍数；固定旋律用 MELODY_BEATS
 */
export function renderMelody(kind, opts = {}) {
  const renderer = MELODY_RENDERERS[kind]
  if (!renderer) throw new Error(`未知的旋律：${kind}`)
  const sampleRate = opts.sampleRate || MELODY_SAMPLE_RATE
  const beats = opts.beats || MELODY_BEATS
  return normalizePeak(renderer(sampleRate, beats), 0.82)
}

/**
 * 摇篮曲的**两小节动机**，循环长度正好 8 拍 —— 工坊里叠「旋律」层用它。
 * 落回主音，所以原样接回自己也不别扭。
 */
export function renderLullabyMotif(sampleRate, seconds) {
  const beats = 8
  const beat = seconds / beats
  const len = Math.round(sampleRate * seconds)
  const buf = new Float32Array(len)
  for (const [b, name, dur] of LULLABY_MOTIF) {
    addBell(buf, N[name], b, dur, 0.9, sampleRate, beat, len)
  }
  LULLABY_MOTIF_ROOTS.forEach((name, bar) => {
    addBass(buf, N[name], bar * 4, 4, 0.5, sampleRate, beat, len)
  })
  addPad(buf, N.C3, 0.09, sampleRate, len)
  addPad(buf, N.G3, 0.04, sampleRate, len)
  return buf
}

/* ===========================================================================
 * 三、配方（声音工坊：几层叠一叠）
 * ========================================================================= */

/** 底层可选（单选；none = 不打底）。底层决定「音色骨架」，噪声类素材都能当底 */
export const BED_OPTIONS = [
  { key: 'none', name: '不要' },
  { key: 'white', name: '白噪音' },
  { key: 'pink', name: '粉噪音' },
  { key: 'brown', name: '棕噪音' },
  { key: 'wind', name: '风' },
  { key: 'stream', name: '溪流' },
  { key: 'fan', name: '风扇' },
]

/** 混入层（可多选，每层各有一个强度滑杆） */
export const LAYER_OPTIONS = [
  { key: 'rain', name: '雨声' },
  { key: 'wave', name: '海浪' },
  { key: 'stream', name: '溪流' },
  { key: 'wind', name: '风' },
  { key: 'fan', name: '风扇' },
  { key: 'heartbeat', name: '心跳' },
  { key: 'pendulum', name: '钟摆' },
  { key: 'lullaby', name: '摇篮曲' },
]

/** 工坊的循环长度（秒）。12 秒够长、听不出周期，又能让每次重算足够快 */
export const LAB_SECONDS = 12
/** 「存下来」时的参数：22.05kHz / 30 秒（约 1.3MB），和库里的旋律同一档 */
export const CUSTOM_SAMPLE_RATE = 22050
export const CUSTOM_SECONDS = 30

/**
 * 各层的出厂强度：让叠加后大致平衡，用户拖着调是「微调」而不是「从零找」。
 *
 * 心跳与钟摆给得比别的层高，是因为它们「大部分时间是静音、偶尔一下」，
 * 归一化时受峰值上限压制、整体偏轻（见 `normalizeRms`），混进来必须补回来。
 */
const BASE_GAIN = {
  white: 0.9,
  pink: 0.9,
  brown: 0.9,
  wind: 0.9,
  stream: 0.75,
  fan: 0.8,
  rain: 0.8,
  wave: 0.8,
  heartbeat: 0.9,
  pendulum: 1.2,
  lullaby: 0.5,
}

/** 亮度滑杆 0~1 → 低通截止频率（Hz）。指数映射，听感上才是「均匀变亮」 */
const CUTOFF_MIN = 350
const CUTOFF_MAX = 9000
/** 起伏：0~1 → 想要的周期在 24 秒（慢）与 2 秒（快）之间 */
const MOTION_SLOW_SEC = 24
const MOTION_FAST_SEC = 2

function clamp01(value) {
  const n = typeof value === 'number' ? value : 0
  return n < 0 ? 0 : n > 1 ? 1 : n
}

/** 亮度 → 截止频率；页面拿它显示「亮/闷」的说明 */
export function cutoffOf(brightness) {
  return CUTOFF_MIN * Math.pow(CUTOFF_MAX / CUTOFF_MIN, clamp01(brightness))
}

/**
 * 一阶低通：把高频削掉，就是「闷」与「亮」的区别。
 *
 * 这是全曲唯一一处「有记忆」的处理（滤波器输出依赖上一个样本），
 * 所以在循环点理论上会有一次极小的不连续 —— 但一阶滤波的记忆只有几毫秒，
 * 又被前面噪声层的交叉淡化盖住，实际听不出来。
 */
function applyLowpass(buf, sampleRate, cutoffHz) {
  const nyquist = sampleRate / 2
  const fc = Math.max(60, Math.min(cutoffHz, nyquist * 0.98))
  const a = 1 - Math.exp((-2 * Math.PI * fc) / sampleRate)
  let y = 0
  for (let i = 0; i < buf.length; i += 1) {
    y += a * (buf[i] - y)
    buf[i] = y
  }
}

export function defaultRecipe() {
  return {
    bed: 'brown',
    bedGain: 0.9,
    layers: [{ key: 'rain', gain: 0.8 }],
    brightness: 0.75,
    motion: 0.25,
    depth: 0.4,
  }
}

/**
 * 按配方合成一段可无缝循环的样本。
 *
 * 无缝的做法：所有起伏的周期都取「循环长度的整数分之一」，于是包络在每个循环点上的
 * 取值天然相同；噪声层再套一次交叉淡化兜住随机成分。
 * （低通那一步是有记忆的，例外说明见 `applyLowpass`。）
 */
export function renderRecipe(recipe, opts = {}) {
  const sampleRate = opts.sampleRate || 22050
  const seconds = opts.seconds || LAB_SECONDS
  const r = recipe || defaultRecipe()
  const len = Math.floor(sampleRate * seconds)
  const mix = new Float32Array(len)

  const addKind = (kind, gain, cycles) => {
    if (!gain || NOISE_KINDS.indexOf(kind) < 0) return
    const part = renderNoise(kind, {
      sampleRate,
      seconds,
      loopSeconds: seconds / (cycles || 1),
      gain,
    })
    for (let i = 0; i < len; i += 1) mix[i] += part[i]
  }

  if (r.bed && r.bed !== 'none') {
    const gain = (r.bedGain == null ? 0.9 : r.bedGain) * (BASE_GAIN[r.bed] || 0.8)
    addKind(r.bed, gain, 1)
  }

  for (const item of r.layers || []) {
    const key = item && item.key
    if (!key) continue
    const gain = (item.gain == null ? 0.8 : item.gain) * (BASE_GAIN[key] || 0.5)
    if (key === 'lullaby') {
      // 动机长度取循环的一半，12 秒里正好放两遍
      const motif = renderLullabyMotif(sampleRate, seconds / 2)
      for (let i = 0; i < len; i += 1) mix[i] += motif[i % motif.length] * gain
      continue
    }
    addKind(key, gain, key === 'wave' ? 2 : 1)
  }

  // 先定音色（亮度），再起伏
  applyLowpass(mix, sampleRate, cutoffOf(r.brightness))

  const depth = clamp01(r.depth == null ? 0 : r.depth)
  if (depth > 0) {
    const wantPeriod = MOTION_SLOW_SEC + (MOTION_FAST_SEC - MOTION_SLOW_SEC) * clamp01(r.motion)
    // 取整数个周期，循环点才对得上
    const cycles = Math.max(1, Math.round(seconds / wantPeriod))
    const period = len / cycles
    for (let i = 0; i < len; i += 1) {
      mix[i] *= 1 - depth * (0.5 - 0.5 * Math.sin((2 * Math.PI * i) / period))
    }
  }

  return normalizeRms(mix, TARGET_RMS)
}

/** 把配方说成人话，当作音源名字用，例如「棕噪音 + 雨声 + 海浪」 */
export function describeRecipe(recipe) {
  const r = recipe || defaultRecipe()
  const parts = []
  if (r.bed && r.bed !== 'none') {
    const bed = BED_OPTIONS.find((item) => item.key === r.bed)
    if (bed) parts.push(bed.name)
  }
  for (const item of r.layers || []) {
    const layer = LAYER_OPTIONS.find((option) => option.key === (item && item.key))
    if (layer) parts.push(layer.name)
  }
  if (!parts.length) parts.push('安静')
  return parts.join(' + ')
}

/** 配方里到底有没有声音（空的配方存下来就是一段静音，要拦住） */
export function recipeHasSound(recipe) {
  const r = recipe || defaultRecipe()
  const bed = r.bed && r.bed !== 'none' && (r.bedGain == null || r.bedGain > 0)
  const layer = (r.layers || []).some((item) => item && item.key && (item.gain == null || item.gain > 0))
  return Boolean(bed || layer)
}

/* ===========================================================================
 * 四、写成 WAV
 * ========================================================================= */

/**
 * 16-bit 单声道 PCM 的 WAV 字节。
 *
 * 用 `Uint8Array` + `DataView` 而不是 Node 的 `Buffer`：这样同一份代码在
 * 小程序里也能跑（工坊「存下来」要自己拼文件）。
 */
export function toWavBytes(samples, sampleRate) {
  const dataLen = samples.length * 2
  const total = 44 + dataLen
  const bytes = new Uint8Array(total)
  const view = new DataView(bytes.buffer)
  const writeAscii = (offset, text) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i))
  }

  writeAscii(0, 'RIFF')
  view.setUint32(4, 36 + dataLen, true)
  writeAscii(8, 'WAVE')
  writeAscii(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // 单声道
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // byteRate
  view.setUint16(32, 2, true) // blockAlign
  view.setUint16(34, 16, true) // 位深
  writeAscii(36, 'data')
  view.setUint32(40, dataLen, true)

  for (let i = 0; i < samples.length; i += 1) {
    const v = samples[i] < -1 ? -1 : samples[i] > 1 ? 1 : samples[i]
    view.setInt16(44 + i * 2, Math.round(v * 32767), true)
  }
  return bytes
}
