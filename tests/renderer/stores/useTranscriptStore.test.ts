import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

const speechToText = vi.fn()
vi.mock('@/websocket/websocketcli', () => ({ default: { speechToText: (uid: string) => speechToText(uid) } }))

import { useTranscriptStore } from '@/stores/useTranscriptStore'

function deferred<T>() {
  let resolve!: (v: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

const flush = () => new Promise(r => setTimeout(r, 0))

describe('useTranscriptStore', () => {
  beforeEach(() => {
    localStorage.clear()
    speechToText.mockReset()
    setActivePinia(createPinia())
  })

  it('成功：loading → done，并持久化', async () => {
    const d = deferred<any>()
    speechToText.mockReturnValue(d.promise)
    const store = useTranscriptStore()

    const p = store.request('u1')
    expect(store.entries['u1'].status).toBe('loading')
    d.resolve({ code: 200, result: { text: '你好' } })
    await p

    expect(store.entries['u1']).toEqual({ status: 'done', text: '你好', hidden: false })
    expect(JSON.parse(localStorage.getItem('voice-transcripts')!)).toEqual({ u1: { text: '你好', hidden: false } })
  })

  it('空文本是成功', async () => {
    speechToText.mockResolvedValue({ code: 200, result: { text: '' } })
    const store = useTranscriptStore()

    await store.request('u1')

    expect(store.entries['u1']).toEqual({ status: 'done', text: '', hidden: false })
  })

  it('失败（ERROR_CODE / 未连接 / 抛错）→ error，不持久化，可重试', async () => {
    speechToText.mockResolvedValueOnce({ code: 400, result: '' })
    const store = useTranscriptStore()

    await store.request('u1')
    expect(store.entries['u1'].status).toBe('error')
    expect(localStorage.getItem('voice-transcripts')).toBe('{}')

    speechToText.mockResolvedValueOnce(undefined)
    await store.request('u1')
    expect(store.entries['u1'].status).toBe('error')

    speechToText.mockRejectedValueOnce(new Error('x'))
    await store.request('u1')
    expect(store.entries['u1'].status).toBe('error')

    speechToText.mockResolvedValueOnce({ code: 200, result: { text: 'ok' } })
    await store.request('u1')
    expect(store.entries['u1'].status).toBe('done')
    expect(speechToText).toHaveBeenCalledTimes(4)
  })

  it('loading 中重复 request 不再发请求', async () => {
    const d = deferred<any>()
    speechToText.mockReturnValue(d.promise)
    const store = useTranscriptStore()

    const p1 = store.request('u1')
    const p2 = store.request('u1')
    d.resolve({ code: 200, result: { text: 'a' } })
    await Promise.all([p1, p2])

    expect(speechToText).toHaveBeenCalledTimes(1)
  })

  it('已完成且隐藏时 request 只取消隐藏，不再请求', async () => {
    speechToText.mockResolvedValue({ code: 200, result: { text: 'a' } })
    const store = useTranscriptStore()
    await store.request('u1')

    store.hide('u1')
    expect(store.entries['u1'].hidden).toBe(true)
    expect(JSON.parse(localStorage.getItem('voice-transcripts')!).u1.hidden).toBe(true)

    await store.request('u1')
    expect(store.entries['u1'].hidden).toBe(false)
    expect(speechToText).toHaveBeenCalledTimes(1)
  })

  it('识别过程中被隐藏，结果回来后保持隐藏', async () => {
    const d = deferred<any>()
    speechToText.mockReturnValue(d.promise)
    const store = useTranscriptStore()

    const p = store.request('u1')
    store.hide('u1')
    d.resolve({ code: 200, result: { text: 'a' } })
    await p

    expect(store.entries['u1']).toEqual({ status: 'done', text: 'a', hidden: true })
  })

  it('重启后从 localStorage 恢复 done 结果与开关', () => {
    localStorage.setItem('voice-transcripts', JSON.stringify({ u9: { text: '旧', hidden: false } }))
    localStorage.setItem('voice-auto-transcribe', '1')

    const store = useTranscriptStore()

    expect(store.entries['u9']).toEqual({ status: 'done', text: '旧', hidden: false })
    expect(store.autoTranscribe).toBe(true)
  })

  it('localStorage 里是坏数据时忽略', () => {
    localStorage.setItem('voice-transcripts', '{not json')

    expect(useTranscriptStore().entries).toEqual({})
  })

  it('setAutoTranscribe 持久化', () => {
    const store = useTranscriptStore()

    store.setAutoTranscribe(true)
    expect(localStorage.getItem('voice-auto-transcribe')).toBe('1')
    store.setAutoTranscribe(false)
    expect(localStorage.getItem('voice-auto-transcribe')).toBe('0')
  })

  it('enqueueAuto：开关关闭时不处理', async () => {
    const store = useTranscriptStore()

    store.enqueueAuto('u1')
    await flush()

    expect(speechToText).not.toHaveBeenCalled()
  })

  it('enqueueAuto：并发 2、去重、依次排空', async () => {
    const ds = [deferred<any>(), deferred<any>(), deferred<any>()]
    let i = 0
    speechToText.mockImplementation(() => ds[i++].promise)
    const store = useTranscriptStore()
    store.setAutoTranscribe(true)

    store.enqueueAuto('a')
    store.enqueueAuto('b')
    store.enqueueAuto('c')
    store.enqueueAuto('a')
    await flush()
    expect(speechToText).toHaveBeenCalledTimes(2)

    ds[0].resolve({ code: 200, result: { text: '1' } })
    await flush()
    expect(speechToText).toHaveBeenCalledTimes(3)
    expect(speechToText.mock.calls.map(c => c[0])).toEqual(['a', 'b', 'c'])

    ds[1].resolve({ code: 200, result: { text: '2' } })
    ds[2].resolve({ code: 200, result: { text: '3' } })
    await flush()
    expect(store.entries['c'].text).toBe('3')
  })

  it('enqueueAuto：已有结果的消息不再排队', async () => {
    speechToText.mockResolvedValue({ code: 200, result: { text: 'a' } })
    const store = useTranscriptStore()
    await store.request('u1')
    store.setAutoTranscribe(true)

    store.enqueueAuto('u1')
    await flush()

    expect(speechToText).toHaveBeenCalledTimes(1)
  })

  it('loading 中被隐藏后再 request：取消隐藏、不重复请求，结果回来为 done 且不隐藏', async () => {
    const d = deferred<any>()
    speechToText.mockReturnValue(d.promise)
    const store = useTranscriptStore()

    const p = store.request('u1')
    store.hide('u1')
    await store.request('u1')

    expect(store.entries['u1']).toEqual({ status: 'loading', text: '', hidden: false })
    expect(speechToText).toHaveBeenCalledTimes(1)

    d.resolve({ code: 200, result: { text: 'a' } })
    await p
    expect(store.entries['u1']).toEqual({ status: 'done', text: 'a', hidden: false })
  })

  it('reset：清掉内存中未完成的 entries 与排队项，排队项不再启动；持久化与开关不动', async () => {
    const ds = [deferred<any>(), deferred<any>()]
    let i = 0
    speechToText.mockImplementation(() => ds[i++].promise)
    localStorage.setItem('voice-transcripts', JSON.stringify({ old: { text: '旧', hidden: false } }))
    const store = useTranscriptStore()
    store.setAutoTranscribe(true)
    store.enqueueAuto('a')
    store.enqueueAuto('b')
    store.enqueueAuto('c') // 排队中
    await flush()
    expect(speechToText).toHaveBeenCalledTimes(2)

    store.reset()
    expect(store.entries['a']).toBeUndefined()
    expect(store.entries['b']).toBeUndefined()
    expect(store.entries['c']).toBeUndefined()

    ds[0].resolve({ code: 200, result: { text: '1' } })
    ds[1].resolve({ code: 200, result: { text: '2' } })
    await flush()

    expect(speechToText).toHaveBeenCalledTimes(2) // c 没有启动
    expect(store.entries['a']).toBeUndefined() // 登出前请求的结果作废
    expect(localStorage.getItem('voice-auto-transcribe')).toBe('1')
    expect(JSON.parse(localStorage.getItem('voice-transcripts')!)).toEqual({ old: { text: '旧', hidden: false } })
  })

  it('setAutoTranscribe(false) 清空排队，已发出的请求跑完', async () => {
    const ds = [deferred<any>(), deferred<any>()]
    let i = 0
    speechToText.mockImplementation(() => ds[i++].promise)
    const store = useTranscriptStore()
    store.setAutoTranscribe(true)
    store.enqueueAuto('a')
    store.enqueueAuto('b')
    store.enqueueAuto('c')
    await flush()

    store.setAutoTranscribe(false)
    ds[0].resolve({ code: 200, result: { text: '1' } })
    ds[1].resolve({ code: 200, result: { text: '2' } })
    await flush()

    expect(speechToText).toHaveBeenCalledTimes(2)
    expect(store.entries['a'].status).toBe('done')
    expect(store.entries['b'].status).toBe('done')
    expect(store.entries['c']).toBeUndefined()
  })
})
