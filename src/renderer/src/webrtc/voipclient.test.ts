// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
// voipclient.ts pulls in useMessageStore -> useUIStore, which imports this
// audio-recorder package; it doesn't run in jsdom. Same mock used by the
// existing useUIStore/MessageList tests.
vi.mock('benz-amr-recorder', () => ({ default: vi.fn() }))
import VoipClient from './voipclient'
import CallState from './callState'
import CallEndReason from './callEndReason'
import CallTakenMessageContent from './message/callTakenMessageContent'
import CallStartMessageContent from './message/callStartMessageContent'
import CallByeMessageContent from './message/callByeMessageContent'
import MessageContentType from '../websocket/message/messageContentType'
import { useMessageStore } from '../stores/useMessageStore'

// endSession 会调 useMessageStore() 写通话记录，既有的 cancelCall / endByRemoteBye /
// 406 用例也都会走到那里。没有 active pinia 它们会集体报
// "getActivePinia was called with no active Pinia"，所以这里统一给每个用例配一个。
beforeEach(() => {
  setActivePinia(createPinia())
})

/**
 * These tests target the pure call-state bookkeeping in VoipClient:
 * the cancelCall / endByRemoteBye split, the 406 (CallTaken) send/receive
 * paths, and the duplicate-CallStart guard. `offerMessage` is stubbed out
 * (it otherwise reaches into the real websocket client and Pinia store),
 * and `currentEngineCallback` is a plain spy object so CallSession's ring
 * control calls have somewhere harmless to land. None of this touches
 * RTCPeerConnection or the DOM: `closeCall()` no-ops whenever
 * `myPeerConnection` is unset, which is always true in these tests.
 */
function makeClient() {
  const client = new VoipClient({})
  client.offerMessage = vi.fn()
  client.currentEngineCallback = {
    shouldStartRing: vi.fn(),
    shouldSopRing: vi.fn(),
    onReceiveCall: vi.fn()
  }
  return client
}

function makeSession(client, { callId = 'call-1', clientId = 'peer-1', state = CallState.STATUS_INCOMING } = {}) {
  const session = client.newSession(clientId, false, callId)
  session.callState = state // set directly, bypass setState's ring side-effects during arrange
  client.currentSession = session
  return session
}

function encodeProtoMessage(content, { direction = 1, timestamp = Date.now(), from = 'peer-1' } = {}) {
  return {
    direction,
    timestamp,
    from,
    conversationType: 0,
    content: content.encode()
  }
}

describe('VoipClient cancelCall / endByRemoteBye split', () => {
  let client
  beforeEach(() => {
    client = makeClient()
  })

  it('cancelCall sends Bye and, while ringing, also broadcasts a 406 rejected', () => {
    makeSession(client, { state: CallState.STATUS_INCOMING })

    client.cancelCall()

    expect(client.offerMessage).toHaveBeenCalledTimes(2)
    const [byeCall, takenCall] = client.offerMessage.mock.calls
    expect(byeCall[1]).toBeInstanceOf(CallByeMessageContent)
    expect(takenCall[1]).toBeInstanceOf(CallTakenMessageContent)
    expect(takenCall[1].reason).toBe(CallTakenMessageContent.REASON_REJECTED)
    expect(client.currentSession).toBeNull()
  })

  it('cancelCall while connected sends only Bye, no 406 noise', () => {
    makeSession(client, { state: CallState.STATUS_CONNECTED })

    client.cancelCall()

    expect(client.offerMessage).toHaveBeenCalledTimes(1)
    expect(client.offerMessage.mock.calls[0][1]).toBeInstanceOf(CallByeMessageContent)
    expect(client.currentSession).toBeNull()
  })

  it('endByRemoteBye ends the call without sending anything (no Bye, no 406)', () => {
    makeSession(client, { state: CallState.STATUS_CONNECTED })

    client.endByRemoteBye()

    expect(client.offerMessage).not.toHaveBeenCalled()
    expect(client.currentSession).toBeNull()
  })
})

describe('VoipClient duplicate CallStart guard', () => {
  let client
  beforeEach(() => {
    client = makeClient()
  })

  it('ignores a repeat CallStart for the callId already in the current session', () => {
    const session = makeSession(client, { callId: 'call-1', clientId: 'peer-1', state: CallState.STATUS_CONNECTED })
    client.rejectOtherCall = vi.fn()

    const dup = new CallStartMessageContent('call-1', 'me', true)
    client.onReceiveMessage(encodeProtoMessage(dup, { from: 'peer-1' }))

    expect(client.rejectOtherCall).not.toHaveBeenCalled()
    expect(client.currentSession).toBe(session) // untouched, no Bye sent, no rebuild
  })

  it('sends Bye (via rejectOtherCall) for a genuinely different concurrent CallStart', () => {
    makeSession(client, { callId: 'call-1', clientId: 'peer-1', state: CallState.STATUS_CONNECTED })
    client.rejectOtherCall = vi.fn()

    const other = new CallStartMessageContent('call-2', 'me', true)
    client.onReceiveMessage(encodeProtoMessage(other, { from: 'peer-2' }))

    expect(client.rejectOtherCall).toHaveBeenCalledWith('call-2', 'peer-2')
  })
})

