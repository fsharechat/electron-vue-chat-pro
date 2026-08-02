# 单聊通话记录结束状态渲染 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让单聊消息列表里的通话记录显示「对方未接听 / 通话中 / 已在其他设备接听 / 通话时长 03:21」，与 Android 一致，取代现在恒定的 `[语音通话]`。

**Architecture:** `voipclient` 在通话接通和结束时，把状态（Android 的 `status` 0/1/2/3）写进本地那条 `CallStart` 消息的 content 并由 `useMessageStore` 的 deep watch 自动持久化；渲染层用一个纯函数 `callRecordText` 把状态翻成文案，群聊多人通话由该函数返回 `null` 回退到原有摘要。全程只改本地，不发网络。

**Tech Stack:** Vue 3 + Pinia + TypeScript，vitest（`src/renderer/**` 跑 jsdom 环境）。

## Global Constraints

- Node 20 必须：每个终端会话先跑 `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20`
- 单文件测试：`npm test -- <文件路径>`；全量：`npm test`
- 代码注释与提交信息用中文，注释解释「为什么」而不是复述代码
- 状态取值固定为 Android 语义，不得自创：`0` 未接听 / `1` 通话中 / `2` 已结束 / `3` 已在其他设备接听
- 只改本地消息，**不得**新增任何网络请求或信令
- 群聊（`conversationType !== 0`）通话记录必须保持现状 `[语音通话]` 不变
- 提交到本地即可，**不要 push**

---

### Task 1: 状态文案纯函数 `callRecordText`

**Files:**
- Create: `src/renderer/src/webrtc/callRecordText.ts`
- Test: `src/renderer/src/webrtc/callRecordText.test.ts`

**Interfaces:**
- Consumes: `MessageContentType.VOIP_CONTENT_TYPE_START`（`src/renderer/src/websocket/message/messageContentType.ts`，值 400）
- Produces:
  ```ts
  export interface CallRecordInput {
    conversationType: number
    contentType: number
    status?: number
    connectTime?: number
    endTime?: number
  }
  export function callRecordText(input: CallRecordInput): string | null
  ```
  返回 `null` 表示「这条消息不该用状态文案」，调用方回退到 `digest()`。Task 4 依赖这个签名。

- [ ] **Step 1: 写失败的测试**

创建 `src/renderer/src/webrtc/callRecordText.test.ts`：

```ts
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
```

- [ ] **Step 2: 跑测试确认失败**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20
npm test -- src/renderer/src/webrtc/callRecordText.test.ts
```

Expected: FAIL，报错为无法解析 `./callRecordText`（文件还不存在）。

- [ ] **Step 3: 写实现**

创建 `src/renderer/src/webrtc/callRecordText.ts`：

```ts
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
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test -- src/renderer/src/webrtc/callRecordText.test.ts
```

Expected: PASS，11 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/webrtc/callRecordText.ts src/renderer/src/webrtc/callRecordText.test.ts
git commit -m "feat: 通话记录状态文案纯函数，对齐 Android 四种状态"
```

---

### Task 2: `useMessageStore.updateCallStatus` 就地改写本地通话记录

**Files:**
- Modify: `src/renderer/src/stores/useMessageStore.ts`（在 `updateMessageStatus` 之后新增函数，并加进 return 列表）
- Test: `src/renderer/src/stores/useMessageStore.test.ts`（新建）

**Interfaces:**
- Consumes: `MessageConfig.convert2MessageContent(from, protoMessageContent)`（已在该文件 import）、`MessageContentType`（已 import）
- Produces:
  ```ts
  function updateCallStatus(
    callId: string,
    patch: { status: number; connectTime?: number; endTime?: number }
  ): void
  ```
  增量语义：patch 里没有的字段保持原值。Task 3 依赖这个签名。

- [ ] **Step 1: 写失败的测试**

