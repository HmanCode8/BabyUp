import { createSSRApp } from 'vue'
import * as Pinia from 'pinia'
import App from './App.vue'
import { trackError } from './utils/tracker'

export function createApp() {
  const app = createSSRApp(App)
  app.use(Pinia.createPinia())

  /**
   * 补丁 Step 7：Vue 运行时异常统一上报（文档 2.1 第 11 项）。
   * 上报本身全程 try/catch 静默降级，绝不会二次影响业务。
   */
  app.config.errorHandler = (err, instance, info) => {
    console.error('[App] 未捕获的组件异常', info, err)
    trackError('vue_error', err)
  }

  return {
    app,
    Pinia,
  }
}