describe('VoipClient 406 (CallTaken) receive path', () => {
  let client
  beforeEach(() => {
    client = makeClient()
  })

  it('ends the ringing session with REASON_RejectByOtherClient on a self-device "rejected" sync', () => {
    makeSession(client, { callId: 'call-1', state: CallState.STATUS_INCOMING })
    const didEnd = vi.fn()
    client.currentSession.sessionCallback = { didChangeState: vi.fn(), didCallEndWithReason: didEnd }

    const taken = new CallTakenMessageContent()
    taken.callId = 'call-1'
    taken.reason = CallTakenMessageContent.REASON_REJECTED
    taken.deviceId = 'other-device'

    client.onReceiveMessage(encodeProtoMessage(taken, { direction: 0, from: 'peer-1' }))

    expect(didEnd).toHaveBeenCalledWith(CallEndReason.REASON_RejectByOtherClient, '')
    expect(client.currentSession).toBeNull()
  })

  it('ends the ringing session with REASON_AcceptByOtherClient on a self-device "answered" sync', () => {
    makeSession(client, { callId: 'call-1', state: CallState.STATUS_INCOMING })
    const didEnd = vi.fn()
    client.currentSession.sessionCallback = { didChangeState: vi.fn(), didCallEndWithReason: didEnd }

    const taken = new CallTakenMessageContent()
    taken.callId = 'call-1'
    taken.reason = CallTakenMessageContent.REASON_ANSWERED
    taken.deviceId = 'other-device'

    client.onReceiveMessage(encodeProtoMessage(taken, { direction: 0, from: 'peer-1' }))

    expect(didEnd).toHaveBeenCalledWith(CallEndReason.REASON_AcceptByOtherClient, '')
    expect(client.currentSession).toBeNull()
  })

  it('ignores a 406 for a different callId', () => {
    const session = makeSession(client, { callId: 'call-1', state: CallState.STATUS_INCOMING })

    const taken = new CallTakenMessageContent()
    taken.callId = 'call-other'
    taken.reason = CallTakenMessageContent.REASON_REJECTED
    taken.deviceId = 'other-device'

    client.onReceiveMessage(encodeProtoMessage(taken, { direction: 0, from: 'peer-1' }))

    expect(client.currentSession).toBe(session)
  })

  it('ignores a 406 once the call is no longer ringing (already connected)', () => {
    const session = makeSession(client, { callId: 'call-1', state: CallState.STATUS_CONNECTED })

    const taken = new CallTakenMessageContent()
    taken.callId = 'call-1'
    taken.reason = CallTakenMessageContent.REASON_REJECTED
    taken.deviceId = 'other-device'

    client.onReceiveMessage(encodeProtoMessage(taken, { direction: 0, from: 'peer-1' }))

    expect(client.currentSession).toBe(session)
  })

  it('a same-account 406 (direction 0) passes the outer receive filter that normally requires direction 1', () => {
    makeSession(client, { callId: 'call-1', state: CallState.STATUS_INCOMING })

    const taken = new CallTakenMessageContent()
    taken.callId = 'call-1'
    taken.reason = CallTakenMessageContent.REASON_ANSWERED
    taken.deviceId = 'other-device'

    client.onReceiveMessage(encodeProtoMessage(taken, { direction: 0, from: 'peer-1' }))

    // If the outer filter had dropped it, currentSession would remain untouched.
    expect(client.currentSession).toBeNull()
  })

  it('the direction-0 relaxation is scoped to 406 only: a direction-0 CallStart is still dropped by the outer filter', () => {
    // No currentSession yet; a direction-0 non-406 message must be filtered out
    // before reaching the dispatch logic, so no incoming session gets created.
    const start = new CallStartMessageContent('call-9', 'me', true)
    expect(start.type).toBe(MessageContentType.VOIP_CONTENT_TYPE_START)

    client.onReceiveMessage(encodeProtoMessage(start, { direction: 0, from: 'peer-1' }))

    expect(client.currentSession).toBeUndefined()
    expect(client.currentEngineCallback.onReceiveCall).not.toHaveBeenCalled()
  })
})

/**
 * 通话记录状态写入：voipclient 是唯一同时知道 callId、状态迁移和结束原因的地方，
 * 状态因此写在这一层。这些用例走真实的 messageStore，断言消息 content 被改对。
 */
