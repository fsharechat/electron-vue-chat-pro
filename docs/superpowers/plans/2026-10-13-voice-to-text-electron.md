# 语音转文字：electron-vue-chat-pro Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 electron 客户端实现语音消息转文字：未播放红点 + 「转文字」按钮、右键菜单「转文字 / 隐藏文字」、气泡下方文字块、设置里的「自动转文字」开关。

**Architecture:** 协议层新增 `ASR` 信令（`webSocketClient.speechToText(messageUid)`）。「已播放」直接写在消息的 `status = MessageStatus.Played(7)` 上，随 `LocalStore.saveMessages` 一起持久化。转文字结果放在新的 `useTranscriptStore`（按 messageUid 存，`done` 结果落 localStorage）。显示规则抽成纯函数 `utils/voiceTranscript.ts`，`MessageBubble.vue` 与 `ChatPage.vue` 只消费它。

**Tech Stack:** Vue 3 + Pinia（setup store）+ naive-ui + Vitest（jsdom）

**Spec:** `chat-server-pro/docs/superpowers/specs/2026-10-13-voice-to-text-design.md`（§1 交互约定、§3.4 WebSocket JSON、§6.1–6.2）

**前置依赖:** 服务端计划 `chat-server-pro/docs/superpowers/plans/2026-10-13-voice-to-text-server.md` 已部署（Task 1–6 的单测不依赖服务端，Task 7 的手动验证依赖）。

## Global Constraints

- 运行命令前切 Node 20：`export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20`。
- 测试放 `tests/renderer/**`，镜像 `src/renderer/src/**`，用 `@/...` 别名引用。
- 颜色只用 `styles/variables.css` 中的 CSS 变量，禁止硬编码颜色。
- 渲染层禁止 `navigator.clipboard`（本计划不涉及复制）。
- WebSocket 子信令常量 `ASR`；请求 content `{ messageUid: string }`；成功 `FutureResult(SUCCESS_CODE=200, { text })`，失败 `FutureResult(ERROR_CODE=400, '')`，超时 10 秒同样为 ERROR。
- 所有失败一律显示「转文字失败，点击重试」，不区分原因。识别成功但文本为空显示「未识别到文字」。
- 点击「转文字」（按钮或右键菜单）会把消息置为已播放（消红点）；自动转文字不消红点。
- 自动转文字只处理 `firstLogin === false` 时实时收到的他人语音；并发 2；按 messageUid 去重。
- 自动转文字开关默认关，存 localStorage，不做多端同步。

## Review Focus

1. **升级后历史语音不应全部冒红点**：升级前本地已有的他人语音 `status` 都是 `Unread(5)`，若不处理会全部显示红点和「转文字」按钮 —— Task 2 `hydrateMessages 首次升级把已有的他人语音置为已播放`。
2. **上滑加载的历史语音不应显示红点**（多半已在别的端听过）—— Task 2 `addOldMessage 加载的他人语音直接视为已播放`。
3. **识别进行中点「隐藏文字」后结果回来不应再弹出** —— Task 3 `识别过程中被隐藏，结果回来后保持隐藏`。
4. **重复点击不应重复请求**（双击按钮、按钮与菜单同时触发）—— Task 3 `loading 中重复 request 不再发请求`。
5. **还没拿到 messageUid 的语音（自己刚发、`messageUid === '0'`）不能出现转文字入口** —— Task 4 `canTranscribe 排除 messageUid 为 0 的消息`。

---

### Task 1: 协议层 ASR 信令

**Files:**
- Modify: `src/renderer/src/constant/index.ts`（第 30 行 `UG/UP/UN` 之后）
- Create: `src/renderer/src/websocket/handler/speechToTextHandler.ts`
- Modify: `src/renderer/src/websocket/index.ts`（import 行 2、handler 注册约第 298 行 `StreamingAiHandler` 之后、`recallMessage` 方法附近新增方法）
- Modify: `src/renderer/src/websocket/websocketcli.ts`（第 65 行 `getMinioUploadUrl` 之后）
- Test: `tests/renderer/websocket/handler/speechToTextHandler.test.ts`

