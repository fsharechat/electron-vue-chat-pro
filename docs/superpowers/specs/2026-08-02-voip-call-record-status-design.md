# 单聊通话记录结束状态渲染 设计文档

日期：2026-08-02

## 背景 / 问题

上一轮多端同步（406）修完之后，Android 接听时 PC 端会弹一句「已在其他设备接听」的 toast，但**消息列表里那条通话记录仍然只显示 `[语音通话]`**，无论这通电话是接通了、没人接、还是被其他设备接走。

Android 侧不是这样：`VoipMessageViewHolder.java` 按 `CallStartMessageContent.status` 渲染四种文案，`AVEngineKit.java:914` 在会话状态迁移时把状态写回本地消息库。同一个账号在两端看同一通电话，PC 上是一句没有信息量的 `[语音通话]`，Android 上是「通话时长 03:21」。

本设计把 Electron 单聊的通话记录对齐到 Android。

## 现状梳理

### Electron 侧

- `webrtc/message/callStartMessageContent.ts`：`decode()` 已经解析 `c`（connectTime）/ `e`（endTime）/ `s`（status），字段都在，**只是从来没有人写过它们**。`digest()` 恒返回 `[语音通话]` / `[视频通话]`。
- `components/chat/MessageBubble.vue:90`：`isVoip = content.type >= 400`，`voipText` 走 `MessageConfig.convert2MessageContent(...).digest()`。所以列表里显示什么完全由 `digest()` 决定，与状态无关。
- `webrtc/voipclient.ts`：三条结束路径（`cancelCall`、`endByRemoteBye`、406 分支）各自重复 `currentSession.endCall(reason)` + `currentSession = null`；接通点在 `handleICEConnectionStateChangeEvent` 的 `connected` 分支。
- `stores/useMessageStore.ts`：
  - `messages` 是 `ref<StateChatMessage[]>`，`watch(messages, val => LocalStore.saveMessages(val), { deep: true })`（第 286 行）——**改内存里的 `msg.content` 会自动持久化**。
  - `addProtoMessage()` 按 `messageId` 去重，已存在的消息不覆盖 `content`。服务端重复推送不会冲掉本地写入的状态。
  - 已有 `updateMessageContent` / `updateMessageStatus` 这类「遍历定位 + 就地改」的函数，新函数照这个模式写。
- `webrtc/groupCallClient.ts:56`：群聊多人通话发的是**同一条 `CallStartMessageContent`(400)**，也会落进消息列表。

### Android 侧（对齐参照）

- 状态取值（`CallStartMessageContent.java` 注释 + 本项目扩展）：`0` 未接听 / `1` 通话中 / `2` 已结束 / `3` 已在其他设备接听。
- 写入时机（`AVEngineKit.java:906-925`）：`Connected` 时写 `status=1` + `connectTime`；进 `Idle` 时写 `endTime` + `status=endStatusOverride>0 ? override : 2`，其中 `endStatusOverride=3` 只在 `AcceptByOtherClient` 时设置（`AVEngineKit.java:1082`）。
- 渲染（`VoipMessageViewHolder.java:36-56`）：见下方映射表。
- **全程只调 `ChatManager.updateMessage()` 改本地库，不发网络。**

## 设计

### 1. 状态写在 `voipclient` 层

候选过三个位置：

- `CallSession.setState()` —— Android 的对应位置，但 Electron 的 `CallSession` 被 `groupCallClient` 共用，在这写会直接波及群聊，得加开关。否决。
- `useCallStore` 的 sessionCb 回调 —— 回调签名里没有 `callId`，store 得额外记一份当前 callId，凭空多出要维护的状态。否决。
- **`voipclient`（采纳）** —— 唯一同时握着 callId、状态迁移和结束原因的地方；已经 `import useMessageStore`（`offerMessage` 里用 `preAddProtoMessage`），依赖方向是现成的；且它天然只管单聊，群聊走 `groupCallClient`，范围自动隔离。

### 2. 结束路径收敛为单一出口

`cancelCall`、`endByRemoteBye`、406 分支现在各自重复 `endCall(reason)` + `currentSession = null`。统一收进一个 `endSession(reason)` 出口：

```
endSession(reason) {
  markCallRecord(reason)          // 记录写入只挂这一处
  this.currentSession.endCall(reason)
  this.currentSession = null
}
```

三条路径改调 `endSession`。这样新增第四条结束路径时不会漏写记录。属于本次改动顺带的定向收拾，不额外扩大范围。

接通点单独处理：`handleICEConnectionStateChangeEvent` 的 `connected` 分支在 `setState(STATUS_CONNECTED)` 之后写 `status=1` + `connectTime=now`，并把 `connectTime` 存一份到 `currentSession`（新增字段，`CallSession` 已有 `startTime`，不突兀），供结束时判断是否接通过。

