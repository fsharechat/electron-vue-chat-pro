import type { ProtoMessage } from '@/types'
import MessageStatus from '@/websocket/message/messageStatus'
import MessageContentType from '@/websocket/message/messageContentType'

export type TranscriptStatus = 'loading' | 'done' | 'error'

export interface TranscriptEntry {
  status: TranscriptStatus
  text: string
  hidden: boolean
}

/** 语音且已拿到服务端 messageUid（自己刚发出、还没回执的语音 messageUid 为 '0'） */
export function canTranscribe(msg: ProtoMessage): boolean {
  return msg.content?.type === MessageContentType.Voice && !!msg.messageUid && msg.messageUid !== '0'
}

export function isUnplayedVoice(msg: ProtoMessage): boolean {
  return msg.direction === 1 && msg.content?.type === MessageContentType.Voice && msg.status !== MessageStatus.Played
}

export type TranscriptBlock = 'none' | 'loading' | 'text' | 'empty' | 'error'

export function voiceView(msg: ProtoMessage, entry: TranscriptEntry | undefined, autoTranscribe: boolean) {
  const showDot = isUnplayedVoice(msg)
  const showPill = showDot && !entry && !autoTranscribe && canTranscribe(msg)
  let block: TranscriptBlock = 'none'
  if (entry && !entry.hidden) {
    if (entry.status === 'loading') block = 'loading'
    else if (entry.status === 'error') block = 'error'
    else block = entry.text === '' ? 'empty' : 'text'
  }
  return { showDot, showPill, block }
}

export function voiceMenuOption(msg: ProtoMessage, entry: TranscriptEntry | undefined):
  { label: string; key: 'transcribe' | 'hide-transcript' } | null {
  if (!canTranscribe(msg)) return null
  if (entry && !entry.hidden && entry.status !== 'error') return { label: '隐藏文字', key: 'hide-transcript' }
  return { label: '转文字', key: 'transcribe' }
}