创建 `src/renderer/src/stores/useMessageStore.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// useMessageStore -> useUIStore -> benz-amr-recorder，jsdom 里跑不起来
vi.mock('benz-amr-recorder', () => ({ default: vi.fn() }))

import { useMessageStore } from './useMessageStore'
import CallStartMessageContent from '@/webrtc/message/callStartMessageContent'

/** 造一条落在消息列表里的通话记录，content 用真实 encode 结果 */
function callStartProto(callId: string, conversationType = 0) {
  const content = new CallStartMessageContent(callId, 'peer-1', true)
  return {
    messageId: 'msg-' + callId, messageUid: '1', from: 'me', target: 'peer-1',
    conversationType, direction: 0, timestamp: 1000, status: 0, line: 0, tos: '',
    content: content.encode()
  }
}

/** 把消息 content 解回 CallStartMessageContent，断言里读状态用 */
function decode(content: any) {
  const mc = new CallStartMessageContent()
  mc.decode(content)
  return mc
}

function seed(store: any, protoMessages: any[]) {
  store.messages.push({ target: 'peer-1', name: '', protoMessages })
}

describe('useMessageStore.updateCallStatus', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('按 callId 命中并写入状态与结束时间', () => {
    const store = useMessageStore()
    seed(store, [callStartProto('call-1')])

    store.updateCallStatus('call-1', { status: 2, endTime: 202000 })

    const mc = decode(store.messages[0].protoMessages[0].content)
    expect(mc.status).toBe(2)
    expect(mc.endTime).toBe(202000)
  })

  it('增量写入：结束时不冲掉接通时刻，时长才算得出来', () => {
    const store = useMessageStore()
    seed(store, [callStartProto('call-1')])

    store.updateCallStatus('call-1', { status: 1, connectTime: 1000 })
    store.updateCallStatus('call-1', { status: 2, endTime: 202000 })

    const mc = decode(store.messages[0].protoMessages[0].content)
    expect(mc.status).toBe(2)
    expect(mc.connectTime).toBe(1000)
    expect(mc.endTime).toBe(202000)
  })

  it('群聊消息即使 callId 相同也不被改动', () => {
    const store = useMessageStore()
    seed(store, [callStartProto('call-1', 1)])

    store.updateCallStatus('call-1', { status: 3 })

    const mc = decode(store.messages[0].protoMessages[0].content)
    expect(mc.status).toBeFalsy()
  })

  it('callId 不存在时静默返回，不抛异常', () => {
    const store = useMessageStore()
    seed(store, [callStartProto('call-1')])

    expect(() => store.updateCallStatus('call-不存在', { status: 2 })).not.toThrow()

    const mc = decode(store.messages[0].protoMessages[0].content)
    expect(mc.status).toBeFalsy()
  })

  it('保留 audioOnly 等原有字段，不因改状态而丢失', () => {
    const store = useMessageStore()
    seed(store, [callStartProto('call-1')])

    store.updateCallStatus('call-1', { status: 2, endTime: 5000 })

    const mc = decode(store.messages[0].protoMessages[0].content)
    expect(mc.audioOnly).toBe(true)
    expect(mc.callId).toBe('call-1')
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- src/renderer/src/stores/useMessageStore.test.ts
```

Expected: FAIL，`store.updateCallStatus is not a function`。

- [ ] **Step 3: 写实现**

在 `src/renderer/src/stores/useMessageStore.ts` 的 `updateMessageStatus` 函数之后插入：

```ts
  /**
   * 就地更新本地通话记录的状态（Android 同款：0 未接听 / 1 通话中 / 2 已结束 /
   * 3 已在其他设备接听）。只改本地消息，不发网络 —— 服务端存的仍是主叫发出时的
   * 原始内容，换设备或清缓存后状态会回到初始值，这与 Android 的行为一致。
   *
   * patch 是增量语义：没传的字段保持原值，结束时才不会冲掉接通时刻。
   */
  function updateCallStatus(
    callId: string,
    patch: { status: number; connectTime?: number; endTime?: number }
  ) {
    for (const chat of messages.value) {
      for (const msg of chat.protoMessages as any[]) {
        // conversationType 这一条是群聊不被误伤的保险：群通话发的是同一种 CallStart
        if (msg.conversationType !== 0) continue
        if (msg.content?.type !== MessageContentType.VOIP_CONTENT_TYPE_START) continue
        if (msg.content?.content !== callId) continue

        const mc: any = MessageConfig.convert2MessageContent(msg.from, msg.content)
        // decode 失败（binaryContent 缺失等）返回 null，放弃更新好过写坏消息
        if (!mc) return
        mc.status = patch.status
        if (patch.connectTime !== undefined) mc.connectTime = patch.connectTime
        if (patch.endTime !== undefined) mc.endTime = patch.endTime
        msg.content = mc.encode()
        return
      }
    }
  }
```