**Interfaces:**
- Produces: `ASR` 常量；`webSocketClient.speechToText(messageUid: string): Promise<{ code: number; result: { text: string } | '' } | undefined>`

- [ ] **Step 1: 写失败测试**

创建 `tests/renderer/websocket/handler/speechToTextHandler.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- tests/renderer/websocket/handler/speechToTextHandler.test.ts`
Expected: FAIL，`Failed to resolve import "@/websocket/handler/speechToTextHandler"`。

- [ ] **Step 3: 常量**

`src/renderer/src/constant/index.ts` 第 30 行 `export const UG = 'UG'; export const UP = 'UP'; export const UN = 'UN'` 之后新增一行：

```ts
export const ASR = 'ASR'
```

- [ ] **Step 4: handler**

创建 `src/renderer/src/websocket/handler/speechToTextHandler.ts`：

```ts
// @ts-nocheck
import AbstractMessageHandler from "./abstractmessagehandler";
import { PUB_ACK, ASR } from "../../constant";

/**
 * 语音转文字应答。失败时服务端 content 为空串，AbstractMessageHandler 会直接给 ERROR_CODE，不会走到 notifyContent
 */
export default class SpeechToTextHandler extends AbstractMessageHandler {
    match(proto){
        return proto.signal == PUB_ACK && proto.subSignal == ASR;
    }
    notifyContent(content){
        return JSON.parse(content);
    }
}
```

- [ ] **Step 5: VueWebSocket 注册与发送方法**

`src/renderer/src/websocket/index.ts`：

1. 第 2 行 import 列表末尾的 `UG, UP}` 改为 `UG, UP, ASR}`。
2. 在 `import StreamingAiHandler from './handler/streamingAiHandler';` 之后加：
   ```ts
   import SpeechToTextHandler from './handler/speechToTextHandler';
   ```
3. 在 `this.handlerList.push(new StreamingAiHandler(this))` 之后加：
   ```ts
           this.handlerList.push(new SpeechToTextHandler(this))
   ```
4. 在 `async recallMessage(messageUid){ ... }` 方法之后加：
   ```ts
       /**
        * 语音转文字。messageUid 超出 JS 安全整数，按字符串传
        */
       async speechToText(messageUid){
           return await this.sendPublishMessage(ASR, { messageUid: messageUid })
       }
   ```

- [ ] **Step 6: websocketcli 透传**

`src/renderer/src/websocket/websocketcli.ts` 第 65 行 `getMinioUploadUrl(...)` 之后加：

```ts
  speechToText(messageUid) { return this._instance?.speechToText(messageUid) }
```

- [ ] **Step 7: 运行测试确认通过**

Run: `npm test -- tests/renderer/websocket/handler/speechToTextHandler.test.ts`
Expected: PASS（3 tests）

- [ ] **Step 8: Commit**

```bash
git add src/renderer/src/constant/index.ts src/renderer/src/websocket/handler/speechToTextHandler.ts src/renderer/src/websocket/index.ts src/renderer/src/websocket/websocketcli.ts tests/renderer/websocket/handler/speechToTextHandler.test.ts
git commit -m "feat(ws): 新增 ASR 语音转文字信令"
```

---

### Task 2: 语音「已播放」状态

**Files:**
- Modify: `src/renderer/src/stores/useMessageStore.ts`（`addOldMessage` 第 177 行、`hydrateMessages` 第 286 行、新增 `markPlayed`、return 列表）
- Test: `tests/renderer/stores/useMessageStore.test.ts`（文件末尾追加 describe）

**Interfaces:**
- Produces: `useMessageStore().markPlayed(messageId: string): void`；常量 `VOICE_PLAYED_MIGRATION_KEY = 'voice-played-migrated-v1'`（模块内）

- [ ] **Step 1: 写失败测试**

在 `tests/renderer/stores/useMessageStore.test.ts` 末尾追加：