describe('VoipClient 写本地通话记录状态', () => {
  let client

  beforeEach(() => {
    client = makeClient()
  })

  function seedCallRecord(callId) {
    const store = useMessageStore()
    const content = new CallStartMessageContent(callId, 'peer-1', true)
    store.messages.push({
      target: 'peer-1', name: '', protoMessages: [{
        messageId: 'msg-1', messageUid: '1', from: 'me', target: 'peer-1',
        conversationType: 0, direction: 0, timestamp: 1000, status: 0, line: 0, tos: '',
        content: content.encode()
      }]
    })
    return store
  }

  function readRecord(store) {
    const mc = new CallStartMessageContent()
    mc.decode(store.messages[0].protoMessages[0].content)
    return mc
  }

  it('接通时写 status=1 与接通时刻', () => {
    const store = seedCallRecord('call-1')
    makeSession(client, { callId: 'call-1', state: CallState.STATUS_CONNECTING })

    client.markCallConnected()

    const mc = readRecord(store)
    expect(mc.status).toBe(1)
    expect(mc.connectTime).toBeGreaterThan(0)
  })

  it('接通后挂断写 status=2，接通时刻保留下来供算时长', () => {
    const store = seedCallRecord('call-1')
    makeSession(client, { callId: 'call-1', state: CallState.STATUS_CONNECTED })

    client.markCallConnected()
    const connectTime = readRecord(store).connectTime
    client.cancelCall()

    const mc = readRecord(store)
    expect(mc.status).toBe(2)
    expect(mc.connectTime).toBe(connectTime)
    expect(mc.endTime).toBeGreaterThan(0)
  })

  it('没接通就取消写 status=2 且无接通时刻 —— 渲染成「对方未接听」', () => {
    const store = seedCallRecord('call-1')
    makeSession(client, { callId: 'call-1', state: CallState.STATUS_OUTGOING })

    client.cancelCall()

    const mc = readRecord(store)
    expect(mc.status).toBe(2)
    expect(mc.connectTime).toBeFalsy()
  })

  it('对端 Bye 结束写 status=2', () => {
    const store = seedCallRecord('call-1')
    makeSession(client, { callId: 'call-1', state: CallState.STATUS_CONNECTED })

    const bye = new CallByeMessageContent()
    bye.callId = 'call-1'
    client.onReceiveMessage(encodeProtoMessage(bye))

    expect(readRecord(store).status).toBe(2)
  })

  it('其他设备接听（406）写 status=3', () => {
    const store = seedCallRecord('call-1')
    makeSession(client, { callId: 'call-1', state: CallState.STATUS_INCOMING })

    const taken = new CallTakenMessageContent()
    taken.callId = 'call-1'
    taken.reason = CallTakenMessageContent.REASON_ANSWERED
    client.onReceiveMessage(encodeProtoMessage(taken, { direction: 0, from: 'me' }))

    expect(readRecord(store).status).toBe(3)
  })

  it('其他设备拒接（406 rejected）写 status=2，语义上确实没人接', () => {
    const store = seedCallRecord('call-1')
    makeSession(client, { callId: 'call-1', state: CallState.STATUS_INCOMING })

    const taken = new CallTakenMessageContent()
    taken.callId = 'call-1'
    taken.reason = CallTakenMessageContent.REASON_REJECTED
    client.onReceiveMessage(encodeProtoMessage(taken, { direction: 0, from: 'me' }))

    expect(readRecord(store).status).toBe(2)
  })

  it('重复调用 markCallConnected 不覆盖首次的 connectTime', () => {
    const store = seedCallRecord('call-1')
    makeSession(client, { callId: 'call-1', state: CallState.STATUS_CONNECTING })

    vi.useFakeTimers()
    try {
      vi.setSystemTime(1000)
      client.markCallConnected()
      const firstConnectTime = readRecord(store).connectTime
      expect(firstConnectTime).toBe(1000)

      // 模拟 ICE connected → completed → connected 这种不经过 disconnected 的
      // 回跳：markCallConnected 会被再次调用，不应该覆盖首次接通时刻。
      vi.setSystemTime(5000)
      client.markCallConnected()

      const mc = readRecord(store)
      expect(mc.connectTime).toBe(firstConnectTime)
      expect(mc.status).toBe(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ICE 状态变为 connected 时通过 handleICEConnectionStateChangeEvent 真正接上 markCallConnected', () => {
    const store = seedCallRecord('call-1')
    makeSession(client, { callId: 'call-1', state: CallState.STATUS_CONNECTING })
    // 不用真的 RTCPeerConnection，只给 handleICEConnectionStateChangeEvent
    // 读取 iceConnectionState 需要的最小形状。
    client.myPeerConnection = { iceConnectionState: 'connected' }

    client.handleICEConnectionStateChangeEvent()

    const mc = readRecord(store)
    expect(mc.status).toBe(1)
    expect(mc.connectTime).toBeGreaterThan(0)
  })
})
