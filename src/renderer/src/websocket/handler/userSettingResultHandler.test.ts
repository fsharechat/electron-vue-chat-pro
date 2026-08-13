import { describe, it, expect, beforeEach, vi } from 'vitest'
import UserSettingResultHandler from './userSettingResultHandler'
import NotifyUserSettingHandler from './notifyUserSettingHandler'
import { PUB_ACK, PUBLISH, UG, UN, FP } from '../../constant'

function fakeWebsocket() {
  return {
    sendAction: vi.fn(),
    getUserSettings: vi.fn(),
    resolvePromiseMap: new Map()
  }
}

describe('UserSettingResultHandler', () => {
  let ws: ReturnType<typeof fakeWebsocket>
  let handler: UserSettingResultHandler

  beforeEach(() => {
    ws = fakeWebsocket()
    handler = new UserSettingResultHandler(ws)
  })

  it('只匹配 PUB_ACK + UG', () => {
    expect(handler.match({ signal: PUB_ACK, subSignal: UG })).toBe(true)
    expect(handler.match({ signal: PUB_ACK, subSignal: FP })).toBe(false)
    expect(handler.match({ signal: PUBLISH, subSignal: UG })).toBe(false)
  })

  it('把应答数组原样派发给 store，含 tombstone', () => {
    const entries = [
      { scope: 6, key: 'group-a', value: '1', updateDt: 100 },
      { scope: 6, key: 'group-b', value: '0', updateDt: 200 }
    ]

    handler.processMessage({ signal: PUB_ACK, subSignal: UG, messageId: 1, content: JSON.stringify(entries) })

    expect(ws.sendAction).toHaveBeenCalledWith('applyUserSettings', entries)
  })

  it('空数组照常派发，让 store 自己决定不动 version', () => {
    handler.processMessage({ signal: PUB_ACK, subSignal: UG, messageId: 1, content: '[]' })

    expect(ws.sendAction).toHaveBeenCalledWith('applyUserSettings', [])
  })

  it('content 为空字符串时不派发，也不抛异常', () => {
    handler.processMessage({ signal: PUB_ACK, subSignal: UG, messageId: 1, content: '' })

    expect(ws.sendAction).not.toHaveBeenCalled()
  })

  it('content 不是合法 JSON 时不派发，也不抛异常', () => {
    handler.processMessage({ signal: PUB_ACK, subSignal: UG, messageId: 1, content: 'not json' })

    expect(ws.sendAction).not.toHaveBeenCalled()
  })
})

describe('NotifyUserSettingHandler', () => {
  let ws: ReturnType<typeof fakeWebsocket>
  let handler: NotifyUserSettingHandler

  beforeEach(() => {
    ws = fakeWebsocket()
    handler = new NotifyUserSettingHandler(ws)
  })

  it('只匹配 PUBLISH + UN', () => {
    expect(handler.match({ signal: PUBLISH, subSignal: UN })).toBe(true)
    expect(handler.match({ signal: PUB_ACK, subSignal: UN })).toBe(false)
    expect(handler.match({ signal: PUBLISH, subSignal: FP })).toBe(false)
  })

  it('收到通知就触发一次增量拉取', () => {
    handler.processMessage({ signal: PUBLISH, subSignal: UN, messageId: 0, content: JSON.stringify({ head: '999' }) })

    expect(ws.getUserSettings).toHaveBeenCalledTimes(1)
  })
})
