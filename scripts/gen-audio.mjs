/**
 * 生成**固定音频素材**（安睡音与放映页共用的那 9 首）的离线脚本。
 *
 * 合成公式**不在这里** —— 全部来自 `src/pkg/utils/sound-gen.mjs`，
 * 也就是端上「声音工坊」实时合成用的同一份实现。这个脚本只负责：
 * 按 `sound-library.js` 的清单把 9 首算出来、写成 WAV、放到同一个目录。
 *
 * 用法：
 *   node scripts/gen-audio.mjs [输出目录]
 * 默认输出到 `scripts/out/sleep-sound/`（文件名与 SOUNDS[].file 一一对应）。
 * 改完音色重新跑一遍，把输出目录整个传到云存储的 `sleep-sound/` 即可。
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  MELODY_SAMPLE_RATE,
  NOISE_SAMPLE_RATE,
  NOISE_SECONDS,
  renderMelody,
  renderNoise,
  normalizeRms,
  TARGET_RMS,
  toWavBytes,
} from '../src/pkg/utils/sound-gen.mjs'

/** 清单：与 src/pkg/utils/sound-library.js 的 `SOUNDS[].file` 一一对应 */
const NOISE_FILES = [
  { kind: 'white', file: 'white.wav' },
  { kind: 'pink', file: 'pink.wav' },
  { kind: 'brown', file: 'brown.wav' },
  { kind: 'rain', file: 'rain.wav' },
  { kind: 'wave', file: 'wave.wav' },
  { kind: 'wind', file: 'wind.wav' },
  { kind: 'stream', file: 'stream.wav' },
  { kind: 'fan', file: 'fan.wav' },
  { kind: 'heartbeat', file: 'heartbeat.wav' },
  { kind: 'pendulum', file: 'pendulum.wav' },
]

const MELODY_FILES = [
  { kind: 'lullaby', file: 'lullaby.wav' },
  { kind: 'musicbox', file: 'musicbox.wav' },
  { kind: 'starlight', file: 'starlight.wav' },
]

const here = dirname(fileURLToPath(import.meta.url))
const outDir = resolve(process.argv[2] || join(here, 'out', 'sleep-sound'))
mkdirSync(outDir, { recursive: true })

console.log(`输出到 ${outDir}`)
console.log(`  环境音：${NOISE_SAMPLE_RATE} Hz · ${NOISE_SECONDS} 秒（交叉淡化循环）`)
console.log(`  旋律：  ${MELODY_SAMPLE_RATE} Hz · 72 BPM · 32 拍（余韵绕回循环）`)

for (const item of NOISE_FILES) {
  const samples = normalizeRms(
    renderNoise(item.kind, { sampleRate: NOISE_SAMPLE_RATE, seconds: NOISE_SECONDS }),
    TARGET_RMS,
  )
  const bytes = toWavBytes(samples, NOISE_SAMPLE_RATE)
  writeFileSync(join(outDir, item.file), Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  console.log(`  ${item.file}  ${(bytes.length / 1024).toFixed(0)} KB`)
}

for (const item of MELODY_FILES) {
  const samples = renderMelody(item.kind, { sampleRate: MELODY_SAMPLE_RATE })
  const bytes = toWavBytes(samples, MELODY_SAMPLE_RATE)
  writeFileSync(join(outDir, item.file), Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
  console.log(`  ${item.file}  ${(bytes.length / 1024).toFixed(0)} KB`)
}

console.log('完成。把整个输出目录传到云存储的 sleep-sound/ 即可。')
