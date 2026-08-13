import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useAuthStore } from './useAuthStore'
import { useConversationStore } from './useConversationStore'
import { useUserSettingStore } from './useUserSettingStore'
import { USER_SETTING_SCOPE, conversationSettingKey } from '../constant'

vi.mock('benz-amr-recorder', () => ({ default: vi.fn() }))
vi.mock('@wcjiang/notify', () => ({ default: vi.fn() }))

// 只关心 initData 里传给 VueWebSocket 的 dispatcher：捕获它，绕开真实 socket 连接，
// 直接调用 dispatcher('applyUserSettings', ...) 来驱动 useAuthStore.ts 里那一支 map 分支
let capturedDispatcher: ((action: string, data: unknown) => void) | null = null
vi.mock('@/websocket/index', () => ({
  default: vi.fn().mockImplementation((_errorHandler, storeDispatcher) => {
    capturedDispatcher = storeDispatcher
    return { sendDisConnectMessage: vi.fn(), modifyMyInfo: vi.fn() }
  })
}))

vi.mock('@/websocket/websocketcli', () => ({
  default: { setInstance: vi.fn(), updateUserSetting: vi.fn(), getGroupInfo: vi.fn(), getUserInfos: vi.fn() }
}))

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

describe('useAuthStore.initData：会话设置的两个投影调用点', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    capturedDispatcher = null
  })

  it('dispatcher 收到 applyUserSettings 后，已存在的会话行会被投影（不删这行调用会红）', () => {
    const conversationStore = useConversationStore()
    conversationStore.updateConversationInfo(makeConversationInfo({ target: 'user-x' }))

    const authStore = useAuthStore()
    authStore.initData(() => {})
    expect(capturedDispatcher).toBeTruthy()

    capturedDispatcher!('applyUserSettings', [
      { scope: USER_SETTING_SCOPE.conversationTop, key: conversationSettingKey(0, 0, 'user-x'), value: '1', updateDt: 100 }
    ])

    const sc = conversationStore.conversations.find(c => c.conversationInfo.target === 'user-x')
    expect(sc?.conversationInfo.isTop).toBe(true)
  })

  it('登录时从 LocalStore 回灌会话缓存后，也会按当前设置表投影一次（不删这行调用会红）', () => {
    // 预置：conversations 缓存里的行是"陈旧的" isTop=false，但设置表已经记着置顶
    localStorage.setItem('coversations', JSON.stringify([
      { name: 'user-y', img: '', conversationInfo: makeConversationInfo({ target: 'user-y', isTop: false }) }
    ]))

    const settingStore = useUserSettingStore()
    settingStore.applyEntries([
      { scope: USER_SETTING_SCOPE.conversationTop, key: conversationSettingKey(0, 0, 'user-y'), value: '1', updateDt: 100 }
    ])

    const authStore = useAuthStore()
    authStore.initData(() => {})

    const conversationStore = useConversationStore()
    const sc = conversationStore.conversations.find(c => c.conversationInfo.target === 'user-y')
    expect(sc?.conversationInfo.isTop).toBe(true)
  })
})

describe('useAuthStore.loginOut：设置与 version 必须同生共死地清空', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    capturedDispatcher = null
  })

  it('登出会清空用户设置与 version（删掉 clearAll() 调用这个用例会红）', () => {
    const settingStore = useUserSettingStore()
    settingStore.applyEntries([
      { scope: USER_SETTING_SCOPE.favoriteGroup, key: 'group-1', value: '1', updateDt: 100 }
    ])
    expect(settingStore.version).toBe(100)
    expect(settingStore.settingValue(USER_SETTING_SCOPE.favoriteGroup, 'group-1')).toBe('1')

    const authStore = useAuthStore()
    authStore.loginOut()

    expect(settingStore.version).toBe(0)
    expect(settingStore.settingValue(USER_SETTING_SCOPE.favoriteGroup, 'group-1')).toBeUndefined()
    expect(Object.keys(settingStore.settings)).toHaveLength(0)
  })

  it('登出后换账号登录，会话行不带上一个账号残留的 isTop/isSilent', () => {
    // 账号 A：设置了置顶，且会话行也反映了这个置顶
    const settingStore = useUserSettingStore()
    const conversationStore = useConversationStore()
    conversationStore.updateConversationInfo(makeConversationInfo({ target: 'group-a', conversationType: 1 }))
    settingStore.applyEntries([
      { scope: USER_SETTING_SCOPE.conversationTop, key: conversationSettingKey(1, 0, 'group-a'), value: '1', updateDt: 50 }
    ])
    conversationStore.projectUserSettings()
    expect(conversationStore.conversations.find(c => c.conversationInfo.target === 'group-a')?.conversationInfo.isTop).toBe(true)

    const authStore = useAuthStore()
    authStore.loginOut()

    // 账号 A 的会话行与设置都应从内存中清空
    expect(conversationStore.conversations).toHaveLength(0)
    expect(settingStore.settingValue(USER_SETTING_SCOPE.conversationTop, conversationSettingKey(1, 0, 'group-a'))).toBeUndefined()

    // 账号 B 登录，服务端推来同一个 target（不同账号但巧合同名/同 id 的会话），未置顶
    conversationStore.updateConversationInfo(makeConversationInfo({ target: 'group-a', conversationType: 1, isTop: false }))
    expect(conversationStore.conversations.find(c => c.conversationInfo.target === 'group-a')?.conversationInfo.isTop).toBe(false)
  })
})
