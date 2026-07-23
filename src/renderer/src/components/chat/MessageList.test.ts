import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('naive-ui', () => ({ useMessage: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('benz-amr-recorder', () => ({ default: vi.fn() }))
vi.mock('@/websocket/websocketcli', () => ({
  default: { getRemoteMessages: vi.fn(), getGroupInfo: vi.fn(), getUserInfos: vi.fn() }
}))

import MessageList from './MessageList.vue'
import { useConversationStore } from '@/stores/useConversationStore'
import { useUIStore } from '@/stores/useUIStore'

// jsdom 无布局引擎,ChatVirtualList 挂载时会调用 ResizeObserver;这里不关心其测量行为,
// 仅需要一个不抛错的最小 stub,让子组件真实挂载以便 findComponent + $emit 驱动真实事件监听
class ROStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function mountMessageList() {
  vi.stubGlobal('ResizeObserver', ROStub)
  return mount(MessageList, {
    global: {
      stubs: {
        GroupInfo: true,
        UserProfileCard: true,
        ImageViewer: true,
        MessageBubble: true
      }
    }
  })
}

describe('MessageList 滚动清除未读红点', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('子组件 emit user-scroll 时,清零当前会话未读红点', async () => {
    const convStore = useConversationStore()
    convStore.conversations = [{
      name: '张三',
      img: '',
      conversationInfo: {
        conversationType: 0, target: 'u1', line: 0, isTop: false, isSilent: false,
        timestamp: 0, unreadCount: { unread: 3 }, lastMessage: null
      }
    }] as any
    convStore.selectTarget = 'u1'

    const wrapper = mountMessageList()
    await wrapper.findComponent({ name: 'ChatVirtualList' }).vm.$emit('user-scroll')

    expect(convStore.conversations[0].conversationInfo.unreadCount.unread).toBe(0)
  })

  it('应用在后台(isAppVisible 为 false)时,user-scroll 不清除未读红点', async () => {
    const convStore = useConversationStore()
    const uiStore = useUIStore()
    uiStore.visibilityChange('visible')
    uiStore.setWindowFocused(false) // 模拟窗口在后台失焦
    expect(uiStore.isAppVisible).toBe(false)

    convStore.conversations = [{
      name: '张三',
      img: '',
      conversationInfo: {
        conversationType: 0, target: 'u1', line: 0, isTop: false, isSilent: false,
        timestamp: 0, unreadCount: { unread: 5 }, lastMessage: null
      }
    }] as any
    convStore.selectTarget = 'u1'

    const wrapper = mountMessageList()
    await wrapper.findComponent({ name: 'ChatVirtualList' }).vm.$emit('user-scroll')

    expect(convStore.conversations[0].conversationInfo.unreadCount.unread).toBe(5) // 未清除
  })

  it('user-scroll 清除群聊的 @我标记(atMeSet),不再要求滚到底部', async () => {
    const convStore = useConversationStore()
    convStore.conversations = [{
      name: '项目群',
      img: '',
      conversationInfo: {
        conversationType: 1, target: 'g1', line: 0, isTop: false, isSilent: false,
        timestamp: 0, unreadCount: { unread: 2 }, lastMessage: null
      }
    }] as any
    convStore.selectTarget = 'g1'
    convStore.atMeSet.add('g1')

    const wrapper = mountMessageList()
    const vl = wrapper.findComponent({ name: 'ChatVirtualList' })
    await vl.vm.$emit('user-scroll')
    expect(convStore.atMeSet.has('g1')).toBe(false) // 任意滚动即清除,不要求到底
  })
})
