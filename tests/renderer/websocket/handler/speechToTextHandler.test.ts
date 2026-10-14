import { describe, it, expect } from 'vitest'
import SpeechToTextHandler from '@/websocket/handler/speechToTextHandler'
import { ASR, PUB_ACK, PUBLISH } from '@/constant'

describe('SpeechToTextHandler', () => {
  const handler = new SpeechToTextHandler({ resolvePromiseMap: new Map() })

  it('只匹配 ASR 的 PUB_ACK', () => {
    expect(ASR).toBe('ASR')
    expect(handler.match({ signal: PUB_ACK, subSignal: ASR })).toBe(true)
    expect(handler.match({ signal: PUBLISH, subSignal: ASR })).toBe(false)
    expect(handler.match({ signal: PUB_ACK, subSignal: 'GMURL' })).toBe(false)
  })

  it('成功 content 解析为 { text }', () => {
    expect(handler.notifyContent('{"text":"你好"}')).toEqual({ text: '你好' })
  })

  it('空文本也能解析', () => {
    expect(handler.notifyContent('{"text":""}')).toEqual({ text: '' })
  })
})