然后把 `updateCallStatus` 加进文件末尾 `return { ... }` 里 `updateMessageStatus` 的旁边。

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test -- src/renderer/src/stores/useMessageStore.test.ts
```

Expected: PASS，5 个用例全绿。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/stores/useMessageStore.ts src/renderer/src/stores/useMessageStore.test.ts
git commit -m "feat: messageStore 新增按 callId 就地更新通话记录状态"
```

---

### Task 3: `voipclient` 在接通与结束时写状态

**Files:**
- Modify: `src/renderer/src/webrtc/voipclient.ts`（`cancelCall`、`endByRemoteBye`、406 分支、`handleICEConnectionStateChangeEvent`）
- Modify: `src/renderer/src/webrtc/callSession.ts`（新增 `connectTime` 字段声明）
- Test: `src/renderer/src/webrtc/voipclient.test.ts`（追加一个 describe 块）

**Interfaces:**
- Consumes: `useMessageStore().updateCallStatus(callId, patch)`（Task 2 产出）、`CallEndReason.REASON_AcceptByOtherClient`
- Produces:
  ```js
  markCallConnected()      // 写 status=1 + connectTime，并把 connectTime 记到 currentSession
  endSession(reason)       // 三条结束路径的唯一出口：写状态 → endCall(reason) → currentSession = null
  ```

- [ ] **Step 1: 写失败的测试**

先在 `src/renderer/src/webrtc/voipclient.test.ts` 顶部补 import，并加一个**全局** `beforeEach`（放在所有 `describe` 之外）：

```ts
import { setActivePinia, createPinia } from 'pinia'
import { useMessageStore } from '../stores/useMessageStore'

// endSession 会调 useMessageStore() 写通话记录，既有的 cancelCall / endByRemoteBye /
// 406 用例也都会走到那里。没有 active pinia 它们会集体报
// "getActivePinia was called with no active Pinia"，所以这里统一给每个用例配一个。
beforeEach(() => {
  setActivePinia(createPinia())
})
```

`CallStartMessageContent` 已在该文件 import，不用再加。然后在文件末尾追加新的 describe 块：

