import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// useMessageStore -> useUIStore -> benz-amr-recorder，jsdom 里跑不起来
vi.mock('benz-amr-recorder', () => ({ default: vi.fn() }))

import { useMessageStore } from '@/stores/useMessageStore'
import CallStartMessageContent from '@/webrtc/message/callStartMessageContent'

/** 造一条落在消息列表里的通话记录，content 用真实 encode 结果 */
function callStartProto(callId: string, conversationType = 0) {
  const content = new CallStartMessageContent(callId, 'peer-1', true)
  return {
    messageId: 'msg-' + callId, messageUid: '1', from: 'me', target: 'peer-1',
    conversationType, direction: 0, timestamp: 1000, status: 0, line: 0, tos: '',
    content: content.encode()
  }
}

/** 把消息 content 解回 CallStartMessageContent，断言里读状态用 */
function decode(content: any) {
  const mc = new CallStartMessageContent()
  mc.decode(content)
  return mc
}

function seed(store: any, protoMessages: any[]) {
  store.messages.push({ target: 'peer-1', name: '', protoMessages })
}

describe('useMessageStore.updateCallStatus', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('按 callId 命中并写入状态与结束时间', () => {
    const store = useMessageStore()
    seed(store, [callStartProto('call-1')])

    store.updateCallStatus('call-1', { status: 2, endTime: 202000 })

    const mc = decode(store.messages[0].protoMessages[0].content)
    expect(mc.status).toBe(2)
    expect(mc.endTime).toBe(202000)
  })

  it('增量写入：结束时不冲掉接通时刻，时长才算得出来', () => {
    const store = useMessageStore()
    seed(store, [callStartProto('call-1')])

    store.updateCallStatus('call-1', { status: 1, connectTime: 1000 })
    store.updateCallStatus('call-1', { status: 2, endTime: 202000 })

    const mc = decode(store.messages[0].protoMessages[0].content)
    expect(mc.status).toBe(2)
    expect(mc.connectTime).toBe(1000)
    expect(mc.endTime).toBe(202000)
  })

  it('群聊消息即使 callId 相同也不被改动', () => {
    const store = useMessageStore()
    seed(store, [callStartProto('call-1', 1)])

    store.updateCallStatus('call-1', { status: 3 })

    // toBeFalsy() 对 status===0（合法的"未接听"取值）也会通过，锁不住"没被改动"；
    // decode 未写入 status 时该字段本就是 undefined（CallStartMessageContent
    // 构造函数不设默认值，encode 时 JSON.stringify 会丢掉 undefined 键），
    // 所以这里用 toBeUndefined() 精确断言完全没被碰过。
    const mc = decode(store.messages[0].protoMessages[0].content)
    expect(mc.status).toBeUndefined()
  })

  it('callId 不存在时静默返回，不抛异常', () => {
    const store = useMessageStore()
    seed(store, [callStartProto('call-1')])

    expect(() => store.updateCallStatus('call-不存在', { status: 2 })).not.toThrow()

    const mc = decode(store.messages[0].protoMessages[0].content)
    expect(mc.status).toBeUndefined()
  })

  it('保留 audioOnly 等原有字段，不因改状态而丢失', () => {
    const store = useMessageStore()
    seed(store, [callStartProto('call-1')])

    store.updateCallStatus('call-1', { status: 2, endTime: 5000 })

    const mc = decode(store.messages[0].protoMessages[0].content)
    expect(mc.audioOnly).toBe(true)
    expect(mc.callId).toBe('call-1')
  })
})

describe('useMessageStore.hydrateMessages', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('回灌时把 status=1（通话中）的记录归一成 status=2（已结束）', () => {
    const store = useMessageStore()
    const chats = [{ target: 'peer-1', name: '', protoMessages: [callStartProto('call-1')] }]
    // status=1 是 markCallConnected 写的瞬态；应用崩溃/被杀时 endSession 不会跑，
    // 这条记录会原样落盘。模拟这种"卡在通话中"的持久化状态。
    const raw = decode(chats[0].protoMessages[0].content)
    raw.status = 1
    raw.connectTime = 1000
    chats[0].protoMessages[0].content = raw.encode()

    store.hydrateMessages(chats as any)

    const mc = decode(store.messages[0].protoMessages[0].content)
    expect(mc.status).toBe(2)
    // connectTime 不应被动：确实接通过，只是没有 endTime，
    // 渲染成"通话时长 00:00"比一直显示"通话中"更诚实。
    expect(mc.connectTime).toBe(1000)
    expect(mc.endTime).toBeUndefined()
  })

  it('status=2（已结束）的记录不被归一逻辑改动', () => {
    const store = useMessageStore()
    const chats = [{ target: 'peer-1', name: '', protoMessages: [callStartProto('call-1')] }]
    const raw = decode(chats[0].protoMessages[0].content)
    raw.status = 2
    raw.connectTime = 1000
    raw.endTime = 5000
    chats[0].protoMessages[0].content = raw.encode()

    store.hydrateMessages(chats as any)

    const mc = decode(store.messages[0].protoMessages[0].content)
    expect(mc.status).toBe(2)
    expect(mc.connectTime).toBe(1000)
    expect(mc.endTime).toBe(5000)
  })

  it('status=3（已在其他设备接听）的记录不被归一逻辑改动', () => {
    const store = useMessageStore()
    const chats = [{ target: 'peer-1', name: '', protoMessages: [callStartProto('call-1')] }]
    const raw = decode(chats[0].protoMessages[0].content)
    raw.status = 3
    chats[0].protoMessages[0].content = raw.encode()

    store.hydrateMessages(chats as any)

    const mc = decode(store.messages[0].protoMessages[0].content)
    expect(mc.status).toBe(3)
  })

  it('回灌后 messages 确实被赋值为传入的会话列表', () => {
    const store = useMessageStore()
    const chats = [{ target: 'peer-1', name: '', protoMessages: [callStartProto('call-1')] }]

    store.hydrateMessages(chats as any)

    // messages 是 Pinia ref，赋值后取出来的是 reactive Proxy，
    // 与传入的原始数组不是同一个引用（Object.is 不成立），只能比内容。
    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].target).toBe('peer-1')
    expect(store.messages[0].protoMessages).toHaveLength(1)
  })
})
