import { describe, it, expect, beforeEach, vi } from 'vitest'
import { nextTick } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { useUserSettingStore } from '@/stores/useUserSettingStore'
import { USER_SETTING_SCOPE, conversationSettingKey } from '@/constant'

// 与 useUserSettingStore.ts 内部的私有存储 key 保持一致，仅用于测试断言持久化内容
const STORAGE_KEY = 'user_settings'
const STORAGE_VERSION_KEY = 'user_settings_version'

describe('useUserSettingStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.restoreAllMocks()
  })

  it('会话 key 是连字符分隔的 type-line-target', () => {
    expect(conversationSettingKey(1, 0, 'group123')).toBe('1-0-group123')
    expect(conversationSettingKey(0, 0, 'user456')).toBe('0-0-user456')
  })

  it('scope 常量与服务端一致', () => {
    expect(USER_SETTING_SCOPE.conversationSilent).toBe(1)
    expect(USER_SETTING_SCOPE.globalSilent).toBe(2)
    expect(USER_SETTING_SCOPE.conversationTop).toBe(3)
    expect(USER_SETTING_SCOPE.favoriteGroup).toBe(6)
  })

  it('applyEntries 写入并把 version 推进到本批最大 updateDt', () => {
    const store = useUserSettingStore()

    store.applyEntries([
      { scope: 6, key: 'group-a', value: '1', updateDt: 100 },
      { scope: 3, key: '1-0-group-a', value: '1', updateDt: 300 },
      { scope: 1, key: '0-0-user-b', value: '1', updateDt: 200 }
    ])

    expect(store.settingValue(6, 'group-a')).toBe('1')
    expect(store.version).toBe(300)
  })

  it('version 只增不减，重叠拉取不会回退', () => {
    const store = useUserSettingStore()
    store.applyEntries([{ scope: 6, key: 'group-a', value: '1', updateDt: 500 }])

    store.applyEntries([{ scope: 6, key: 'group-b', value: '1', updateDt: 200 }])

    expect(store.version).toBe(500)
  })

  it('applyEntries 传空数组时 version 不变', () => {
    const store = useUserSettingStore()
    store.applyEntries([{ scope: 6, key: 'group-a', value: '1', updateDt: 500 }])

    store.applyEntries([])

    expect(store.version).toBe(500)
  })

  it('tombstone 存为普通值而不是删除记录', () => {
    const store = useUserSettingStore()
    store.applyEntries([{ scope: 6, key: 'group-a', value: '1', updateDt: 100 }])

    store.applyEntries([{ scope: 6, key: 'group-a', value: '0', updateDt: 200 }])

    expect(store.settingValue(6, 'group-a')).toBe('0')
  })

  it('savedGroupIds 只含 value 为 1 的群', () => {
    const store = useUserSettingStore()
    store.applyEntries([
      { scope: 6, key: 'group-a', value: '1', updateDt: 100 },
      { scope: 6, key: 'group-b', value: '0', updateDt: 200 },
      { scope: 6, key: 'group-c', value: '1', updateDt: 300 },
      { scope: 3, key: '1-0-group-d', value: '1', updateDt: 400 }
    ])

    expect([...store.savedGroupIds].sort()).toEqual(['group-a', 'group-c'])
  })

  it('同一个 key 在不同 scope 下互不干扰', () => {
    const store = useUserSettingStore()

    store.applyEntries([
      { scope: 3, key: '1-0-group-a', value: '1', updateDt: 100 },
      { scope: 1, key: '1-0-group-a', value: '0', updateDt: 100 }
    ])

    expect(store.isConversationTop(1, 0, 'group-a')).toBe(true)
    expect(store.isConversationSilent(1, 0, 'group-a')).toBe(false)
  })

  it('未设置过的会话，两个判定都是 false', () => {
    const store = useUserSettingStore()

    expect(store.isConversationTop(1, 0, 'never')).toBe(false)
    expect(store.isConversationSilent(1, 0, 'never')).toBe(false)
  })

  it('setLocal 立即生效，供 UI 不等服务端往返', () => {
    const store = useUserSettingStore()

    store.setLocal(USER_SETTING_SCOPE.favoriteGroup, 'group-a', '1')

    expect(store.settingValue(6, 'group-a')).toBe('1')
    expect([...store.savedGroupIds]).toEqual(['group-a'])
  })

  it('setLocal 不推进 version —— version 只跟随服务端的 updateDt', () => {
    const store = useUserSettingStore()
    store.applyEntries([{ scope: 6, key: 'group-a', value: '1', updateDt: 100 }])

    store.setLocal(6, 'group-b', '1')

    expect(store.version).toBe(100)
  })

  it('clearAll 同时清掉设置与 version', () => {
    const store = useUserSettingStore()
    store.applyEntries([{ scope: 6, key: 'group-a', value: '1', updateDt: 100 }])

    store.clearAll()

    expect(store.settingValue(6, 'group-a')).toBeUndefined()
    expect(store.version).toBe(0)
    expect([...store.savedGroupIds]).toEqual([])
  })

  it('localStorage 里已存的 settings 不是合法 JSON 时，初始化不崩溃，回退为空对象', () => {
    localStorage.setItem(STORAGE_KEY, 'not valid json{{{')

    expect(() => useUserSettingStore()).not.toThrow()
    const store = useUserSettingStore()

    expect(store.settings).toEqual({})
  })

  it('localStorage 里已存的 version 不是数字时，初始化不崩溃，回退为 0', () => {
    localStorage.setItem(STORAGE_VERSION_KEY, 'not-a-number')

    const store = useUserSettingStore()

    expect(store.version).toBe(0)
  })

  it('写入设置后 localStorage 里确实有对应内容', async () => {
    const store = useUserSettingStore()

    store.applyEntries([{ scope: 6, key: 'group-a', value: '1', updateDt: 100 }])
    await nextTick()

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}')).toEqual({ '6:group-a': '1' })
    expect(localStorage.getItem(STORAGE_VERSION_KEY)).toBe('100')
  })

  it('重新实例化 store 后能从 localStorage 恢复 settings 与 version', async () => {
    const store = useUserSettingStore()
    store.applyEntries([{ scope: 6, key: 'group-a', value: '1', updateDt: 100 }])
    await nextTick()

    // 模拟应用重启：换一个全新的 pinia，重新拿 store 实例
    setActivePinia(createPinia())
    const restored = useUserSettingStore()

    expect(restored.settingValue(6, 'group-a')).toBe('1')
    expect(restored.version).toBe(100)
  })

  it('settings 写入失败时，version 不落盘，避免磁盘上 version 快于设置', async () => {
    const store = useUserSettingStore()
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
      if (key === STORAGE_KEY) throw new Error('quota exceeded')
    })

    store.applyEntries([{ scope: 6, key: 'group-a', value: '1', updateDt: 100 }])
    await nextTick()

    expect(setItemSpy).not.toHaveBeenCalledWith(STORAGE_VERSION_KEY, expect.anything())
    // 内存里该推进的还是推进了，只是没能落盘——这条不变量本身由前面的用例覆盖
    expect(store.version).toBe(100)
  })
})
