import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// useMessageStore -> useUIStore -> benz-amr-recorder，jsdom 里跑不起来
vi.mock('benz-amr-recorder', () => ({ default: vi.fn() }))

import { useMessageStore } from './useMessageStore'
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

    const mc = decode(store.messages[0].protoMessages[0].content)
    expect(mc.status).toBeFalsy()
  })

  it('callId 不存在时静默返回，不抛异常', () => {
    const store = useMessageStore()
    seed(store, [callStartProto('call-1')])

    expect(() => store.updateCallStatus('call-不存在', { status: 2 })).not.toThrow()

    const mc = decode(store.messages[0].protoMessages[0].content)
    expect(mc.status).toBeFalsy()
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