```ts
describe('useMessageStore 语音已播放状态', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  function voice(id: string, direction: number, status: number) {
    return {
      messageId: id, messageUid: 'uid-' + id, from: direction === 1 ? 'peer-1' : 'me', target: 'peer-1',
      conversationType: 0, direction, timestamp: 1000, status, line: 0, tos: '',
      content: { type: 2, searchableContent: '' }
    }
  }

  it('markPlayed 把他人语音置为 Played(7)', () => {
    const store = useMessageStore()
    seed(store, [voice('v1', 1, 5)])

    store.markPlayed('v1')

    expect(store.messages[0].protoMessages[0].status).toBe(7)
  })

  it('markPlayed 不改自己发的消息', () => {
    const store = useMessageStore()
    seed(store, [voice('v1', 0, 1)])

    store.markPlayed('v1')

    expect(store.messages[0].protoMessages[0].status).toBe(1)
  })

  it('addOldMessage 加载的他人语音直接视为已播放', () => {
    const store = useMessageStore()
    seed(store, [])
    const old = voice('old', 1, 5)

    store.addOldMessage(old as any)

    expect(store.messages[0].protoMessages[0].status).toBe(7)
  })

  it('hydrateMessages 首次升级把已有的他人语音置为已播放，只做一次', () => {
    const store = useMessageStore()
    store.hydrateMessages([{ target: 'peer-1', name: '', protoMessages: [voice('a', 1, 5), voice('b', 0, 1)] }] as any)

    expect(store.messages[0].protoMessages[0].status).toBe(7)
    expect(store.messages[0].protoMessages[1].status).toBe(1)

    // 迁移标记已写入，之后新收到并持久化的未播放语音不能再被批量置为已播放
    store.hydrateMessages([{ target: 'peer-1', name: '', protoMessages: [voice('c', 1, 5)] }] as any)
    expect(store.messages[0].protoMessages[0].status).toBe(5)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- tests/renderer/stores/useMessageStore.test.ts`
Expected: FAIL，`store.markPlayed is not a function`，以及 `addOldMessage` / `hydrateMessages` 断言 `expected 5 to be 7`。

- [ ] **Step 3: 实现**

`useMessageStore.ts`：

1. 在 `export const useMessageStore = defineStore(...)` 之前加：

```ts
// 语音「已播放」上线前本地已有的他人语音都是 Unread，首次加载时一次性置为 Played，避免升级后满屏红点
const VOICE_PLAYED_MIGRATION_KEY = 'voice-played-migrated-v1'

function isIncomingVoice(m: ProtoMessage) {
  return m.direction === 1 && m.content?.type === MessageContentType.Voice
}
```

2. 把 `addOldMessage` 改为：

```ts
  function addOldMessage(protoMessage: ProtoMessage) {
    const chat = messages.value.find(m => m.target === protoMessage.target)
    if (chat) {
      const exists = chat.protoMessages.find((m: any) => m.messageId === protoMessage.messageId)
      if (!exists) {
        // 上滑加载的是历史消息，多半已在其他端听过，不显示红点
        if (isIncomingVoice(protoMessage)) protoMessage.status = MessageStatus.Played
        chat.protoMessages.unshift(protoMessage)
      }
    }
  }
```

3. 把 `hydrateMessages` 改为：

```ts
  function hydrateMessages(chats: StateChatMessage[]) {
    normalizeStaleCallStatus(chats)
    if (localStorage.getItem(VOICE_PLAYED_MIGRATION_KEY) !== '1') {
      for (const chat of chats) {
        for (const m of chat.protoMessages as ProtoMessage[]) {
          if (isIncomingVoice(m)) m.status = MessageStatus.Played
        }
      }
      localStorage.setItem(VOICE_PLAYED_MIGRATION_KEY, '1')
    }
    messages.value = chats
  }
```

4. 在 `hydrateMessages` 之后新增：

