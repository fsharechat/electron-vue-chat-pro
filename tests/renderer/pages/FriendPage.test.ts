import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

// FriendPage -> useConversationStore -> websocketcli -> useUIStore 会引入 benz-amr-recorder，
// 与 SavedGroupList.test.ts / useAuthStore.test.ts 保持一致的 mock 方式
vi.mock('benz-amr-recorder', () => ({ default: vi.fn() }))
vi.mock('@/websocket/websocketcli', () => ({
  default: { getGroupInfo: vi.fn(), getUserInfos: vi.fn() }
}))

const pushMock = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushMock })
}))

import FriendPage from '@/pages/FriendPage.vue'
import { useFriendStore } from '@/stores/useFriendStore'
import { useGroupStore } from '@/stores/useGroupStore'
import { useConversationStore } from '@/stores/useConversationStore'
import { useUserSettingStore } from '@/stores/useUserSettingStore'
import { USER_SETTING_SCOPE, conversationSettingKey } from '@/constant'

describe('FriendPage：新建会话行绕开 updateConversationInfo 的 deriveFlag 派生', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    pushMock.mockClear()
  })

  it('openGroupConversation 新建的会话行会按已落地的设置表投影置顶/免打扰（删掉 projectUserSettings() 调用，这个用例会红）', async () => {
    const groupId = 'group-x'
    const key = conversationSettingKey(1, 0, groupId)

    const settingStore = useUserSettingStore()
    // 模拟 UG 已经落地：这个群置顶 + 免打扰，但还没有任何消息到达、没有会话行
    settingStore.applyEntries([
      { scope: USER_SETTING_SCOPE.favoriteGroup, key: groupId, value: '1', updateDt: 100 },
      { scope: USER_SETTING_SCOPE.conversationTop, key, value: '1', updateDt: 100 },
      { scope: USER_SETTING_SCOPE.conversationSilent, key, value: '1', updateDt: 100 }
    ])

    const groupStore = useGroupStore()
    groupStore.groupInfoList.push({ target: groupId, name: '测试群', portrait: '', memberCount: 2, owner: 'u1', type: 0 })

    const friendStore = useFriendStore()
    friendStore.selectFriendId = -1 // 展示「群聊」面板（SavedGroupList）

    const wrapper = mount(FriendPage)

    const item = wrapper.get('[data-testid="saved-group-item"]')
    await item.trigger('click')

    const convStore = useConversationStore()
    const sc = convStore.conversations.find(c => c.conversationInfo.target === groupId)
    expect(sc).toBeTruthy()
    // 新建行前的默认值是 false（ProtoConversationInfo 的默认值），不投影的话这里会保持 false
    expect(sc?.conversationInfo.isTop).toBe(true)
    expect(sc?.conversationInfo.isSilent).toBe(true)
    expect(pushMock).toHaveBeenCalledWith('/conversation')
  })

  it('sendMessage 新建的会话行会按已落地的设置表投影置顶/免打扰（删掉 projectUserSettings() 调用，这个用例会红）', async () => {
    const target = 'friend-b'
    const key = conversationSettingKey(0, 0, target)

    const settingStore = useUserSettingStore()
    settingStore.applyEntries([
      { scope: USER_SETTING_SCOPE.conversationTop, key, value: '1', updateDt: 100 },
      { scope: USER_SETTING_SCOPE.conversationSilent, key, value: '1', updateDt: 100 }
    ])

    const friendStore = useFriendStore()
    friendStore.friendlist.push({
      id: 1, wxid: target, initial: 'F', img: '', signature: '', nickname: 'friendB', sex: 0, remark: '', area: '', mobile: ''
    })
    friendStore.selectFriendId = 1

    // FriendInfo 依赖 naive-ui 的 useMessage()，需要 provider 上下文；这里只关心
    // FriendPage 自己的 sendMessage 分支，把 FriendInfo 换成一个能触发同名事件的哑组件
    const wrapper = mount(FriendPage, {
      global: {
        stubs: {
          FriendInfo: {
            template: '<button data-testid="stub-send" @click="$emit(\'send-message\')" />'
          }
        }
      }
    })

    await wrapper.get('[data-testid="stub-send"]').trigger('click')

    const convStore = useConversationStore()
    const sc = convStore.conversations.find(c => c.conversationInfo.target === target)
    expect(sc).toBeTruthy()
    expect(sc?.conversationInfo.isTop).toBe(true)
    expect(sc?.conversationInfo.isSilent).toBe(true)
    expect(pushMock).toHaveBeenCalledWith('/conversation')
  })
})
