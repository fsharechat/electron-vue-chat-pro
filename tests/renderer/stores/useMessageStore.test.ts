import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// useMessageStore -> useUIStore -> benz-amr-recorder，jsdom 里跑不起来
vi.mock('benz-amr-recorder', () => ({ default: vi.fn() }))

import { useMessageStore } from '@/stores/useMessageStore'
import { useTranscriptStore } from '@/stores/useTranscriptStore'
import { useUIStore } from '@/stores/useUIStore'
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

describe('useMessageStore 语音已播放状态', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  function voice(id: string, direction: number, status: number) {
    return {
      messageId: id, messageUid: 'uid-' + id, from: direction === 1 ? 'peer-1' : 'me', target: 'peer-1',
      conversationType: 0, direction, timestamp: 1000, status, line: 0, tos: '',
      content: { type: 2, searchableContent: '' }
    }
  }

  it('markPlayed 把他人语音置为 Played(7)', () => {
    const store = useMessageStore()
    seed(store, [voice('v1', 1, 5)])

    store.markPlayed('v1')

    expect(store.messages[0].protoMessages[0].status).toBe(7)
  })

  it('markPlayed 不改自己发的消息', () => {
    const store = useMessageStore()
    seed(store, [voice('v1', 0, 1)])

    store.markPlayed('v1')

    expect(store.messages[0].protoMessages[0].status).toBe(1)
  })

  it('addOldMessage 加载的他人语音直接视为已播放', () => {
    const store = useMessageStore()
    seed(store, [])
    const old = voice('old', 1, 5)

    store.addOldMessage(old as any)

    expect(store.messages[0].protoMessages[0].status).toBe(7)
  })

  it('hydrateMessages 首次升级把已有的他人语音置为已播放，只做一次', () => {
    const store = useMessageStore()
    store.hydrateMessages([{ target: 'peer-1', name: '', protoMessages: [voice('a', 1, 5), voice('b', 0, 1)] }] as any)

    expect(store.messages[0].protoMessages[0].status).toBe(7)
    expect(store.messages[0].protoMessages[1].status).toBe(1)

    // 迁移标记已写入，之后新收到并持久化的未播放语音不能再被批量置为已播放
    store.hydrateMessages([{ target: 'peer-1', name: '', protoMessages: [voice('c', 1, 5)] }] as any)
    expect(store.messages[0].protoMessages[0].status).toBe(5)
  })
})

describe('useMessageStore 实时语音自动转文字', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  function incoming(id: string, type = 2) {
    return {
      messageId: id, messageUid: 'uid-' + id, from: 'peer-1', target: 'peer-1',
      conversationType: 0, direction: 1, timestamp: 1000, status: 5, line: 0, tos: '',
      content: { type, searchableContent: '' }
    }
  }

  function setup(firstLogin: boolean) {
    const ui = useUIStore()
    ui.setFirstLogin(firstLogin)
    vi.spyOn(ui, 'playMsgNotify').mockImplementation(() => {})
    const ts = useTranscriptStore()
    const spy = vi.spyOn(ts, 'enqueueAuto').mockImplementation(() => {})
    const store = useMessageStore()
    seed(store, [])
    return { store, spy }
  }

  it('实时收到他人语音时交给 enqueueAuto', () => {
    const { store, spy } = setup(false)

    store.addProtoMessage(incoming('v1') as any)

    expect(spy).toHaveBeenCalledWith('uid-v1')
  })

  it('初始拉取（firstLogin）期间不自动识别', () => {
    const { store, spy } = setup(true)

    store.addProtoMessage(incoming('v1') as any)

    expect(spy).not.toHaveBeenCalled()
  })

  it('非语音、自己发的不自动识别', () => {
    const { store, spy } = setup(false)

    store.addProtoMessage(incoming('t1', 1) as any)
    store.addProtoMessage({ ...incoming('v2'), direction: 0 } as any)

    expect(spy).not.toHaveBeenCalled()
  })

  it('firstLogin 全量拉取：已有会话时他人语音置为 Played 且不入队', () => {
    const { store, spy } = setup(true)

    const m = incoming('v1')
    store.addProtoMessage(m as any)

    expect(store.messages[0].protoMessages[0].status).toBe(7)
    expect(spy).not.toHaveBeenCalled()
  })

  it('firstLogin 全量拉取：没有会话（新建会话分支）时同样置为 Played 且不入队', () => {
    const ui = useUIStore()
    ui.setFirstLogin(true)
    vi.spyOn(ui, 'playMsgNotify').mockImplementation(() => {})
    const spy = vi.spyOn(useTranscriptStore(), 'enqueueAuto').mockImplementation(() => {})
    const store = useMessageStore()

    store.addProtoMessage(incoming('v1') as any)

    expect(store.messages).toHaveLength(1)
    expect(store.messages[0].protoMessages[0].status).toBe(7)
    expect(spy).not.toHaveBeenCalled()
  })

  it('非 firstLogin：语音保持 Unread(5) 并入队（已有会话与新建会话两个分支）', () => {
    const { store, spy } = setup(false)
    store.addProtoMessage(incoming('v1') as any)
    expect(store.messages[0].protoMessages[0].status).toBe(5)
    expect(spy).toHaveBeenCalledTimes(1)

    store.addProtoMessage({ ...incoming('v2'), target: 'peer-2' } as any)
    const chat2 = store.messages.find((c: any) => c.target === 'peer-2')!
    expect(chat2.protoMessages[0].status).toBe(5)
    expect(spy).toHaveBeenCalledTimes(2)
  })

  it('同一 messageId 重复添加只入队一次', () => {
    const { store, spy } = setup(false)

    store.addProtoMessage(incoming('v1') as any)
    store.addProtoMessage(incoming('v1') as any)

    expect(spy).toHaveBeenCalledTimes(1)
  })
})

describe('迁移标记（全新安装）', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('hydrateMessages([]) 也写入迁移标记，之后的未读语音不被批量置为已播放', () => {
    const store = useMessageStore()
    store.hydrateMessages([])
    expect(localStorage.getItem('voice-played-migrated-v1')).toBe('1')

    store.hydrateMessages([{ target: 'peer-1', name: '', protoMessages: [
      { messageId: 'v', messageUid: 'u', from: 'peer-1', target: 'peer-1', conversationType: 0, direction: 1,
        timestamp: 1, status: 5, line: 0, tos: '', content: { type: 2, searchableContent: '' } }
    ] }] as any)
    expect(store.messages[0].protoMessages[0].status).toBe(5)
  })
})
