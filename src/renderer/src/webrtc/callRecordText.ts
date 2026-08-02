import MessageContentType from '../websocket/message/messageContentType'

/**
 * 通话记录的结束状态，取值与 Android CallStartMessageContent 对齐：
 * 0 未接听 / 1 通话中 / 2 已结束 / 3 已在其他设备接听。
 * 3 是本项目在 wildfirechat 原有语义上的扩展，配合 406 多端同步信令。
 */
export const CALL_STATUS_MISSED = 0
export const CALL_STATUS_CONNECTED = 1
export const CALL_STATUS_ENDED = 2
export const CALL_STATUS_TAKEN_ELSEWHERE = 3

export interface CallRecordInput {
  conversationType: number
  contentType: number
  status?: number
  connectTime?: number
  endTime?: number
}

/** 时长格式照搬 Android VoipMessageViewHolder：超过 1 小时才带小时位。 */
function durationText(seconds: number): string {
  const pad = (n: number) => n.toString().padStart(2, '0')
  if (seconds > 3600) {
    return `${Math.floor(seconds / 3600)}:${pad(Math.floor((seconds % 3600) / 60))}:${pad(seconds % 60)}`
  }
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}`
}

/**
 * 单聊通话记录该显示的文案。返回 null 表示这条消息不适用状态文案
 * （群聊多人通话、非 CallStart 的 VOIP 消息），调用方回退到消息摘要。
 */
export function callRecordText(input: CallRecordInput): string | null {
  if (input.conversationType !== 0) return null
  if (input.contentType !== MessageContentType.VOIP_CONTENT_TYPE_START) return null

  const status = input.status ?? CALL_STATUS_MISSED
  if (status === CALL_STATUS_CONNECTED) return '通话中'
  if (status === CALL_STATUS_TAKEN_ELSEWHERE) return '已在其他设备接听'

  const connectTime = input.connectTime ?? 0
  if (status === CALL_STATUS_ENDED && connectTime > 0) {
    // 时钟回拨时 endTime 可能早于 connectTime，钳到 0 避免出现负数时长
    const seconds = Math.max(0, Math.floor(((input.endTime ?? 0) - connectTime) / 1000))
    return `通话时长 ${durationText(seconds)}`
  }
  return '对方未接听'
}
