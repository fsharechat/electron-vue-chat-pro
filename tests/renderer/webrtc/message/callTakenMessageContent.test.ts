import { describe, it, expect } from 'vitest'
import CallTakenMessageContent from '@/webrtc/message/callTakenMessageContent'

function decodeFrom(binaryContent: string | null, content = 'call-abc') {
  const decoded = new CallTakenMessageContent()
  decoded.decode({ content, binaryContent } as any)
  return decoded
}

describe('CallTakenMessageContent', () => {
  it('round trips all fields through encode/decode', () => {
    const origin = new CallTakenMessageContent()
    origin.callId = 'call-abc'
    origin.reason = CallTakenMessageContent.REASON_REJECTED
    origin.deviceId = 'device-1'

    const decoded = new CallTakenMessageContent()
    decoded.decode(origin.encode())

    expect(decoded.callId).toBe('call-abc')
    expect(decoded.reason).toBe(CallTakenMessageContent.REASON_REJECTED)
    expect(decoded.deviceId).toBe('device-1')
  })

  it('puts callId in the content field', () => {
    const origin = new CallTakenMessageContent()
    origin.callId = 'call-abc'
    origin.reason = CallTakenMessageContent.REASON_ANSWERED
    origin.deviceId = 'device-1'

    expect(origin.encode().content).toBe('call-abc')
  })

  it('falls back to answered when reason is missing', () => {
    const decoded = decodeFrom(btoa(JSON.stringify({ d: 'device-1' })))

    expect(decoded.reason).toBe(CallTakenMessageContent.REASON_ANSWERED)
    expect(decoded.deviceId).toBe('device-1')
  })

  it('falls back to answered on broken payload', () => {
    const decoded = decodeFrom(btoa('not json'))

    expect(decoded.callId).toBe('call-abc')
    expect(decoded.reason).toBe(CallTakenMessageContent.REASON_ANSWERED)
    expect(decoded.deviceId).toBe('')
  })

  it('falls back to answered on null payload', () => {
    const decoded = decodeFrom(null)

    expect(decoded.reason).toBe(CallTakenMessageContent.REASON_ANSWERED)
    expect(decoded.deviceId).toBe('')
  })
})
