import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUserSettingStore } from './useUserSettingStore'
import { useConversationStore } from './useConversationStore'
import { USER_SETTING_SCOPE, conversationSettingKey } from '../constant'

vi.mock('benz-amr-recorder', () => ({ default: vi.fn() }))

const updateUserSetting = vi.fn()
const getGroupInfo = vi.fn()
vi.mock('@/websocket/websocketcli', () => ({
  default: {
    updateUserSetting: (...args: unknown[]) => updateUserSetting(...args),
    getGroupInfo: (...args: unknown[]) => getGroupInfo(...args)
  }
}))

describe('会话设置与服务端同步', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    updateUserSetting.mockClear()
    getGroupInfo.mockClear()
  })

  it('设置先到、会话后建：新会话直接带上置顶与免打扰', () => {
    const settingStore = useUserSettingStore()
    settingStore.applyEntries([
      { scope: USER_SETTING_SCOPE.conversationTop, key: '1-0-group-a', value: '1', updateDt: 100 },
      { scope: USER_SETTING_SCOPE.conversationSilent, key: '1-0-group-a', value: '1', updateDt: 100 }
    ])

    expect(settingStore.isConversationTop(1, 0, 'group-a')).toBe(true)
    expect(settingStore.isConversationSilent(1, 0, 'group-a')).toBe(true)
  })

  it('取消后的 tombstone 不会被当成已设置', () => {
    const settingStore = useUserSettingStore()
    settingStore.applyEntries([
      { scope: USER_SETTING_SCOPE.conversationTop, key: '1-0-group-a', value: '1', updateDt: 100 },
      { scope: USER_SETTING_SCOPE.conversationTop, key: '1-0-group-a', value: '0', updateDt: 200 }
    ])

    expect(settingStore.isConversationTop(1, 0, 'group-a')).toBe(false)
  })

  function makeConversationInfo(overrides: Record<string, unknown> = {}) {
    return {
      target: 'user-b',
      conversationType: 0,
      line: 0,
      isTop: false,
      isSilent: false,
      timestamp: 1,
      unreadCount: { unread: 0 },
      lastMessage: null,
      ...overrides
    }
  }

  it('topConversation：本地置顶的同时上报 UP（scope=conversationTop, value=1）', () => {
    const conversationStore = useConversationStore()
    conversationStore.updateConversationInfo(makeConversationInfo())
    updateUserSetting.mockClear()

    conversationStore.topConversation('user-b')

    const sc = conversationStore.conversations.find(c => c.conversationInfo.target === 'user-b')
    expect(sc?.conversationInfo.isTop).toBe(true)
    expect(updateUserSetting).toHaveBeenCalledWith(
      USER_SETTING_SCOPE.conversationTop,
      conversationSettingKey(0, 0, 'user-b'),
      '1'
    )
  })

  it('unTopConversation：取消置顶上报墓碑值 "0"', () => {
    const conversationStore = useConversationStore()
    conversationStore.updateConversationInfo(makeConversationInfo({ isTop: true }))
    updateUserSetting.mockClear()

    conversationStore.unTopConversation('user-b')

    expect(updateUserSetting).toHaveBeenCalledWith(
      USER_SETTING_SCOPE.conversationTop,
      conversationSettingKey(0, 0, 'user-b'),
      '0'
    )
  })

  it('silentConversation：开启免打扰上报 value="1"', () => {
    const conversationStore = useConversationStore()
    conversationStore.updateConversationInfo(makeConversationInfo())
    updateUserSetting.mockClear()

    conversationStore.silentConversation('user-b')

    const sc = conversationStore.conversations.find(c => c.conversationInfo.target === 'user-b')
    expect(sc?.conversationInfo.isSilent).toBe(true)
    expect(updateUserSetting).toHaveBeenCalledWith(
      USER_SETTING_SCOPE.conversationSilent,
      conversationSettingKey(0, 0, 'user-b'),
      '1'
    )
  })

  it('unSilentConversation：关闭免打扰上报墓碑值 "0"', () => {
    const conversationStore = useConversationStore()
    conversationStore.updateConversationInfo(makeConversationInfo({ isSilent: true }))
    updateUserSetting.mockClear()

    conversationStore.unSilentConversation('user-b')

    expect(updateUserSetting).toHaveBeenCalledWith(
      USER_SETTING_SCOPE.conversationSilent,
      conversationSettingKey(0, 0, 'user-b'),
      '0'
    )
  })

  it('新会话从设置派生初值：UG 先落地，随后到来的会话直接带上置顶与免打扰', () => {
    const settingStore = useUserSettingStore()
    settingStore.applyEntries([
      { scope: USER_SETTING_SCOPE.conversationTop, key: conversationSettingKey(0, 0, 'user-c'), value: '1', updateDt: 100 },
      { scope: USER_SETTING_SCOPE.conversationSilent, key: conversationSettingKey(0, 0, 'user-c'), value: '1', updateDt: 100 }
    ])

    const conversationStore = useConversationStore()
    conversationStore.updateConversationInfo(makeConversationInfo({ target: 'user-c', isTop: false, isSilent: false }))

    const sc = conversationStore.conversations.find(c => c.conversationInfo.target === 'user-c')
    expect(sc?.conversationInfo.isTop).toBe(true)
    expect(sc?.conversationInfo.isSilent).toBe(true)
  })

  it('更新既有会话时不会用设置覆盖用户刚做出的本地改动', () => {
    const conversationStore = useConversationStore()
    conversationStore.updateConversationInfo(makeConversationInfo({ target: 'user-d' }))
    conversationStore.unTopConversation('user-d')
    updateUserSetting.mockClear()

    // 服务端设置里仍是旧的“已置顶”值（还没来得及被这次取消覆盖），
    // 但这是既有会话的更新分支，不应该用设置回灌覆盖用户刚做的本地改动
    const settingStore = useUserSettingStore()
    settingStore.setLocal(USER_SETTING_SCOPE.conversationTop, conversationSettingKey(0, 0, 'user-d'), '1')

    conversationStore.updateConversationInfo(makeConversationInfo({ target: 'user-d', lastMessage: { timestamp: 2 } as any }))

    const sc = conversationStore.conversations.find(c => c.conversationInfo.target === 'user-d')
    expect(sc?.conversationInfo.isTop).toBe(false)
  })

  describe('projectUserSettings：把设置表投影回已存在的会话行', () => {
    it('已存在的会话行在 applyEntries 之后，projectUserSettings 会把 isTop/isSilent 补上', () => {
      const conversationStore = useConversationStore()
      conversationStore.updateConversationInfo(makeConversationInfo({ target: 'user-e' }))

      const settingStore = useUserSettingStore()
      settingStore.applyEntries([
        { scope: USER_SETTING_SCOPE.conversationTop, key: conversationSettingKey(0, 0, 'user-e'), value: '1', updateDt: 100 },
        { scope: USER_SETTING_SCOPE.conversationSilent, key: conversationSettingKey(0, 0, 'user-e'), value: '1', updateDt: 100 }
      ])

      // 光 applyEntries 不会改动已存在的会话行——这正是修复前的 bug
      let sc = conversationStore.conversations.find(c => c.conversationInfo.target === 'user-e')
      expect(sc?.conversationInfo.isTop).toBe(false)

      conversationStore.projectUserSettings()

      sc = conversationStore.conversations.find(c => c.conversationInfo.target === 'user-e')
      expect(sc?.conversationInfo.isTop).toBe(true)
      expect(sc?.conversationInfo.isSilent).toBe(true)
    })

    it('墓碑值 "0" 能把已置顶的行投影回不置顶', () => {
      const conversationStore = useConversationStore()
      conversationStore.updateConversationInfo(makeConversationInfo({ target: 'user-f', isTop: true }))

      const settingStore = useUserSettingStore()
      settingStore.applyEntries([
        { scope: USER_SETTING_SCOPE.conversationTop, key: conversationSettingKey(0, 0, 'user-f'), value: '1', updateDt: 100 },
        { scope: USER_SETTING_SCOPE.conversationTop, key: conversationSettingKey(0, 0, 'user-f'), value: '0', updateDt: 200 }
      ])
      conversationStore.projectUserSettings()

      const sc = conversationStore.conversations.find(c => c.conversationInfo.target === 'user-f')
      expect(sc?.conversationInfo.isTop).toBe(false)
    })

    it('投影后列表按新的置顶状态重排', () => {
      const conversationStore = useConversationStore()
      conversationStore.updateConversationInfo(makeConversationInfo({ target: 'user-g' }))
      conversationStore.updateConversationInfo(makeConversationInfo({ target: 'user-h' }))
      // 此时 unshift 顺序应为 [user-h, user-g]
      expect(conversationStore.conversations.map(c => c.conversationInfo.target)).toEqual(['user-h', 'user-g'])

      const settingStore = useUserSettingStore()
      settingStore.applyEntries([
        { scope: USER_SETTING_SCOPE.conversationTop, key: conversationSettingKey(0, 0, 'user-g'), value: '1', updateDt: 100 }
      ])
      conversationStore.projectUserSettings()

      expect(conversationStore.conversations[0].conversationInfo.target).toBe('user-g')
      expect(conversationStore.conversations[0].conversationInfo.isTop).toBe(true)
    })
  })
})