```ts
/**
 * 通话记录状态写入：voipclient 是唯一同时知道 callId、状态迁移和结束原因的地方，
 * 状态因此写在这一层。这些用例走真实的 messageStore，断言消息 content 被改对。
 */
describe('VoipClient 写本地通话记录状态', () => {
  let client

  beforeEach(() => {
    client = makeClient()
  })

  function seedCallRecord(callId) {
    const store = useMessageStore()
    const content = new CallStartMessageContent(callId, 'peer-1', true)
    store.messages.push({
      target: 'peer-1', name: '', protoMessages: [{
        messageId: 'msg-1', messageUid: '1', from: 'me', target: 'peer-1',
        conversationType: 0, direction: 0, timestamp: 1000, status: 0, line: 0, tos: '',
        content: content.encode()
      }]
    })
    return store
  }

  function readRecord(store) {
    const mc = new CallStartMessageContent()
    mc.decode(store.messages[0].protoMessages[0].content)
    return mc
  }

  it('接通时写 status=1 与接通时刻', () => {
    const store = seedCallRecord('call-1')
    makeSession(client, { callId: 'call-1', state: CallState.STATUS_CONNECTING })

    client.markCallConnected()

    const mc = readRecord(store)
    expect(mc.status).toBe(1)
    expect(mc.connectTime).toBeGreaterThan(0)
  })

  it('接通后挂断写 status=2，接通时刻保留下来供算时长', () => {
    const store = seedCallRecord('call-1')
    makeSession(client, { callId: 'call-1', state: CallState.STATUS_CONNECTED })

    client.markCallConnected()
    const connectTime = readRecord(store).connectTime
    client.cancelCall()

    const mc = readRecord(store)
    expect(mc.status).toBe(2)
    expect(mc.connectTime).toBe(connectTime)
    expect(mc.endTime).toBeGreaterThan(0)
  })

  it('没接通就取消写 status=2 且无接通时刻 —— 渲染成「对方未接听」', () => {
    const store = seedCallRecord('call-1')
    makeSession(client, { callId: 'call-1', state: CallState.STATUS_OUTGOING })

    client.cancelCall()

    const mc = readRecord(store)
    expect(mc.status).toBe(2)
    expect(mc.connectTime).toBeFalsy()
  })

  it('对端 Bye 结束写 status=2', () => {
    const store = seedCallRecord('call-1')
    makeSession(client, { callId: 'call-1', state: CallState.STATUS_CONNECTED })

    const bye = new CallByeMessageContent()
    bye.callId = 'call-1'
    client.onReceiveMessage(encodeProtoMessage(bye))

    expect(readRecord(store).status).toBe(2)
  })

  it('其他设备接听（406）写 status=3', () => {
    const store = seedCallRecord('call-1')
    makeSession(client, { callId: 'call-1', state: CallState.STATUS_INCOMING })

    const taken = new CallTakenMessageContent()
    taken.callId = 'call-1'
    taken.reason = CallTakenMessageContent.REASON_ANSWERED
    client.onReceiveMessage(encodeProtoMessage(taken, { direction: 0, from: 'me' }))

    expect(readRecord(store).status).toBe(3)
  })

  it('其他设备拒接（406 rejected）写 status=2，语义上确实没人接', () => {
    const store = seedCallRecord('call-1')
    makeSession(client, { callId: 'call-1', state: CallState.STATUS_INCOMING })

    const taken = new CallTakenMessageContent()
    taken.callId = 'call-1'
    taken.reason = CallTakenMessageContent.REASON_REJECTED
    client.onReceiveMessage(encodeProtoMessage(taken, { direction: 0, from: 'me' }))

    expect(readRecord(store).status).toBe(2)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

```bash
npm test -- src/renderer/src/webrtc/voipclient.test.ts
```

Expected: FAIL，`client.markCallConnected is not a function`，以及结束路径用例断言 status 为 undefined。

- [ ] **Step 3: 写实现**

3a. `src/renderer/src/webrtc/callSession.ts`：在 `startTime;` 下面加一行字段声明

```js
    startTime;
    connectTime;
```

3b. `src/renderer/src/webrtc/voipclient.ts`，在 `sendCallTaken` 之后新增两个方法：

```js
    /** ICE 接通：本地通话记录写「通话中」，并记下接通时刻供结束时算时长。 */
    markCallConnected(){
      if(!this.currentSession){
        return;
      }
      this.currentSession.connectTime = new Date().getTime();
      useMessageStore().updateCallStatus(this.currentSession.callId, {
        status: 1,
        connectTime: this.currentSession.connectTime
      });
    }

    /**
     * 结束通话的唯一出口。状态写入只挂这一处，新增结束路径时不会漏。
     * status 与 Android 对齐：只有「其他设备接听」写 3，其余（本端挂断、对端 Bye、
     * 其他设备拒接、超时、媒体/信令失败）一律 2，靠 connectTime 区分有没有真接通。
     */
    endSession(reason){
      if(!this.currentSession){
        return;
      }
      var session = this.currentSession;
      useMessageStore().updateCallStatus(session.callId, {
        status: reason === CallEndReason.REASON_AcceptByOtherClient ? 3 : 2,
        endTime: new Date().getTime()
      });
      session.endCall(reason);
      this.currentSession = null;
    }
```

3c. `cancelCall` 结尾两行改成走出口：

```js
      // 改前
      this.currentSession.endCall(CallEndReason.REASON_Hangup);
      this.currentSession = null;
      // 改后
      this.endSession(CallEndReason.REASON_Hangup);
