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
 * 读取本地持久化的 settings。写入中断、手动篡改、跨版本格式变化都可能让内容不是合法 JSON，
 * JSON.parse 抛异常时必须兜底为空对象，否则 useUserSettingStore() 一调用就同步抛出，渲染进程起不来。
 */
function readStoredSettings(): Record<string, string> {
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return {}
  try {
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch (e) {
    console.error('解析本地用户设置失败，回退为空对象', e)
    return {}
  }
}

/** 内容非数字（如被手动改坏）时 Number(...) 返回 NaN，必须兜底为 0，否则 version 会永久卡在 NaN */
function readStoredVersion(): number {
  const parsed = Number(localStorage.getItem(STORAGE_VERSION_KEY) ?? 0)
  return Number.isFinite(parsed) ? parsed : 0
}

/**
 * 用户设置的本地真值来源，镜像服务端的 t_user_setting。
 *
 * 设置与 version 刻意放在同一个 store、同一份持久化里：只要两者同生共死，
 * 就不会出现「version 还在、设置没了」——那样客户端会按该 version 只要增量，
 * 永久丢失已有设置。改动这里时务必保持这个不变量（内存层由 clearAll() 保证，
 * 持久化层由下方合并的 persist() 保证：settings 落盘失败时 version 不落盘）。
 *
 * 取消操作写 value "0"（tombstone）而不是删除记录，读取方一律只认 "1"。
 */
export const useUserSettingStore = defineStore('userSetting', () => {
  // 键为 `${scope}:${key}`，扁平化避免嵌套响应式的深比较开销
  const settings = ref<Record<string, string>>(readStoredSettings())
  const version = ref<number>(readStoredVersion())

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

  /**
   * settings 与 version 的落盘必须同生共死：settings 写入失败（配额超限、隐私模式等）时，
   * version 绝不能被推进到磁盘，否则重启后磁盘上出现「version 已经很新、设置却是旧的/空的」，
   * 客户端只按该 version 拉增量，存量设置永久丢失——这正是内存层 clearAll() 要防住的同一个坑，
   * 只是发生在持久化层。因此这里合并成一次 persist，settings 写失败直接 return，不再写 version。
   */
  function persist(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.value))
    } catch (e) {
      console.error('持久化用户设置失败，version 本次不落盘，避免磁盘上 version 与设置不一致', e)
      return
    }
    localStorage.setItem(STORAGE_VERSION_KEY, String(version.value))
  }

  watch([settings, version], persist, { deep: true })

  return {
    settings, version, savedGroupIds,
    applyEntries, setLocal, settingValue,
    isConversationTop, isConversationSilent, clearAll
  }
})
