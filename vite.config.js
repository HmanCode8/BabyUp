import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import uni from '@dcloudio/vite-plugin-uni'

/**
 * 把 src/cloudfunctions 拷进小程序产物目录。
 *
 * manifest.json 里配的 cloudfunctionRoot 只会透传成产物的 project.config.json 字段，
 * uni-app 自己不会把源码目录里的云函数拷过去，所以要在这里补一刀，
 * 否则微信开发者工具打开 dist 后看不到云函数。
 */
function copyCloudFunctions() {
  return {
    name: 'copy-cloudfunctions',
    closeBundle() {
      if (process.env.UNI_PLATFORM !== 'mp-weixin') return
      const from = path.join(process.env.UNI_INPUT_DIR, 'cloudfunctions')
      if (!fs.existsSync(from)) return
      fs.cpSync(from, path.join(process.env.UNI_OUTPUT_DIR, 'cloudfunctions'), {
        recursive: true,
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    uni(),
    copyCloudFunctions(),
  ],
})
