// @ts-nocheck
import { describe, it, expect, vi, beforeEach } from 'vitest'
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
