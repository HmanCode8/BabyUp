/**
 * 微信订阅消息（喂奶提醒 / 疫苗提醒）的公共部分：模板 ID、请求授权、查当前状态。
 *
 * ⚠️ 一次授权只换 1 条额度，云函数发一条就归零；勾「总是保持以上选择」只是以后不再
 *    弹窗，并不会变成永久订阅。想让提醒持续可用，只能反复授权把额度攒起来。
 *
 *    好消息是「反复授权」可以做到无感：勾了保持之后，只要在用户点击手势里调用
 *    requestSubscribeMessage，就不会弹窗、但每次都算一次订阅（见 askSubscribeQuota）。
 *    所以凡是用户的手势操作（打开开关、保存记录）都顺带要一次授权。
 *
 * ⚠️ requestSubscribeMessage 必须由用户点击手势同步触发，放到 await 之后会以
 *    「can only be invoked by user TAP gesture」失败：调用点必须写在 onSave 这类
 *    点击回调里第一个 await 之前。
 *
 * ⚠️ 授权被拒/失败一律静默，绝不能因为提醒没授权就让记录存不进去。
 */

import { todayString } from './date'

/**
 * 模板 ID（小程序后台 → 功能 → 订阅消息 → 我的模板）。必须与云函数里的 TEMPLATE_ID
 * 完全一致：这里负责让用户授权攒额度，云函数负责消费额度发消息，对不上等于白授权。
 *   - FEED_TEMPLATE_ID    ↔ src/cloudfunctions/feeding-reminder/index.js
 *   - VACCINE_TEMPLATE_ID ↔ src/cloudfunctions/reminder/index.js
 */
export const FEED_TEMPLATE_ID = 'NCXAOkXSusWa7FN3hLwRRbAgUF4fNTjM_gNU7HUhUfQ'
export const VACCINE_TEMPLATE_ID = '9-P4ftotXMMapWSvVhH578lFR0LV4qvLewPMYyA0dns'

/** 非微信端（H5 等）没有订阅消息能力，查状态统一返回这个 */
const NO_SUBSCRIBE = { supported: false, mainSwitch: 'on', templates: {} }

/**
 * 订阅状态缓存。
 *
 * 为什么要缓存：判断「用户是否勾了总是保持以上选择」必须**在点击手势里同步完成** ——
 * requestSubscribeMessage 只认用户点击，等 await 回来再调必然失败。所以状态要在
 * 用户点击之前就查好放在这里，由 App.vue 启动时预热、相关页面按需刷新。
 */
let statusCache = null

/** 预热 / 刷新订阅状态缓存 */
export async function loadSubscribeStatus() {
  statusCache = await getSubscribeStatus()
  return statusCache
}

/** 取缓存（没查过时返回 null，调用方按「未授权」保守处理） */
export function cachedSubscribeStatus() {
  return statusCache
}

/**
 * 用户是否勾了「总是保持以上选择」并同意。
 * 这种状态下再调用 requestSubscribeMessage 不会弹窗，但每次都会多算一次订阅，
 * 也就是可以静默攒额度（见 askSubscribeQuota 注释）。
 */
function isKeptAlways(templateId) {
  return Boolean(statusCache && statusCache.templates && statusCache.templates[templateId] === 'accept')
}

/** 「今天已经请求过授权」的本地标记：没勾保持的用户不该被反复弹窗 */
function askedStorageKey(templateId) {
  return `subscribe.asked.${templateId}`
}

function askedToday(templateId) {
  try {
    return uni.getStorageSync(askedStorageKey(templateId)) === todayString()
  } catch (err) {
    console.error('[Subscribe] 读取请求记录失败', err)
    return false
  }
}

function markAskedToday(templateId) {
  try {
    uni.setStorageSync(askedStorageKey(templateId), todayString())
  } catch (err) {
    console.error('[Subscribe] 写入请求记录失败', err)
  }
}

/**
 * 保存记录时顺带攒一条提醒额度。
 *
 * 微信的规则是这样的（社区技术运营专员的答复）：勾了「总是保持以上选择，不再询问」
 * 之后，仍然必须由用户点击来触发调用，但不会再弹窗，而且每一次调用都算一次订阅 ——
 * 也就是所谓「静默堆积额度」。所以这里分两种情况：
 *   已勾保持 -> 每次保存都调用，用户毫无感知，额度越攒越多；
 *   没勾保持 -> 一天最多调用一次，否则每存一笔记录都弹一次窗，纯属骚扰。
 *
 * ⚠️ 必须在用户点击手势里同步调用（放在第一个 await 之前），否则报
 *    can only be invoked by user TAP gesture。
 *
 * @param {string} templateId 模板 ID
 * @param {boolean} needed 这次操作是否需要攒额度（例如宝宝的提醒没开启就不用攒）
 */
