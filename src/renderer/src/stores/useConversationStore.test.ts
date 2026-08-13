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
      // 必须先让该行真的因为投影而置顶（走 applyEntries('1') + projectUserSettings），
      // 不能靠新建分支的初始 isTop:true——那条分支会被当时还空的设置表立刻覆盖成 false，
      // 会让这条断言在有没有投影时都成立，测试就失去了区分力
      const settingStore = useUserSettingStore()
      settingStore.applyEntries([
        { scope: USER_SETTING_SCOPE.conversationTop, key: conversationSettingKey(0, 0, 'user-f'), value: '1', updateDt: 100 }
      ])

      const conversationStore = useConversationStore()
      conversationStore.updateConversationInfo(makeConversationInfo({ target: 'user-f' }))
      let sc = conversationStore.conversations.find(c => c.conversationInfo.target === 'user-f')
      expect(sc?.conversationInfo.isTop).toBe(true)

      settingStore.applyEntries([
        { scope: USER_SETTING_SCOPE.conversationTop, key: conversationSettingKey(0, 0, 'user-f'), value: '0', updateDt: 200 }
      ])
      conversationStore.projectUserSettings()

      sc = conversationStore.conversations.find(c => c.conversationInfo.target === 'user-f')
      expect(sc?.conversationInfo.isTop).toBe(false)
    })

    it('设置表里没有对应条目时（老用户升级前只存本地、从未上报过服务端的存量状态），projectUserSettings 不会把 isTop/isSilent 清零', () => {
      const conversationStore = useConversationStore()
      // 直接往 conversations 里塞一行"陈旧缓存"：isTop/isSilent 已经是 true，但设置表对这个
      // key 完全没有条目——这正是老用户升级后首次启动的真实状态（本功能上线前置顶/免打扰
      // 只写本地，从未上报过服务端，所以 user_settings 里天然没有这些条目）
      conversationStore.conversations.push({
        name: 'user-legacy',
        img: '',
        conversationInfo: makeConversationInfo({ target: 'user-legacy', isTop: true, isSilent: true })
      })

      const settingStore = useUserSettingStore()
      expect(settingStore.settingValue(USER_SETTING_SCOPE.conversationTop, conversationSettingKey(0, 0, 'user-legacy'))).toBeUndefined()

      conversationStore.projectUserSettings()

      const sc = conversationStore.conversations.find(c => c.conversationInfo.target === 'user-legacy')
      expect(sc?.conversationInfo.isTop).toBe(true)
      expect(sc?.conversationInfo.isSilent).toBe(true)
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
