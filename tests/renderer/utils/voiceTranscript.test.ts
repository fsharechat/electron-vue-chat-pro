import { describe, it, expect } from 'vitest'
import { canTranscribe, isUnplayedVoice, voiceView, voiceMenuOption } from '@/utils/voiceTranscript'

function msg(over: Partial<any> = {}) {
  return {
    messageId: 'm1', messageUid: '123', from: 'peer', target: 'peer', conversationType: 0,
    direction: 1, timestamp: 1, status: 5, line: 0, tos: '',
    content: { type: 2, searchableContent: '' }, ...over
  } as any
}

describe('canTranscribe', () => {
  it('语音且有 messageUid', () => {
    expect(canTranscribe(msg())).toBe(true)
  })
  it('canTranscribe 排除 messageUid 为 0 的消息', () => {
    expect(canTranscribe(msg({ messageUid: '0' }))).toBe(false)
    expect(canTranscribe(msg({ messageUid: '' }))).toBe(false)
  })
  it('非语音不可转', () => {
    expect(canTranscribe(msg({ content: { type: 1, searchableContent: 'x' } }))).toBe(false)
  })
})

describe('isUnplayedVoice', () => {
  it('他人语音且未播放', () => {
    expect(isUnplayedVoice(msg())).toBe(true)
    expect(isUnplayedVoice(msg({ status: 7 }))).toBe(false)
    expect(isUnplayedVoice(msg({ direction: 0 }))).toBe(false)
  })
})

describe('voiceView', () => {
  it('未播放、未转、自动关闭：红点 + 按钮', () => {
    expect(voiceView(msg(), undefined, false)).toEqual({ showDot: true, showPill: true, block: 'none' })
  })
  it('自动转文字开启时不显示按钮，红点仍在', () => {
    expect(voiceView(msg(), undefined, true)).toEqual({ showDot: true, showPill: false, block: 'none' })
  })
  it('已播放：无红点无按钮', () => {
    expect(voiceView(msg({ status: 7 }), undefined, false)).toEqual({ showDot: false, showPill: false, block: 'none' })
  })
  it('已有结果时不显示按钮', () => {
    const v = voiceView(msg(), { status: 'loading', text: '', hidden: false }, false)
    expect(v.showPill).toBe(false)
    expect(v.block).toBe('loading')
  })
  it('文字块各状态', () => {
    expect(voiceView(msg(), { status: 'done', text: 'hi', hidden: false }, false).block).toBe('text')
    expect(voiceView(msg(), { status: 'done', text: '', hidden: false }, false).block).toBe('empty')
    expect(voiceView(msg(), { status: 'error', text: '', hidden: false }, false).block).toBe('error')
    expect(voiceView(msg(), { status: 'done', text: 'hi', hidden: true }, false).block).toBe('none')
  })
  it('自己发的语音也能显示文字块', () => {
    expect(voiceView(msg({ direction: 0 }), { status: 'done', text: 'hi', hidden: false }, false))
      .toEqual({ showDot: false, showPill: false, block: 'text' })
  })
})

describe('voiceMenuOption', () => {
  it('未转或失败或已隐藏：转文字', () => {
    expect(voiceMenuOption(msg(), undefined)).toEqual({ label: '转文字', key: 'transcribe' })
    expect(voiceMenuOption(msg(), { status: 'error', text: '', hidden: false })?.key).toBe('transcribe')
    expect(voiceMenuOption(msg(), { status: 'done', text: 'a', hidden: true })?.key).toBe('transcribe')
  })
  it('显示中或识别中：隐藏文字', () => {
    expect(voiceMenuOption(msg(), { status: 'done', text: 'a', hidden: false })).toEqual({ label: '隐藏文字', key: 'hide-transcript' })
    expect(voiceMenuOption(msg(), { status: 'loading', text: '', hidden: false })?.key).toBe('hide-transcript')
  })
  it('不可转的消息没有菜单项', () => {
    expect(voiceMenuOption(msg({ messageUid: '0' }), undefined)).toBeNull()
    expect(voiceMenuOption(msg({ content: { type: 1, searchableContent: '' } }), undefined)).toBeNull()
  })
})
