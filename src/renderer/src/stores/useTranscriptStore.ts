import { ref } from 'vue'
import { defineStore } from 'pinia'
import webSocketClient from '@/websocket/websocketcli'
import { SUCCESS_CODE } from '@/constant'
import type { TranscriptEntry } from '@/utils/voiceTranscript'

const TRANSCRIPTS_KEY = 'voice-transcripts'
const AUTO_KEY = 'voice-auto-transcribe'
const AUTO_CONCURRENCY = 2

function loadEntries(): Record<string, TranscriptEntry> {
  try {
    const raw = localStorage.getItem(TRANSCRIPTS_KEY)
    if (!raw) return {}
    const saved = JSON.parse(raw) as Record<string, { text: string; hidden: boolean }>
    const out: Record<string, TranscriptEntry> = {}
    for (const [uid, v] of Object.entries(saved)) {
      out[uid] = { status: 'done', text: v.text ?? '', hidden: !!v.hidden }
    }
    return out
  } catch {
    return {}
  }
}

/**
 * 语音转文字结果，按 messageUid 存。只有 done 落 localStorage，loading / error 重启即丢，重新点即可。
 */
export const useTranscriptStore = defineStore('transcript', () => {
  const entries = ref<Record<string, TranscriptEntry>>(loadEntries())
  const autoTranscribe = ref(localStorage.getItem(AUTO_KEY) === '1')

  const autoQueue: string[] = []
  let autoRunning = 0
  // reset() 时自增，丢弃登出前已发出的请求的返回结果
  let generation = 0

  function persist() {
    const saved: Record<string, { text: string; hidden: boolean }> = {}
    for (const [uid, e] of Object.entries(entries.value)) {
      if (e.status === 'done') saved[uid] = { text: e.text, hidden: e.hidden }
    }
    localStorage.setItem(TRANSCRIPTS_KEY, JSON.stringify(saved))
  }

  async function request(uid: string): Promise<void> {
    const cur = entries.value[uid]
    if (cur?.status === 'loading') {
      // 识别中被隐藏后又点「转文字」：只取消隐藏，不重复请求
      cur.hidden = false
      return
    }
    if (cur?.status === 'done') {
      if (cur.hidden) {
        cur.hidden = false
        persist()
      }
      return
    }
    const gen = generation
    entries.value[uid] = { status: 'loading', text: '', hidden: false }

    let text: string | null = null
    try {
      const res: any = await webSocketClient.speechToText(uid)
      if (res?.code === SUCCESS_CODE && typeof res.result?.text === 'string') text = res.result.text
    } catch {
      text = null
    }

    if (gen !== generation) return // 期间已登出重置，结果作废

    // 识别期间用户可能点了「隐藏文字」，保留该选择
    const hidden = entries.value[uid]?.hidden ?? false
    if (text === null) {
      entries.value[uid] = { status: 'error', text: '', hidden }
      persist()
    } else {
      entries.value[uid] = { status: 'done', text, hidden }
      persist()
    }
  }

  function hide(uid: string) {
    const e = entries.value[uid]
    if (!e) return
    e.hidden = true
    persist()
  }

  function setAutoTranscribe(on: boolean) {
    autoTranscribe.value = on
    localStorage.setItem(AUTO_KEY, on ? '1' : '0')
    if (!on) autoQueue.length = 0 // 关闭时清掉排队中的，已发出的请求让它跑完
  }

  function drain() {
    while (autoRunning < AUTO_CONCURRENCY && autoQueue.length > 0) {
      const uid = autoQueue.shift()!
      autoRunning++
      request(uid).finally(() => {
        autoRunning--
        drain()
      })
    }
  }

  /** 实时收到的他人语音在开关打开时自动识别；已有结果或已在队列中的跳过 */
  function enqueueAuto(uid: string) {
    if (!autoTranscribe.value) return
    if (entries.value[uid] || autoQueue.includes(uid)) return
    autoQueue.push(uid)
    drain()
  }

  /** 登出：清内存状态与排队；localStorage 里已完成的结果保留（按 messageUid 存），内存按它重载 */
  function reset() {
    generation++
    autoQueue.length = 0
    entries.value = loadEntries()
  }

  return { reset, entries, autoTranscribe, request, hide, setAutoTranscribe, enqueueAuto }
})
