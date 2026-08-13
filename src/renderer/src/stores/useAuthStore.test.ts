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
