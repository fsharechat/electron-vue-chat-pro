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
// 捕获 mock 出来的 VueWebSocket 实例本身，用来断言 loginOut() 真的调用了 destroy()
// （而不只是发一条 DISCONNECT 信令就把 vueSocket 变量置空）
let capturedInstance: { sendDisConnectMessage: ReturnType<typeof vi.fn>; modifyMyInfo: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> } | null = null
vi.mock('@/websocket/index', () => ({
  default: vi.fn().mockImplementation((_errorHandler, storeDispatcher) => {
    capturedDispatcher = storeDispatcher
    capturedInstance = { sendDisConnectMessage: vi.fn(), modifyMyInfo: vi.fn(), destroy: vi.fn() }
    return capturedInstance
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
    capturedInstance = null
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
    capturedInstance = null
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

  it('loginOut 会摘掉旧连接的 handler，不只是发一条 DISCONNECT 信令（删掉 vueSocket?.destroy() 这一行，这个用例会红）', () => {
    // DISCONNECT 信令发出后服务端要一个 RTT 才会真正关闭通道；这期间到达的应答如果还能被派发，
    // clearAll() 之后紧接着落地的就是旧账号的设置数据。真正阻断这条路径的是 VueWebSocket.destroy()
    // 清空 handlerList/storeDispatcher（见 websocket/index.test.ts），这里只断言 loginOut 确实
    // 调用了它，而不是像旧代码那样只把本地 vueSocket 变量置空、让旧实例继续监听。
    const authStore = useAuthStore()
    authStore.initData(() => {})
    expect(capturedInstance).toBeTruthy()

    authStore.loginOut()

    expect(capturedInstance!.destroy).toHaveBeenCalledTimes(1)
  })
})