```ts
  /** 他人语音被播放或被点击「转文字」后置为已播放，随 messages 持久化 */
  function markPlayed(messageId: string) {
    for (const chat of messages.value) {
      const m = chat.protoMessages.find((p: any) => p.messageId === messageId)
      if (m) {
        if (m.direction === 1) m.status = MessageStatus.Played
        return
      }
    }
  }
```

5. return 对象中 `hydrateMessages,` 改为 `hydrateMessages, markPlayed,`。

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- tests/renderer/stores/useMessageStore.test.ts`
Expected: PASS（原有用例 + 新增 4 个）

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/stores/useMessageStore.ts tests/renderer/stores/useMessageStore.test.ts
git commit -m "feat(message): 语音消息已播放状态（markPlayed、历史语音视为已播放）"
```

---

### Task 3: useTranscriptStore（转文字结果、自动队列、开关）

**Files:**
- Create: `src/renderer/src/utils/voiceTranscript.ts`（本 Task 只放类型；Task 4 补纯函数）
- Create: `src/renderer/src/stores/useTranscriptStore.ts`
- Test: `tests/renderer/stores/useTranscriptStore.test.ts`

**Interfaces:**
- Consumes: Task 1 `webSocketClient.speechToText(uid)`
- Produces:
  - `type TranscriptStatus = 'loading' | 'done' | 'error'`；`interface TranscriptEntry { status: TranscriptStatus; text: string; hidden: boolean }`（`@/utils/voiceTranscript`）
  - `useTranscriptStore()`：`entries: Ref<Record<string, TranscriptEntry>>`、`autoTranscribe: Ref<boolean>`、`request(uid: string): Promise<void>`、`hide(uid: string): void`、`setAutoTranscribe(on: boolean): void`、`enqueueAuto(uid: string): void`
  - localStorage key：`voice-transcripts`（只存 done：`{ [uid]: { text, hidden } }`）、`voice-auto-transcribe`（`'1'` / `'0'`）

- [ ] **Step 1: 类型文件**

创建 `src/renderer/src/utils/voiceTranscript.ts`：

```ts
export type TranscriptStatus = 'loading' | 'done' | 'error'

export interface TranscriptEntry {
  status: TranscriptStatus
  text: string
  hidden: boolean
}
```

- [ ] **Step 2: 写失败测试**

创建 `tests/renderer/stores/useTranscriptStore.test.ts`：

```ts
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
})
```

- [ ] **Step 3: 运行确认失败**

Run: `npm test -- tests/renderer/stores/useTranscriptStore.test.ts`
Expected: FAIL，`Failed to resolve import "@/stores/useTranscriptStore"`。

- [ ] **Step 4: 实现 store**

创建 `src/renderer/src/stores/useTranscriptStore.ts`：

```ts
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

  function persist() {
    const saved: Record<string, { text: string; hidden: boolean }> = {}
    for (const [uid, e] of Object.entries(entries.value)) {
      if (e.status === 'done') saved[uid] = { text: e.text, hidden: e.hidden }
    }
    localStorage.setItem(TRANSCRIPTS_KEY, JSON.stringify(saved))
  }

  async function request(uid: string): Promise<void> {
    const cur = entries.value[uid]
    if (cur?.status === 'loading') return
    if (cur?.status === 'done') {
      if (cur.hidden) {
        cur.hidden = false
        persist()
      }
      return
    }
    entries.value[uid] = { status: 'loading', text: '', hidden: false }

    let text: string | null = null
    try {
      const res: any = await webSocketClient.speechToText(uid)
      if (res?.code === SUCCESS_CODE && typeof res.result?.text === 'string') text = res.result.text
    } catch {
      text = null
    }

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

  return { entries, autoTranscribe, request, hide, setAutoTranscribe, enqueueAuto }
})
```

- [ ] **Step 5: 运行测试确认通过**