### 3. 状态映射

| 时机 / 结束原因 | status | 附带字段 | 渲染文案 |
|---|---|---|---|
| ICE connected | 1 | connectTime=now | 通话中 |
| `acceptByOtherClient` | 3 | endTime=now | 已在其他设备接听 |
| 其余全部（`hangup` / `remoteHangup` / `rejectByOtherClient` / `timeout` / 媒体与信令失败） | 2 | endTime=now | `connectTime>0` → 通话时长 mm:ss，否则 → 对方未接听 |
| 消息初始（通话未结束 / 历史消息） | 0 或 undefined | — | 对方未接听 |

`rejectByOtherClient` 归到 2 而不是单列，与 Android 一致（`AVEngineKit.java:1081` 只给 `AcceptByOtherClient` 设 override）——其他设备拒接了，语义上确实没人接。

时长格式照搬 `VoipMessageViewHolder.java:46-51`：超过 1 小时用 `通话时长 1:02:03`，否则 `通话时长 03:21`。

### 4. 消息定位：`useMessageStore.updateCallStatus()`

```
updateCallStatus(callId, patch)   // patch: { status, connectTime?, endTime? }
```

`patch` 是增量语义：**没传的字段保持原值不变**。结束时只传 `status` + `endTime`，接通时写下的 `connectTime` 必须原样保留，否则时长算不出来。

遍历 `messages` → `protoMessages`，命中条件三个都要满足：

- `content.type === MessageContentType.VOIP_CONTENT_TYPE_START`
- `content.content === callId`（`CallStartMessageContent.encode()` 把 callId 放在 `payload.content`）
- `conversationType === 0`（单聊。**这一条是群聊不被误伤的保险**，即使群通话的 callId 意外撞车也不会改到）

命中后：`convert2MessageContent` 拿到 `CallStartMessageContent` 实例 → 改字段 → `encode()` → 赋回 `msg.content`。与 `ChatPage.vue` 撤回时 `msg.content = recall.encode()` 是同一个模式。找不到就静默返回（历史消息可能已被 `CONVERSATION_MAX_MESSAGE_SIZE` 截断，不是错误）。

`encode()` 不需要改：`JSON.stringify` 会丢弃值为 `undefined` 的键，现状已经等价于 Android 的「>0 才写」。

### 5. 渲染：`webrtc/callRecordText.ts` + `MessageBubble.vue`

文案格式化抽成纯函数单独成文件：

```
callRecordText(status, connectTime, endTime) → string
```

`MessageBubble.vue` 的 `voipText` 改为分流：

- 单聊（`conversationType === 0`）且 `content.type === 400` → `callRecordText(...)`
- 其余（群聊通话记录、其他 4xx 类型）→ 保持现有 `digest()`，显示 `[语音通话]`

分流让群聊记录一个字都不变，不会出现「群通话显示对方未接听」的回归。`decode()` 在 `binaryContent` 为空时会抛异常，现有 `try/catch` 回退 `[语音通话]` 保留不动。

## 已知局限

状态只落本地（`LocalStore`），与 Android 同款：换设备或清缓存后，从服务端拉回的历史记录 status 回到主叫发出时的初始值，显示「对方未接听」。要跨端一致得让服务端支持消息内容更新（`updateRemoteMessageContent` 之类），超出本次范围。

## 不做

点击通话记录回拨（`VoipMessageViewHolder.java:59` 有）。用户没提，YAGNI。

## 测试

| 对象 | 用例 |
|---|---|
| `callRecordText` | status 0/1/3 三种固定文案；status 2 且 connectTime>0 → 时长；status 2 且 connectTime=0 → 对方未接听；时长跨 1 小时边界（3599s / 3600s）；status 为 undefined 当 0 处理 |
| `updateCallStatus` | 按 callId 命中并改写；callId 不存在时静默返回；**群聊消息（conversationType=1）同 callId 不被改动** |
| `voipclient` | 接通后挂断 → status=2 且 connectTime 已写；406 接听 → status=3；对端 Bye → status=2。复用 `voipclient.test.ts` 现成的 `makeClient()` mock 基建 |
| `MessageBubble` | 单聊 400 消息渲染状态文案；群聊 400 消息仍渲染 `[语音通话]` |

## 涉及文件

- `src/renderer/src/webrtc/callRecordText.ts`（新增）
- `src/renderer/src/webrtc/callRecordText.test.ts`（新增）
- `src/renderer/src/webrtc/voipclient.ts`（`endSession` 出口、`markCallRecord`、connected 分支）
- `src/renderer/src/webrtc/callSession.ts`（新增 `connectTime` 字段）
- `src/renderer/src/stores/useMessageStore.ts`（`updateCallStatus`）
- `src/renderer/src/components/chat/MessageBubble.vue`（`voipText` 分流）
- 对应测试文件
