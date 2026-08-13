import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { USER_SETTING_SCOPE, conversationSettingKey } from '../constant'

export interface UserSettingEntry {
  scope: number
  key: string
  value: string
  updateDt: number
}

const STORAGE_KEY = 'user_settings'
const STORAGE_VERSION_KEY = 'user_settings_version'

/**
 * 用户设置的本地真值来源，镜像服务端的 t_user_setting。
 *
 * 设置与 version 刻意放在同一个 store、同一份持久化里：只要两者同生共死，
 * 就不会出现「version 还在、设置没了」——那样客户端会按该 version 只要增量，
 * 永久丢失已有设置。改动这里时务必保持这个不变量。
 *
 * 取消操作写 value "0"（tombstone）而不是删除记录，读取方一律只认 "1"。
 */
export const useUserSettingStore = defineStore('userSetting', () => {
  // 键为 `${scope}:${key}`，扁平化避免嵌套响应式的深比较开销
  const settings = ref<Record<string, string>>(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'))
  const version = ref<number>(Number(localStorage.getItem(STORAGE_VERSION_KEY) ?? 0))

  function entryKey(scope: number, key: string): string {
    return `${scope}:${key}`
  }

  function settingValue(scope: number, key: string): string | undefined {
    return settings.value[entryKey(scope, key)]
  }

  /** 服务端 UG 应答落地：写全部条目（含 tombstone），version 取本批最大 updateDt，只增不减 */
  function applyEntries(entries: UserSettingEntry[]): void {
    let maxUpdateDt = version.value
    for (const entry of entries) {
      settings.value[entryKey(entry.scope, entry.key)] = entry.value
      if (entry.updateDt > maxUpdateDt) maxUpdateDt = entry.updateDt
    }
    version.value = maxUpdateDt
  }

  /** 本地先行写入，UI 不必等服务端往返。不动 version —— version 只跟随服务端的 updateDt */
  function setLocal(scope: number, key: string, value: string): void {
    settings.value[entryKey(scope, key)] = value
  }

  function isConversationTop(conversationType: number, line: number, target: string): boolean {
    return settingValue(USER_SETTING_SCOPE.conversationTop, conversationSettingKey(conversationType, line, target)) === '1'
  }

  function isConversationSilent(conversationType: number, line: number, target: string): boolean {
    return settingValue(USER_SETTING_SCOPE.conversationSilent, conversationSettingKey(conversationType, line, target)) === '1'
  }

  /** 已保存到通讯录的群 id。取消保存写的是 "0"，所以只认 "1" */
  const savedGroupIds = computed<string[]>(() => {
    const prefix = `${USER_SETTING_SCOPE.favoriteGroup}:`
    return Object.entries(settings.value)
      .filter(([k, v]) => k.startsWith(prefix) && v === '1')
      .map(([k]) => k.slice(prefix.length))
  })

  /** 登出/换账号时调用：设置与 version 必须一起清 */
  function clearAll(): void {
    settings.value = {}
    version.value = 0
  }

  watch(settings, val => localStorage.setItem(STORAGE_KEY, JSON.stringify(val)), { deep: true })
  watch(version, val => localStorage.setItem(STORAGE_VERSION_KEY, String(val)))

  return {
    settings, version, savedGroupIds,
    applyEntries, setLocal, settingValue,
    isConversationTop, isConversationSilent, clearAll
  }
})
