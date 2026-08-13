import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUserSettingStore } from './useUserSettingStore'
import { USER_SETTING_SCOPE, conversationSettingKey } from '../constant'

describe('useUserSettingStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
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
})
