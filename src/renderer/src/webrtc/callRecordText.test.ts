import { describe, it, expect } from 'vitest'
import { callRecordText } from './callRecordText'
import MessageContentType from '../websocket/message/messageContentType'

const CALL_START = MessageContentType.VOIP_CONTENT_TYPE_START

// 单聊通话记录的固定入参，各用例只改状态相关字段
function single(extra: Record<string, number | undefined> = {}) {
  return { conversationType: 0, contentType: CALL_START, ...extra }
}

describe('callRecordText 状态文案', () => {
  it('status 0 是「对方未接听」', () => {
    expect(callRecordText(single({ status: 0 }))).toBe('对方未接听')
  })

  it('status 缺失当 0 处理 —— 主叫发出的 CallStart 不带 s 字段', () => {
    expect(callRecordText(single())).toBe('对方未接听')
  })

  it('status 1 是「通话中」', () => {
    expect(callRecordText(single({ status: 1 }))).toBe('通话中')
  })

  it('status 3 是「已在其他设备接听」', () => {
    expect(callRecordText(single({ status: 3 }))).toBe('已在其他设备接听')
  })

  it('status 2 且接通过，显示通话时长', () => {
    expect(callRecordText(single({ status: 2, connectTime: 1000, endTime: 202000 }))).toBe('通话时长 03:21')
  })

  it('status 2 但没接通过，仍是「对方未接听」', () => {
    expect(callRecordText(single({ status: 2, connectTime: 0, endTime: 5000 }))).toBe('对方未接听')
  })

  it('超过 1 小时用时分秒 —— 与 Android 的 duration > 3600 边界一致', () => {
    expect(callRecordText(single({ status: 2, connectTime: 0 + 1, endTime: 1 + 3601000 }))).toBe('通话时长 1:00:01')
  })

  it('整 1 小时仍走分秒格式，不是边界外', () => {
    expect(callRecordText(single({ status: 2, connectTime: 1, endTime: 1 + 3600000 }))).toBe('通话时长 60:00')
  })

  it('时钟回拨导致结束早于接通时不显示负数', () => {
    expect(callRecordText(single({ status: 2, connectTime: 9000, endTime: 1000 }))).toBe('通话时长 00:00')
  })
})

describe('callRecordText 适用范围', () => {
  it('群聊多人通话返回 null，由调用方回退到摘要', () => {
    expect(callRecordText({ conversationType: 1, contentType: CALL_START, status: 2 })).toBeNull()
  })

  it('非 CallStart 的 VOIP 消息返回 null', () => {
    expect(callRecordText({ conversationType: 0, contentType: MessageContentType.VOIP_CONTENT_TYPE_SIGNAL })).toBeNull()
  })
})
