import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// useMessageStore -> useUIStore -> benz-amr-recorder，jsdom 里跑不起来
vi.mock('benz-amr-recorder', () => ({ default: vi.fn() }))

import { useMessageStore, TAIL_GAP_UID } from '@/stores/useMessageStore'

function msg(uid: string, id = 'id-' + uid) {
  return {
    messageId: id, messageUid: uid, from: 'peer-1', target: 'g1',
    conversationType: 1, direction: 1, timestamp: 1000, status: 5, line: 0, tos: '',
    content: { type: 1, searchableContent: uid }
  }
}

function uids(store: any) {
  return store.messages[0].protoMessages.map((m: any) => m.messageUid)
}

describe('useMessageStore 会话断层', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('丢弃断层以下的缓存消息，保留断层及以上', () => {
    const store = useMessageStore()
    store.messages.push({ target: 'g1', name: '', protoMessages: [msg('5'), msg('50'), msg('100'), msg('101')] } as any)

    store.applyConversationGap('g1', '100')

    expect(uids(store)).toEqual(['100', '101'])
  })

  it('按 64 位整数比较 uid，不受 JS number 精度和字符串字典序影响', () => {
    const store = useMessageStore()
    store.messages.push({ target: 'g1', name: '', protoMessages: [
      msg('9007199254740993'), msg('9007199254740995'), msg('10000000000000000'),
    ] } as any)

    store.applyConversationGap('g1', '9007199254740994')

    expect(uids(store)).toEqual(['9007199254740995', '10000000000000000'])
  })

  it('尚未 ack 的消息（uid 为 0）和流式占位不丢', () => {
    const store = useMessageStore()
    store.messages.push({ target: 'g1', name: '', protoMessages: [
      msg('5'), msg('100'), msg('0', 'pending'), { ...msg('5'), messageId: 'stream_x', messageUid: undefined },
    ] } as any)

    store.applyConversationGap('g1', '100')

    expect(store.messages[0].protoMessages.map((m: any) => m.messageId)).toEqual(['id-100', 'pending', 'stream_x'])
  })

  it('尾部断层清掉全部已有历史，返回 true 由调用方补拉最新一页', () => {
    const store = useMessageStore()
    store.messages.push({ target: 'g1', name: '', protoMessages: [msg('5'), msg('50'), msg('0', 'pending')] } as any)

    const isTail = store.applyConversationGap('g1', TAIL_GAP_UID)

    expect(isTail).toBe(true)
    expect(uids(store)).toEqual(['0'])
  })

  it('普通断层返回 false', () => {
    const store = useMessageStore()
    store.messages.push({ target: 'g1', name: '', protoMessages: [msg('5')] } as any)

    expect(store.applyConversationGap('g1', '100')).toBe(false)
  })

  it('没有缓存的会话不受影响', () => {
    const store = useMessageStore()
    store.messages.push({ target: 'g2', name: '', protoMessages: [msg('5')] } as any)

    store.applyConversationGap('g1', '100')

    expect(store.messages[0].protoMessages.length).toBe(1)
  })
})

describe('useMessageStore 尾部断层补拉', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('拉最新一页并按时间升序放回缓存', async () => {
    const webSocketClient = (await import('@/websocket/websocketcli')).default as any
    // 服务端 LRM 按 uid 降序返回
    const spy = vi.spyOn(webSocketClient, 'getRemoteMessages').mockResolvedValue({
      result: JSON.stringify({ count: 2, messageResponseList: [
        { messageId: '200', localMessageId: '0', from: 'peer-1', target: 'g1', conversationType: 1, line: 0, timestamp: 2000, content: { type: 1, searchableContent: 'b' } },
        { messageId: '190', localMessageId: '0', from: 'peer-1', target: 'g1', conversationType: 1, line: 0, timestamp: 1900, content: { type: 1, searchableContent: 'a' } },
      ] })
    })
    const store = useMessageStore()
    store.messages.push({ target: 'g1', name: '', protoMessages: [] } as any)

    await store.fillTailGap(1, 'g1')

    expect(spy.mock.calls[0][1]).toBe('0')
    expect(uids(store)).toEqual(['190', '200'])
  })
})