```

3d. `endByRemoteBye` 整体改成：

```js
    /** 因收到对端 Bye 而结束。不回发 Bye，也不广播 406。 */
    endByRemoteBye(){
      this.endSession(CallEndReason.REASON_RemoteHangup);
    }
```

3e. `onReceiveMessage` 里的 406 分支，把 `this.currentSession.endCall(...)` + `this.currentSession = null` 两行换成：

```js
              this.endSession(
                  content.reason === CallTakenMessageContent.REASON_REJECTED
                      ? CallEndReason.REASON_RejectByOtherClient
                      : CallEndReason.REASON_AcceptByOtherClient);
```

3f. `handleICEConnectionStateChangeEvent` 的 `connected` 分支加一行：

```js
            case "connected":
                this.currentSession.setState(CallState.STATUS_CONNECTED);
                this.markCallConnected();
              break;
```

- [ ] **Step 4: 跑测试确认通过**

```bash
npm test -- src/renderer/src/webrtc/voipclient.test.ts
```

Expected: PASS。原有的 cancelCall / endByRemoteBye / 406 用例必须一起保持绿色 —— 它们验证的信令行为（发不发 Bye、发不发 406）不能因为这次收敛而改变。

- [ ] **Step 5: 提交**

```bash
git add src/renderer/src/webrtc/voipclient.ts src/renderer/src/webrtc/callSession.ts src/renderer/src/webrtc/voipclient.test.ts
git commit -m "feat: 通话接通与结束时写本地记录状态，结束路径收敛为单一出口"
```

---

### Task 4: `MessageBubble` 渲染分流

**Files:**
- Modify: `src/renderer/src/components/chat/MessageBubble.vue:92-98`（`voipText` computed）

**Interfaces:**
- Consumes: `callRecordText(input)`（Task 1 产出）

分流判定（`conversationType` / `contentType`）已经收在 `callRecordText` 内部并由 Task 1 的两个用例覆盖（群聊返回 null、非 CallStart 返回 null），这里只做接线，不新增组件测试 —— 与本项目 `MessageBubble.test.ts` 只测纯函数的既有风格一致。

- [ ] **Step 1: 改 `voipText`**

把 `src/renderer/src/components/chat/MessageBubble.vue` 的 `voipText` 换成：

```ts
const voipText = computed(() => {
  if (!isVoip.value) return ''
  try {
    const mc = MessageConfig.convert2MessageContent(props.message.from, props.message.content) as any
    if (!mc) return '[语音通话]'
    // 单聊通话记录显示结束状态；群聊多人通话拿到 null，回退到摘要
    const record = callRecordText({
      conversationType: props.message.conversationType,
      contentType: props.message.content.type,
      status: mc.status,
      connectTime: mc.connectTime,
      endTime: mc.endTime
    })
    return record ?? (mc.digest?.() ?? '[语音通话]')
  } catch { return '[语音通话]' }
})
```

并在该文件已有的 import 区加：

```ts
import { callRecordText } from '@/webrtc/callRecordText'
```

- [ ] **Step 2: 跑全量测试**

```bash
npm test
```

Expected: PASS，全部测试文件绿色（含 Task 1-3 新增的用例）。

- [ ] **Step 3: 构建验证**

```bash
npm run build
```

Expected: `✓ built in ...`，无 TS 报错。

- [ ] **Step 4: 提交**

```bash
git add src/renderer/src/components/chat/MessageBubble.vue
git commit -m "feat: 单聊通话记录渲染结束状态，群聊保持摘要"
```

- [ ] **Step 5: 真机验证清单（手动，`npm run dev`）**

跑起来对着单聊会话逐条确认，任一条不符即回到对应 Task：

1. 拨出后对方不接，自己取消 → 记录显示「对方未接听」
2. 接通聊 3 秒后挂断 → 记录显示「通话时长 00:03」
3. 同账号另一台设备（Android）接听 → PC 弹「已在其他设备接听」toast，记录显示「已在其他设备接听」
4. 重启应用 → 上述记录状态仍在（`LocalStore` 已持久化）
5. 群聊发起多人通话 → 记录仍是 `[语音通话]`，没有变成「对方未接听」