Run: `npm test -- tests/renderer/stores/useTranscriptStore.test.ts`
Expected: PASS（12 tests）

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/utils/voiceTranscript.ts src/renderer/src/stores/useTranscriptStore.ts tests/renderer/stores/useTranscriptStore.test.ts
git commit -m "feat(transcript): 转文字结果 store（持久化、自动识别队列、开关）"
```

---

### Task 4: 显示规则纯函数 + 实时语音自动识别接入

**Files:**
- Modify: `src/renderer/src/utils/voiceTranscript.ts`（追加函数）
- Modify: `src/renderer/src/stores/useMessageStore.ts`（`addProtoMessage` 内 push 之后）
- Test: `tests/renderer/utils/voiceTranscript.test.ts`
- Test: `tests/renderer/stores/useMessageStore.test.ts`（追加 describe）

**Interfaces:**
- Consumes: Task 3 `TranscriptEntry`、`useTranscriptStore().enqueueAuto`
- Produces:
  - `canTranscribe(msg: ProtoMessage): boolean`
  - `isUnplayedVoice(msg: ProtoMessage): boolean`
  - `type TranscriptBlock = 'none' | 'loading' | 'text' | 'empty' | 'error'`
  - `voiceView(msg: ProtoMessage, entry: TranscriptEntry | undefined, autoTranscribe: boolean): { showDot: boolean; showPill: boolean; block: TranscriptBlock }`
  - `voiceMenuOption(msg: ProtoMessage, entry: TranscriptEntry | undefined): { label: string; key: 'transcribe' | 'hide-transcript' } | null`

- [ ] **Step 1: 写纯函数的失败测试**

创建 `tests/renderer/utils/voiceTranscript.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- tests/renderer/utils/voiceTranscript.test.ts`
Expected: FAIL，`canTranscribe is not a function`（或导入不存在）。

- [ ] **Step 3: 实现纯函数**

把 `src/renderer/src/utils/voiceTranscript.ts` 整体替换为（保留 Task 3 的类型定义）：

```ts
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
```

- [ ] **Step 4: 运行纯函数测试确认通过**

Run: `npm test -- tests/renderer/utils/voiceTranscript.test.ts`
Expected: PASS（13 tests）

- [ ] **Step 5: 写自动识别接入的失败测试**

在 `tests/renderer/stores/useMessageStore.test.ts` 顶部 import 区追加：

```ts
import { useTranscriptStore } from '@/stores/useTranscriptStore'
import { useUIStore } from '@/stores/useUIStore'
```

文件末尾追加：

```ts
describe('useMessageStore 实时语音自动转文字', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  function incoming(id: string, type = 2) {
    return {
      messageId: id, messageUid: 'uid-' + id, from: 'peer-1', target: 'peer-1',
      conversationType: 0, direction: 1, timestamp: 1000, status: 5, line: 0, tos: '',
      content: { type, searchableContent: '' }
    }
  }

  function setup(firstLogin: boolean) {
    const ui = useUIStore()
    ui.setFirstLogin(firstLogin)
    vi.spyOn(ui, 'playMsgNotify').mockImplementation(() => {})
    const ts = useTranscriptStore()
    const spy = vi.spyOn(ts, 'enqueueAuto').mockImplementation(() => {})
    const store = useMessageStore()
    seed(store, [])
    return { store, spy }
  }

  it('实时收到他人语音时交给 enqueueAuto', () => {
    const { store, spy } = setup(false)

    store.addProtoMessage(incoming('v1') as any)

    expect(spy).toHaveBeenCalledWith('uid-v1')
  })

  it('初始拉取（firstLogin）期间不自动识别', () => {
    const { store, spy } = setup(true)

    store.addProtoMessage(incoming('v1') as any)

    expect(spy).not.toHaveBeenCalled()
  })

  it('非语音、自己发的不自动识别', () => {
    const { store, spy } = setup(false)

    store.addProtoMessage(incoming('t1', 1) as any)
    store.addProtoMessage({ ...incoming('v2'), direction: 0 } as any)

    expect(spy).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 6: 运行确认失败**

Run: `npm test -- tests/renderer/stores/useMessageStore.test.ts`
Expected: FAIL，`实时收到他人语音时交给 enqueueAuto` 断言 `expected "spy" to be called`。

- [ ] **Step 7: 接入 addProtoMessage**

`useMessageStore.ts`：

1. import 区加：

```ts
import { useTranscriptStore } from './useTranscriptStore'
```

2. `addProtoMessage` 中（`if (!existing) {` 分支内那一处，不是 `preAddProtoMessage` 里的同名语句），在

```ts
          chat.protoMessages.push(protoMessage)
```

之后紧接着加：

```ts
          // 实时收到的他人语音，自动转文字开关打开时排队识别（开关判断在 enqueueAuto 内）
          if (isIncomingVoice(protoMessage) && !useUIStore().firstLogin) {
            useTranscriptStore().enqueueAuto(protoMessage.messageUid)
          }
```

3. 同一函数中 `if (!added) { messages.value.push({ target: protoMessage.target, name: '', protoMessages: [protoMessage] }) }` 改为：

```ts
    if (!added) {
      messages.value.push({ target: protoMessage.target, name: '', protoMessages: [protoMessage] })
      if (isIncomingVoice(protoMessage) && !useUIStore().firstLogin) {
        useTranscriptStore().enqueueAuto(protoMessage.messageUid)
      }
    }
```

- [ ] **Step 8: 运行测试确认通过**

Run: `npm test -- tests/renderer/stores/useMessageStore.test.ts tests/renderer/utils/voiceTranscript.test.ts`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/utils/voiceTranscript.ts src/renderer/src/stores/useMessageStore.ts tests/renderer/utils/voiceTranscript.test.ts tests/renderer/stores/useMessageStore.test.ts
git commit -m "feat(transcript): 语音转文字显示规则，实时语音自动识别接入"
```

---

### Task 5: MessageBubble 红点、按钮与文字块

**Files:**
- Modify: `src/renderer/src/components/chat/MessageBubble.vue`

**Interfaces:**
- Consumes: Task 2 `markPlayed`；Task 3 `useTranscriptStore`；Task 4 `voiceView`

显示逻辑已在 Task 4 用纯函数覆盖测试，本 Task 只做模板接线，验证用 `npm run build` + Task 7 手动走查。

- [ ] **Step 1: script 接线**

`MessageBubble.vue` `<script setup>`：

1. import 区（`import { useMessageStore } from '@/stores/useMessageStore'` 之后）加：

```ts
import { useTranscriptStore } from '@/stores/useTranscriptStore'
import { voiceView } from '@/utils/voiceTranscript'
```

2. `const msgStore = useMessageStore()` 之后加：

```ts
const transcriptStore = useTranscriptStore()
const { entries: transcripts, autoTranscribe } = storeToRefs(transcriptStore)
```

3. 把现有

```ts
const isAudioPlaying = computed(() => uiStore.currentAudioMessageId === props.message.messageId)
function toggleAudio() {
  if (isAudioPlaying.value) { uiStore.stopAudio(); return }
  uiStore.playAudio(audioInfo.value.url, props.message.messageId, () => {})
}
```

改为

```ts
const isAudioPlaying = computed(() => uiStore.currentAudioMessageId === props.message.messageId)
function toggleAudio() {
  if (isAudioPlaying.value) { uiStore.stopAudio(); return }
  msgStore.markPlayed(props.message.messageId)
  uiStore.playAudio(audioInfo.value.url, props.message.messageId, () => {})
}

const voice = computed(() => voiceView(props.message, transcripts.value[props.message.messageUid], autoTranscribe.value))
const transcriptText = computed(() => transcripts.value[props.message.messageUid]?.text ?? '')

/** 点「转文字」视为已读：消红点 */
function transcribe() {
  msgStore.markPlayed(props.message.messageId)
  transcriptStore.request(props.message.messageUid)
}
```

- [ ] **Step 2: 模板**

1. 在 `.bubble` 这个 div 的闭合 `</div>` 之后、`.bubble-meta` 闭合之前（即 `<span v-else class="unknown-msg">[不支持的消息类型]</span>` 下一行的 `</div>` 之后）插入：

```html
        <div v-if="isAudio && !isSelf && (voice.showDot || voice.showPill)" class="voice-side">
          <span v-if="voice.showDot" class="voice-dot" title="未播放"></span>
          <button v-if="voice.showPill" class="voice-pill" @click.stop="transcribe">转文字</button>
        </div>
```

2. 在 `.bubble-meta` 闭合 `</div>` 之后、`.bubble-wrap` 闭合之前插入：

```html
      <div v-if="isAudio && voice.block !== 'none'" class="voice-transcript" :class="{ self: isSelf }">
        <span v-if="voice.block === 'loading'" class="vt-muted">转文字中…</span>
        <span v-else-if="voice.block === 'error'" class="vt-error" @click.stop="transcriptStore.request(message.messageUid)">转文字失败，点击重试</span>
        <span v-else-if="voice.block === 'empty'" class="vt-muted">未识别到文字</span>
        <span v-else class="vt-text">{{ transcriptText }}</span>
      </div>
```

- [ ] **Step 3: 样式**

在 `<style scoped>` 的 `/* Audio */` 区块末尾（`@keyframes audioBar { ... }` 之后）追加：

```css
.voice-side { display: flex; align-items: center; gap: 8px; align-self: center; }
.voice-dot {
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--danger); flex-shrink: 0;
}
.voice-pill {
  border: none; cursor: pointer;
  padding: 3px 10px; border-radius: var(--radius-pill);
  background: var(--bg-elevated); color: var(--text-secondary);
  font-size: 12px; line-height: 18px;
}
.voice-pill:hover { color: var(--text-primary); }
.voice-transcript {
  margin-top: 6px; padding: 8px 12px; max-width: 100%;
  border-radius: var(--radius-md);
  background: var(--bg-elevated); color: var(--text-primary);
  font-size: 13px; line-height: 1.6;
  white-space: pre-wrap; word-break: break-word; user-select: text;
  align-self: flex-start;
}
.voice-transcript.self { align-self: flex-end; }
.vt-muted { color: var(--text-muted); }
.vt-error { color: var(--danger); cursor: pointer; }
```

- [ ] **Step 4: 构建与全量测试**

Run: `npm run build && npm test`
Expected: 构建成功，全部测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/chat/MessageBubble.vue
git commit -m "feat(chat): 语音气泡未播放红点、转文字按钮与文字块"
```

---

### Task 6: 右键菜单与「自动转文字」设置

**Files:**
- Modify: `src/renderer/src/pages/ChatPage.vue`（`contextMenuOptions` 第 45 行、`onContextMenuSelect` 第 62 行）
- Create: `src/renderer/src/components/common/SettingsDialog.vue`
- Modify: `src/renderer/src/components/layout/AppSidebar.vue`（footer 主题按钮与关于按钮之间）

**Interfaces:**
- Consumes: Task 2 `markPlayed`；Task 3 `useTranscriptStore().request/hide/setAutoTranscribe/autoTranscribe/entries`；Task 4 `voiceMenuOption`

菜单项判定已在 Task 4 用 `voiceMenuOption` 测过，本 Task 只做接线。

- [ ] **Step 1: ChatPage 菜单**

`ChatPage.vue`：

1. import 区加：

```ts
import { useTranscriptStore } from '@/stores/useTranscriptStore'
import { voiceMenuOption } from '@/utils/voiceTranscript'
```

并在 `const convStore = useConversationStore()` 之后加 `const transcriptStore = useTranscriptStore()`。

2. `contextMenuOptions` 中 `const base = [...]` 之后、`if (isMedia)` 之前加：

```ts
  const voiceOpt = contextMessage.value
    ? voiceMenuOption(contextMessage.value, transcriptStore.entries[contextMessage.value.messageUid])
    : null
  if (voiceOpt) base.unshift(voiceOpt)
```

3. `onContextMenuSelect` 中 `if (key === 'recall') {` 之前加：

```ts
  if (key === 'transcribe') {
    // 点「转文字」视为已读：消红点
    msgStore.markPlayed(msg.messageId)
    transcriptStore.request(msg.messageUid)
    return
  }
  if (key === 'hide-transcript') {
    transcriptStore.hide(msg.messageUid)
    return
  }
```

- [ ] **Step 2: SettingsDialog**

创建 `src/renderer/src/components/common/SettingsDialog.vue`：

```vue
<script setup lang="ts">
import { storeToRefs } from 'pinia'
import { useTranscriptStore } from '@/stores/useTranscriptStore'

const emit = defineEmits<{ (e: 'close'): void }>()
const transcriptStore = useTranscriptStore()
const { autoTranscribe } = storeToRefs(transcriptStore)
</script>

<template>
  <n-modal :show="true" @update:show="emit('close')" title="设置" preset="dialog" style="width:400px">
    <div class="setting-row">
      <div class="setting-label">
        <div class="setting-title">自动转文字</div>
        <div class="setting-desc">收到语音消息时自动转成文字显示在气泡下方</div>
      </div>
      <n-switch :value="autoTranscribe" @update:value="transcriptStore.setAutoTranscribe" />
    </div>
  </n-modal>
</template>

<style scoped>
.setting-row {
  display: flex; align-items: center; justify-content: space-between; gap: 16px;
  padding: 12px 0;
}
.setting-title { font-size: 14px; color: var(--text-primary); }
.setting-desc { margin-top: 4px; font-size: 12px; color: var(--text-muted); }
</style>
```

- [ ] **Step 3: 侧边栏入口**

`AppSidebar.vue`：

1. import 区 `import AboutDialog ...` 之后加 `import SettingsDialog from '@/components/common/SettingsDialog.vue'`。
2. `const showAboutDialog = ref(false)` 之后加 `const showSettingsDialog = ref(false)`。
3. footer 中主题按钮 `</button>` 之后、`<button class="footer-btn footer-btn--about" ...>` 之前插入：

```html
      <button class="footer-btn" title="设置" @click="showSettingsDialog = true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
```

4. `<AboutDialog v-if="showAboutDialog" @close="showAboutDialog=false" />` 之后加：

```html
    <SettingsDialog v-if="showSettingsDialog" @close="showSettingsDialog=false" />
```

- [ ] **Step 4: 构建与全量测试**

Run: `npm run build && npm test`
Expected: 构建成功，全部测试 PASS。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/pages/ChatPage.vue src/renderer/src/components/common/SettingsDialog.vue src/renderer/src/components/layout/AppSidebar.vue
git commit -m "feat(chat): 语音右键转文字 / 隐藏文字，设置里的自动转文字开关"
```

---

### Task 7: 手动走查（依赖服务端已部署并开启 `push.asr.enabled`）

- [ ] **Step 1: 启动**

Run: `npm run dev`，用 `13800000001` 登录；另一端（手机或另一台 electron）用 `13800000000` 登录。

- [ ] **Step 2: 走查清单**

逐项确认，任何一项不符都要修复后再勾选：

1. `13800000000` 发一条语音 → 接收方气泡右侧出现红点 + 「转文字」按钮。
2. 点「转文字」→ 红点与按钮消失，气泡下方出现「转文字中…」→ 出文字。
3. 右键这条语音 → 菜单首项为「隐藏文字」；点击后文字块消失；再右键为「转文字」，点击立即恢复文字（不发请求：开发者工具 Network/WS 帧里没有新的 `ASR`）。
4. 再收一条语音，直接点播放 → 红点消失，按钮也消失；右键「转文字」能出文字。
5. 侧边栏「设置」打开「自动转文字」→ 新收到的语音自动出文字，红点仍在，没有「转文字」按钮。
6. 断开服务端 ASR（`push.asr.enabled=false` 重启 push-group）后点转文字 → 显示「转文字失败，点击重试」，点击后重新请求。
7. 重启应用 → 已转出的文字仍在，隐藏状态保持，自动转文字开关保持；升级前已有的历史语音没有红点。
8. 深色 / 浅色主题下红点、按钮、文字块颜色正常。