export function askSubscribeQuota(templateId, needed = true) {
  if (!templateId || !needed) return
  if (isKeptAlways(templateId)) {
    requestSubscribe(templateId)
    return
  }
  if (askedToday(templateId)) return
  markAskedToday(templateId)
  requestSubscribe(templateId)
}

/**
 * 请求订阅授权。
 * @param {string} templateId 模板 ID
 * @param {boolean} notify 是否给用户提示结果：用户主动点按钮时 true，保存记录顺手要时 false
 * @param {Function} [after] 授权流程结束后的回调（成功 / 失败 / 取消都会走），用来刷新页面上的状态
 */
export function requestSubscribe(templateId, notify = false, after = null) {
  // #ifdef MP-WEIXIN
  if (!templateId || typeof uni.requestSubscribeMessage !== 'function') return
  uni.requestSubscribeMessage({
    tmplIds: [templateId],
    success: (res) => {
      const result = res[templateId]
      console.log('[Subscribe] 授权结果', templateId, result)
      // 保存记录时顺手要的授权不打扰用户，只在用户主动点按钮时提示
      if (!notify) return
      uni.showToast(
        result === 'accept' ? { title: '已开启', icon: 'success' } : { title: '未开启', icon: 'none' },
      )
    },
    fail: (err) => {
      const errCode = err && err.errCode
      console.error('[Subscribe] 授权失败', errCode, (err && err.errMsg) || err)
      // 20004：用户关掉了订阅消息总开关，只能在设置里重新打开
      if (notify && errCode === 20004) {
        uni.showModal({
          title: '提醒未开启',
          content: '你在设置里关闭了订阅消息，打开后才能收到提醒',
          confirmText: '去设置',
          success: (res) => {
            if (res.confirm && typeof uni.openSetting === 'function') uni.openSetting()
          },
        })
      }
    },
    complete: () => {
      if (after) after()
    },
  })
  // #endif
  // #ifndef MP-WEIXIN
  if (notify) uni.showToast({ title: '请在微信小程序里开启', icon: 'none' })
  // #endif
}

/**
 * 查当前订阅状态。注意微信的两个限制，页面上要如实说明：
 *   1. itemSettings 只包含用户勾选过「总是保持以上选择，不再询问」的模板，其余查不到；
 *   2. 剩余可发送条数没有任何接口可查，只能靠云函数日志（43101 = 没额度）反推。
 * @returns {Promise<{supported: boolean, mainSwitch: string, templates: Object}>}
 */
export function getSubscribeStatus() {
  // #ifdef MP-WEIXIN
  return new Promise((resolve) => {
    if (typeof uni.getSetting !== 'function') {
      resolve(NO_SUBSCRIBE)
      return
    }
    uni.getSetting({
      // 不传 withSubscriptions 时返回值里压根没有 subscriptionsSetting 字段，等于白查
      withSubscriptions: true,
      success: (res) => {
        const setting = (res && res.subscriptionsSetting) || {}
        resolve({
          supported: true,
          // 只有明确返回 'off' 才算关；其余情况（含字段缺失）都当作默认打开
          mainSwitch: setting.mainSwitch === 'off' ? 'off' : 'on',
          templates: setting.itemSettings || {},
        })
      },
      fail: () => resolve(NO_SUBSCRIBE),
    })
  })
  // #endif
  // #ifndef MP-WEIXIN
  return Promise.resolve(NO_SUBSCRIBE)
  // #endif
}

/**
 * 把状态翻译成给人看的文案。
 * @param {Object|null} status getSubscribeStatus 的结果，null 表示还没查完
 * @param {string} templateId 模板 ID
 */
export function describeSubscribeStatus(status, templateId) {
  if (!status) return '查询中…'
  if (!status.supported) return '仅微信小程序可查'
  if (status.mainSwitch === 'off') return '总开关已关闭'
  const value = status.templates[templateId]
  if (value === 'reject') return '已拒绝'
  if (value === 'ban') return '已被禁用'
  if (value) return '已允许'
  return '未订阅'
}
