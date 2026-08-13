# 用户设置多端同步（electron-vue-chat-pro）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 electron 端把用户保存的群组、会话置顶、会话免打扰通过 `UG`/`UP`/`UN` 三个信令同步到服务端，重新登录时拉回来，多端在线时实时互通。

**Architecture:** 服务端已在 2.2.12-SNAPSHOT 打通这三个信令，WebSocket 侧走 JSON（不是二进制 protobuf）。electron 侧的置顶/免打扰已有完整的本地实现与持久化（随会话对象自动存进 localStorage），右键菜单也已就位，缺的是网络同步；「保存到通讯录」的群组则是三端里唯一完全没有的——store、UI、持久化都要新建。本计划新增一个 `useUserSettingStore` 作为设置的真值来源，两个 handler 处理 UG 应答与 UN 通知，把上报接进既有的四个开关方法。

**Tech Stack:** Electron + Vue 3 + Pinia + TypeScript，vitest 测试，electron-vite 构建。

**设计文档:** `chat-server-pro` 仓库的 `docs/superpowers/specs/2026-08-12-user-setting-sync-design.md`

**服务端依赖:** 需要服务端 2.2.12-SNAPSHOT（`push-group` + `push-connector` 都要更新，且 `push-group` 必须先上）已部署到联调环境，否则 UG/UP 会收到未知 topic 的错误码。

## Global Constraints

- **仓库路径**：`/Users/liaojinlong/Share/GitWorkplace/github/fshare/electron-vue-chat-pro`。`chat-server-pro`、`android-chat-pro`、`ios-chat-pro` 是**另外的独立 git 工作区**，本计划不改它们。
- **WebSocket 侧走 JSON 字符串，不是 protobuf**。这是 electron 与 android/iOS 的根本差异：那两端发的是二进制 protobuf、`SubSignal` 靠 ordinal 对齐；electron 的 topic 是**字符串**（`constant/index.ts` 里的 `export const FP = 'FP'` 这种），**不依赖任何 ordinal**，所以本计划不涉及枚举序号对齐问题。
- **线上 JSON 契约由服务端的 `websocket/im/` handler 决定，必须逐字匹配**：
  - `UG` 请求体 `{"version": 123}`，应答体是数组 `[{"scope":6,"key":"group-1","value":"1","updateDt":123}]`
  - `UP` 请求体 `{"scope":6,"key":"group-1","value":"1"}`，应答体 `{"head":"123"}`（**head 是字符串**）
  - `UN` 通知体 `{"head":"123"}`（同样是字符串）
  - CONNECT_ACK 里新增了 `settingHead` 字段（服务端 2.2.12 才有；旧服务端不下发，取到 `undefined`）
- **会话类 setting 的 key 格式固定为 `type-line-target`**（连字符，如 `1-0-groupId`），与服务端 `MemoryMessagesStore.getUserConversationSlient()` 一致。`type` 用会话类型数值（单聊 0、群聊 1），`line` 一律传 0。
- **取消操作写 value `"0"`（tombstone）**，不删除记录；从服务端拉回 `"0"` 时也只是当普通值存下。读取方一律以「是否等于 `"1"`」判断是否生效，其余值（含 `"0"`）都视为未设置。
- **scope 取值**：`6` 保存到通讯录的群组（key 为 groupId）、`3` 会话置顶、`1` 会话免打扰、`2` 全局免打扰（key 为空串）。
- **本地 version 与本地设置必须同生共死。** 三端都踩过这个坑：若 version 持久化而设置没有，重启后客户端会按该 version 只要增量，永久丢失已有设置。本计划把设置和 version 放进**同一个** pinia store、用**同一个** watch 落 localStorage、由**同一个**方法清空。
- 测试用 vitest：`npm test`（即 `vitest run`），单文件 `npx vitest run <path>`。测试文件与源码同目录、命名 `*.test.ts`（现有 10 个测试文件都是这个约定）。
- 提交信息沿用仓库习惯的中文描述式。

---

## 现状（已逐一核实，实现前不必重新调研）

**已就绪：**

- **置顶/免打扰的本地实现完整且已持久化**：`stores/useConversationStore.ts` 的 `topConversation`/`unTopConversation`（`:100-110`）、`silentConversation`/`unSilentConversation`（`:112-120`）改的是 `conversationInfo.isTop`/`isSilent`；`:168` 有 `watch(conversations, val => LocalStore.saveConverSations(val), { deep: true })`，**整个会话数组（含这两个标志）自动落 localStorage**。之前我判断「只改内存、刷新即丢」是错的——刷新不会丢，是**换设备/清数据**才丢。
- **排序正确**：`updateConverstationOrder()`（`:136-138`）按 `isTop` 分组后拼接，置顶恒在前。不存在 android 那个「新插入会话忽略 isTop」的 bug。
- **右键菜单两项都在**：`components/conversation/ConversationList.vue:23-24` 已有「置顶聊天/取消置顶」与「消息免打扰/取消免打扰」，`onMenuSelect`（`:36-45`）按当前状态调用对应的 store 方法。**本计划不需要动这个菜单。**
- **handler 范式现成**：`websocket/handler/getfriendresultHandler.ts` 是 PUB_ACK 应答模板（`match(proto)` 判 `proto.signal == PUB_ACK && proto.subSignal == FP`，`processMessage` 里 `JSON.parse(proto.content)` 后 `this.vueWebsocket.sendAction("...", data)` 推给 store）；`notifyFriendHandler.ts` 是 PUBLISH 通知模板。所有 handler 在 `websocket/index.ts:234-253` 的 `initHandlerList()` 里注册。
- **发送 API**：`websocket/index.ts:519` 的 `sendPublishMessage(subsignal, content, protoMessageId = 0)`，`content` 传对象即可；`:322` 的 `getFriend(version = 0)` 是最贴近的调用范式。
- **store 派发**：handler 里调 `this.vueWebsocket.sendAction(type, data)` → `storeDispatcher(type, data)`（`:229-231`），该函数由构造时注入（`:70,:79`）。
- **CONNECT_ACK 已有落点**：`websocket/handler/connectackhandler.ts` 解析 `data.content` 后依次拉好友、好友请求、消息。`settingHead` 的触发加在这里。
- **游标持久化范式**：`websocket/store/localstore.ts` 是 localStorage 封装，已有 `getLastMessageSeq/setLastMessageSeq`、`getFriendRequestVersion` 等成对方法。

**缺失：**

- `constant/index.ts` 没有 `UG`/`UP`/`UN` 三个 topic 常量（`:16-26` 那一片）。
- 没有任何设置 store，没有发 UG/UP 的代码，没有处理 UG/UN 的 handler。
- **「保存到通讯录」在 electron 端完全不存在**：`components/group/GroupInfo.vue` 没有该开关，好友 tab 也没有查看已保存群聊的入口。这是三端里唯一需要从零做 UI 的一端。好友页的结构是左右两栏（左 `components/friend/FriendList.vue`，右 `pages/FriendPage.vue` 的 `main.info-panel`），选中项由 `friendStore.selectFriendId` 表示、`0` 是「新的朋友」的哨兵值——新入口照这个模式加。

---

## 恢复时序（本计划要达成的目标状态）

```
CONNECT_ACK → connectackhandler 取 content.settingHead
        ↓
settingHead > 本地 version  →  getUserSettings(本地 version)  发 UG
        ↓
UG 应答 → UserSettingResultHandler
        ├─ 逐条写进 useUserSettingStore（含 value "0" 的 tombstone）
        ├─ 投影：scope 3 → conversationInfo.isTop，scope 1 → conversationInfo.isSilent
        └─ version = 本批最大 updateDt
```

**投影必须同时处理「会话已存在」与「会话尚未建出来」两种情况。** 三端里 iOS 就是在这里栽的：投影只在 UG 落地那一刻做一次，此后新建的会话行永远不回查设置表，重装场景下全部落空。electron 的规避方式更简单——**会话列表渲染时从设置 store 派生**，而不是只在 UG 那一刻写一次：

- `useUserSettingStore` 暴露 `isConversationTop(type, line, target)` / `isConversationSilent(...)`，`useConversationStore` 在**新增会话**时用它初始化 `isTop`/`isSilent`（Task 4 Step 3）。
- 这样无论 UG 先到还是会话先建，结果都一致，不依赖顺序。

**保存的群组**：`useUserSettingStore.savedGroupIds` 直接由 scope 6 的条目派生（只认 value `"1"`），好友 tab 的「群聊」面板读它。群名称头像从 `useGroupStore().groupInfoList` 取，缺失时用 `webSocketClient.getGroupInfo(id, false)` 补拉——重装后本地没有任何群信息，这一步是列表能显示群名的关键。

---

### Task 1: 三个 topic 常量与设置 store

设置的真值来源。version 与设置放在同一个 store、同一个 watch 里持久化，避免三端都踩过的「version 存了、设置丢了」。

**Files:**
- Modify: `src/renderer/src/constant/index.ts:16-26`（追加三个常量）
- Create: `src/renderer/src/stores/useUserSettingStore.ts`
- Test: `src/renderer/src/stores/useUserSettingStore.test.ts`

**Interfaces:**
- Produces:
  - 常量 `UG = 'UG'`、`UP = 'UP'`、`UN = 'UN'`
  - `USER_SETTING_SCOPE`：`{ conversationSilent: 1, globalSilent: 2, conversationTop: 3, favoriteGroup: 6 }`
  - `conversationSettingKey(conversationType: number, line: number, target: string): string` → `"type-line-target"`
  - `useUserSettingStore()` 暴露：`settings`（`Record<string, string>`，键为 `"scope:key"`）、`version`（`Ref<number>`）、`applyEntries(entries)`、`setLocal(scope, key, value)`、`settingValue(scope, key)`、`isConversationTop(type, line, target)`、`isConversationSilent(type, line, target)`、`savedGroupIds`（computed）、`clearAll()`

- [ ] **Step 1: 写失败的测试**

创建 `src/renderer/src/stores/useUserSettingStore.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUserSettingStore } from './useUserSettingStore'
import { USER_SETTING_SCOPE, conversationSettingKey } from '../constant'

describe('useUserSettingStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('会话 key 是连字符分隔的 type-line-target', () => {
    expect(conversationSettingKey(1, 0, 'group123')).toBe('1-0-group123')
    expect(conversationSettingKey(0, 0, 'user456')).toBe('0-0-user456')
  })

  it('scope 常量与服务端一致', () => {
    expect(USER_SETTING_SCOPE.conversationSilent).toBe(1)
    expect(USER_SETTING_SCOPE.globalSilent).toBe(2)
    expect(USER_SETTING_SCOPE.conversationTop).toBe(3)
    expect(USER_SETTING_SCOPE.favoriteGroup).toBe(6)
  })

  it('applyEntries 写入并把 version 推进到本批最大 updateDt', () => {
    const store = useUserSettingStore()

    store.applyEntries([
      { scope: 6, key: 'group-a', value: '1', updateDt: 100 },
      { scope: 3, key: '1-0-group-a', value: '1', updateDt: 300 },
      { scope: 1, key: '0-0-user-b', value: '1', updateDt: 200 }
    ])

    expect(store.settingValue(6, 'group-a')).toBe('1')
    expect(store.version).toBe(300)
  })

  it('version 只增不减，重叠拉取不会回退', () => {
    const store = useUserSettingStore()
    store.applyEntries([{ scope: 6, key: 'group-a', value: '1', updateDt: 500 }])

    store.applyEntries([{ scope: 6, key: 'group-b', value: '1', updateDt: 200 }])

    expect(store.version).toBe(500)
  })

  it('applyEntries 传空数组时 version 不变', () => {
    const store = useUserSettingStore()
    store.applyEntries([{ scope: 6, key: 'group-a', value: '1', updateDt: 500 }])

    store.applyEntries([])

    expect(store.version).toBe(500)
  })

  it('tombstone 存为普通值而不是删除记录', () => {
    const store = useUserSettingStore()
    store.applyEntries([{ scope: 6, key: 'group-a', value: '1', updateDt: 100 }])

    store.applyEntries([{ scope: 6, key: 'group-a', value: '0', updateDt: 200 }])

    expect(store.settingValue(6, 'group-a')).toBe('0')
  })

  it('savedGroupIds 只含 value 为 1 的群', () => {
    const store = useUserSettingStore()
    store.applyEntries([
      { scope: 6, key: 'group-a', value: '1', updateDt: 100 },
      { scope: 6, key: 'group-b', value: '0', updateDt: 200 },
      { scope: 6, key: 'group-c', value: '1', updateDt: 300 },
      { scope: 3, key: '1-0-group-d', value: '1', updateDt: 400 }
    ])

    expect([...store.savedGroupIds].sort()).toEqual(['group-a', 'group-c'])
  })

  it('同一个 key 在不同 scope 下互不干扰', () => {
    const store = useUserSettingStore()

    store.applyEntries([
      { scope: 3, key: '1-0-group-a', value: '1', updateDt: 100 },
      { scope: 1, key: '1-0-group-a', value: '0', updateDt: 100 }
    ])

    expect(store.isConversationTop(1, 0, 'group-a')).toBe(true)
    expect(store.isConversationSilent(1, 0, 'group-a')).toBe(false)
  })

  it('未设置过的会话，两个判定都是 false', () => {
    const store = useUserSettingStore()

    expect(store.isConversationTop(1, 0, 'never')).toBe(false)
    expect(store.isConversationSilent(1, 0, 'never')).toBe(false)
  })

  it('setLocal 立即生效，供 UI 不等服务端往返', () => {
    const store = useUserSettingStore()

    store.setLocal(USER_SETTING_SCOPE.favoriteGroup, 'group-a', '1')

    expect(store.settingValue(6, 'group-a')).toBe('1')
    expect([...store.savedGroupIds]).toEqual(['group-a'])
  })

  it('setLocal 不推进 version —— version 只跟随服务端的 updateDt', () => {
    const store = useUserSettingStore()
    store.applyEntries([{ scope: 6, key: 'group-a', value: '1', updateDt: 100 }])

    store.setLocal(6, 'group-b', '1')

    expect(store.version).toBe(100)
  })

  it('clearAll 同时清掉设置与 version', () => {
    const store = useUserSettingStore()
    store.applyEntries([{ scope: 6, key: 'group-a', value: '1', updateDt: 100 }])

    store.clearAll()

    expect(store.settingValue(6, 'group-a')).toBeUndefined()
    expect(store.version).toBe(0)
    expect([...store.savedGroupIds]).toEqual([])
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/renderer/src/stores/useUserSettingStore.test.ts
```

Expected: 失败，`Failed to resolve import "./useUserSettingStore"`

- [ ] **Step 3: 追加常量**

`src/renderer/src/constant/index.ts`，在 `export const SAI = 'SAI'` 那一行之后追加：

```ts
// 用户设置同步：UG 拉取、UP 上报、UN 服务端通知。
// WebSocket 侧按 topic 字符串路由，不依赖 android/iOS 那边的 SubSignal ordinal
export const UG = 'UG'; export const UP = 'UP'; export const UN = 'UN'

/** 与服务端 UserSettingScope 对齐 */
export const USER_SETTING_SCOPE = {
  conversationSilent: 1,
  globalSilent: 2,
  conversationTop: 3,
  favoriteGroup: 6
} as const

/**
 * 会话类 setting 的 key：type-line-target（连字符）。
 * 必须与服务端 MemoryMessagesStore.getUserConversationSlient() 的拼法完全一致，
 * 否则上传的设置服务端读不到。
 */
export function conversationSettingKey(conversationType: number, line: number, target: string): string {
  return `${conversationType}-${line}-${target}`
}
```

- [ ] **Step 4: 创建设置 store**

`src/renderer/src/stores/useUserSettingStore.ts`：

```ts
import { defineStore } from 'pinia'
import { ref, computed, watch } from 'vue'
import { USER_SETTING_SCOPE, conversationSettingKey } from '../constant'

export interface UserSettingEntry {
  scope: number
  key: string
  value: string
  updateDt: number
}

const STORAGE_KEY = 'user_settings'
const STORAGE_VERSION_KEY = 'user_settings_version'

/**
 * 用户设置的本地真值来源，镜像服务端的 t_user_setting。
 *
 * 设置与 version 刻意放在同一个 store、同一份持久化里：只要两者同生共死，
 * 就不会出现「version 还在、设置没了」——那样客户端会按该 version 只要增量，
 * 永久丢失已有设置。改动这里时务必保持这个不变量。
 *
 * 取消操作写 value "0"（tombstone）而不是删除记录，读取方一律只认 "1"。
 */
export const useUserSettingStore = defineStore('userSetting', () => {
  // 键为 `${scope}:${key}`，扁平化避免嵌套响应式的深比较开销
  const settings = ref<Record<string, string>>(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}'))
  const version = ref<number>(Number(localStorage.getItem(STORAGE_VERSION_KEY) ?? 0))

  function entryKey(scope: number, key: string): string {
    return `${scope}:${key}`
  }

  function settingValue(scope: number, key: string): string | undefined {
    return settings.value[entryKey(scope, key)]
  }

  /** 服务端 UG 应答落地：写全部条目（含 tombstone），version 取本批最大 updateDt，只增不减 */
  function applyEntries(entries: UserSettingEntry[]): void {
    let maxUpdateDt = version.value
    for (const entry of entries) {
      settings.value[entryKey(entry.scope, entry.key)] = entry.value
      if (entry.updateDt > maxUpdateDt) maxUpdateDt = entry.updateDt
    }
    version.value = maxUpdateDt
  }

  /** 本地先行写入，UI 不必等服务端往返。不动 version —— version 只跟随服务端的 updateDt */
  function setLocal(scope: number, key: string, value: string): void {
    settings.value[entryKey(scope, key)] = value
  }

  function isConversationTop(conversationType: number, line: number, target: string): boolean {
    return settingValue(USER_SETTING_SCOPE.conversationTop, conversationSettingKey(conversationType, line, target)) === '1'
  }

  function isConversationSilent(conversationType: number, line: number, target: string): boolean {
    return settingValue(USER_SETTING_SCOPE.conversationSilent, conversationSettingKey(conversationType, line, target)) === '1'
  }

  /** 已保存到通讯录的群 id。取消保存写的是 "0"，所以只认 "1" */
  const savedGroupIds = computed<string[]>(() => {
    const prefix = `${USER_SETTING_SCOPE.favoriteGroup}:`
    return Object.entries(settings.value)
      .filter(([k, v]) => k.startsWith(prefix) && v === '1')
      .map(([k]) => k.slice(prefix.length))
  })

  /** 登出/换账号时调用：设置与 version 必须一起清 */
  function clearAll(): void {
    settings.value = {}
    version.value = 0
  }

  watch(settings, val => localStorage.setItem(STORAGE_KEY, JSON.stringify(val)), { deep: true })
  watch(version, val => localStorage.setItem(STORAGE_VERSION_KEY, String(val)))

  return {
    settings, version, savedGroupIds,
    applyEntries, setLocal, settingValue,
    isConversationTop, isConversationSilent, clearAll
  }
})
```

- [ ] **Step 5: 运行测试确认通过**

```bash
npx vitest run src/renderer/src/stores/useUserSettingStore.test.ts
```

Expected: `12 passed`

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/constant/index.ts \
        src/renderer/src/stores/useUserSettingStore.ts \
        src/renderer/src/stores/useUserSettingStore.test.ts
git commit -m "新增用户设置 store 与 UG/UP/UN topic 常量，设置与 version 同生共死持久化"
```

---

### Task 2: UG / UP 网络方法与两个 handler

**Files:**
- Create: `src/renderer/src/websocket/handler/userSettingResultHandler.ts`
- Create: `src/renderer/src/websocket/handler/notifyUserSettingHandler.ts`
- Modify: `src/renderer/src/websocket/index.ts`（`initHandlerList()` 在 `:234-253` 区间注册两个 handler；在 `getFriend()`（`:322-324`）附近新增两个发送方法）
- Test: `src/renderer/src/websocket/handler/userSettingResultHandler.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `UG`/`UP`/`UN` 常量、`useUserSettingStore`
- Produces:
  - `websocket.getUserSettings(version: number)` —— 发 UG
  - `websocket.updateUserSetting(scope: number, key: string, value: string)` —— 发 UP
  - `UserSettingResultHandler`：匹配 `PUB_ACK` + `UG`，把应答数组交给 store
  - `NotifyUserSettingHandler`：匹配 `PUBLISH` + `UN`，触发一次 UG
  - `sendAction` 动作名 `applyUserSettings`（handler → store 的派发通道）

- [ ] **Step 1: 写失败的测试**

handler 的 `processMessage` 依赖注入进来的 `vueWebsocket`，用一个假对象就能测，不需要真连接。创建 `src/renderer/src/websocket/handler/userSettingResultHandler.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import UserSettingResultHandler from './userSettingResultHandler'
import NotifyUserSettingHandler from './notifyUserSettingHandler'
import { PUB_ACK, PUBLISH, UG, UN, FP } from '../../constant'

function fakeWebsocket() {
  return {
    sendAction: vi.fn(),
    getUserSettings: vi.fn(),
    resolvePromiseMap: new Map()
  }
}

describe('UserSettingResultHandler', () => {
  let ws: ReturnType<typeof fakeWebsocket>
  let handler: UserSettingResultHandler

  beforeEach(() => {
    ws = fakeWebsocket()
    handler = new UserSettingResultHandler(ws)
  })

  it('只匹配 PUB_ACK + UG', () => {
    expect(handler.match({ signal: PUB_ACK, subSignal: UG })).toBe(true)
    expect(handler.match({ signal: PUB_ACK, subSignal: FP })).toBe(false)
    expect(handler.match({ signal: PUBLISH, subSignal: UG })).toBe(false)
  })

  it('把应答数组原样派发给 store，含 tombstone', () => {
    const entries = [
      { scope: 6, key: 'group-a', value: '1', updateDt: 100 },
      { scope: 6, key: 'group-b', value: '0', updateDt: 200 }
    ]

    handler.processMessage({ signal: PUB_ACK, subSignal: UG, messageId: 1, content: JSON.stringify(entries) })

    expect(ws.sendAction).toHaveBeenCalledWith('applyUserSettings', entries)
  })

  it('空数组照常派发，让 store 自己决定不动 version', () => {
    handler.processMessage({ signal: PUB_ACK, subSignal: UG, messageId: 1, content: '[]' })

    expect(ws.sendAction).toHaveBeenCalledWith('applyUserSettings', [])
  })

  it('content 为空字符串时不派发，也不抛异常', () => {
    handler.processMessage({ signal: PUB_ACK, subSignal: UG, messageId: 1, content: '' })

    expect(ws.sendAction).not.toHaveBeenCalled()
  })

  it('content 不是合法 JSON 时不派发，也不抛异常', () => {
    handler.processMessage({ signal: PUB_ACK, subSignal: UG, messageId: 1, content: 'not json' })

    expect(ws.sendAction).not.toHaveBeenCalled()
  })
})

describe('NotifyUserSettingHandler', () => {
  let ws: ReturnType<typeof fakeWebsocket>
  let handler: NotifyUserSettingHandler

  beforeEach(() => {
    ws = fakeWebsocket()
    handler = new NotifyUserSettingHandler(ws)
  })

  it('只匹配 PUBLISH + UN', () => {
    expect(handler.match({ signal: PUBLISH, subSignal: UN })).toBe(true)
    expect(handler.match({ signal: PUB_ACK, subSignal: UN })).toBe(false)
    expect(handler.match({ signal: PUBLISH, subSignal: FP })).toBe(false)
  })

  it('收到通知就触发一次增量拉取', () => {
    handler.processMessage({ signal: PUBLISH, subSignal: UN, messageId: 0, content: JSON.stringify({ head: '999' }) })

    expect(ws.getUserSettings).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/renderer/src/websocket/handler/userSettingResultHandler.test.ts
```

Expected: 失败，`Failed to resolve import "./userSettingResultHandler"`

- [ ] **Step 3: 创建 UG 应答 handler**

`src/renderer/src/websocket/handler/userSettingResultHandler.ts`（照 `getfriendresultHandler.ts` 的形状，含 `// @ts-nocheck`）：

```ts
// @ts-nocheck
import AbstractMessageHandler from "./abstractmessagehandler";
import { PUB_ACK, UG } from "../../constant";
import Logger from "../utils/logger";

/**
 * UG 应答：服务端只返回 updateDt 大于请求 version 的条目。
 * value 为 "0" 是 tombstone（表示该设置被取消），照常写进 store —— 读取方只认 "1"，
 * 写 "0" 与删除等价，还保留了「服务端说过它被取消」这个事实。
 */
export default class UserSettingResultHandler extends AbstractMessageHandler{
    match(proto){
        return proto.signal == PUB_ACK && proto.subSignal == UG;
    }

    processMessage(proto){
        if(!proto.content){
            Logger.log("UserSettingResultHandler empty content");
            return;
        }
        let entries;
        try {
            entries = JSON.parse(proto.content);
        } catch (e) {
            Logger.log("UserSettingResultHandler parse failed " + proto.content);
            return;
        }
        if(!Array.isArray(entries)){
            Logger.log("UserSettingResultHandler unexpected payload " + proto.content);
            return;
        }
        Logger.log("UserSettingResultHandler entries " + entries.length);
        this.vueWebsocket.sendAction("applyUserSettings", entries);
    }
}
```

- [ ] **Step 4: 创建 UN 通知 handler**

`src/renderer/src/websocket/handler/notifyUserSettingHandler.ts`：

```ts
// @ts-nocheck
import AbstractMessageHandler from "./abstractmessagehandler";
import { PUBLISH, UN } from "../../constant";
import Logger from "../utils/logger";

/**
 * UN：服务端告知「你的设置变了」，body 是 {"head":"<version>"}。
 * 这里不解析 head —— 直接触发一次增量拉取，由 UG 应答带回真正的数据。
 * 发起修改的那台设备也会收到自己的 UN，多拉一次是幂等的。
 */
export default class NotifyUserSettingHandler extends AbstractMessageHandler{
    match(proto){
        return proto.signal == PUBLISH && proto.subSignal == UN;
    }

    processMessage(proto){
        Logger.log("NotifyUserSettingHandler " + proto.content);
        this.vueWebsocket.getUserSettings();
    }
}
```

- [ ] **Step 5: 注册两个 handler 并新增发送方法**

`src/renderer/src/websocket/index.ts`：

在文件头部与其他 handler 的 import 放在一起：

```ts
import UserSettingResultHandler from './handler/userSettingResultHandler'
import NotifyUserSettingHandler from './handler/notifyUserSettingHandler'
```

在 `initHandlerList()` 里 `this.handlerList.push(new GetFriendResultHandler(this));` 那一行之后追加：

```ts
        this.handlerList.push(new UserSettingResultHandler(this));
        this.handlerList.push(new NotifyUserSettingHandler(this));
```

在 `getFriend(version = 0)` 方法（`:322-324`）之后追加两个方法：

```ts
    /**
     * 拉取用户设置增量。不传 version 时用 store 里已同步到的最大 updateDt，新设备为 0 即全量。
     */
    getUserSettings(version){
        const store = useUserSettingStore();
        const from = version === undefined ? store.version : version;
        this.sendPublishMessage(UG, { version: from });
    }

    /**
     * 上报一条用户设置。取消操作传 value "0"（tombstone），不要用删除表达。
     * 先写本地让 UI 立即生效，上报失败不回滚，下次登录以服务端为准。
     */
    updateUserSetting(scope, key, value){
        useUserSettingStore().setLocal(scope, key, value);
        this.sendPublishMessage(UP, { scope: scope, key: key, value: value });
    }
```

并在文件头部补 import：

```ts
import { UG, UP } from '../constant'
import { useUserSettingStore } from '../stores/useUserSettingStore'
```

（`constant` 的 import 该文件已有，把 `UG, UP` 加进既有的解构列表即可，不要新增一行重复 import。）

- [ ] **Step 6: 运行测试确认通过**

```bash
npx vitest run src/renderer/src/websocket/handler/userSettingResultHandler.test.ts
```

Expected: `7 passed`

- [ ] **Step 7: 全量测试与构建**

```bash
npm test
npm run build
```

Expected: 两条都成功，既有测试无回归。

- [ ] **Step 8: 提交**

```bash
git add src/renderer/src/websocket/handler/userSettingResultHandler.ts \
        src/renderer/src/websocket/handler/notifyUserSettingHandler.ts \
        src/renderer/src/websocket/handler/userSettingResultHandler.test.ts \
        src/renderer/src/websocket/index.ts
git commit -m "新增用户设置 UG/UP 发送方法与 UG/UN 两个 handler"
```

---

### Task 3: 登录触发拉取，派发通道接进 store

**Files:**
- Modify: `src/renderer/src/websocket/handler/connectackhandler.ts`
- Modify: `src/renderer/src/stores/useAuthStore.ts:31-58`（`storeDispatcher` 映射表；该 store 也是创建 websocket 实例、注入 dispatcher 的地方，见 `:60-61`）
- Test: `src/renderer/src/websocket/handler/connectAckSettingGate.test.ts`

**Interfaces:**
- Consumes: Task 1 的 `useUserSettingStore`；Task 2 的 `websocket.getUserSettings(version)` 与 `applyUserSettings` 动作名
- Produces:
  - `shouldPullUserSettings(serverSettingHead: unknown, localVersion: number): boolean` —— 导出的纯函数，供 connectackhandler 与测试共用
  - `storeDispatcher` 新增 `applyUserSettings` 分支 → `useUserSettingStore().applyEntries(data)`

**为什么把门抽成纯函数**：这个比较是控制整条读路径的唯一开关，写反或写成 `>=` 会让整个功能静默失效，而所有既有测试仍然通过。iOS 端最终评审就点了这个洞。

- [ ] **Step 1: 写失败的测试**

创建 `src/renderer/src/websocket/handler/connectAckSettingGate.test.ts`：

```ts
import { describe, it, expect } from 'vitest'
import { shouldPullUserSettings } from './connectackhandler'

describe('shouldPullUserSettings', () => {
  it('服务端更新则拉取', () => {
    expect(shouldPullUserSettings(200, 100)).toBe(true)
  })

  it('相等不拉取', () => {
    expect(shouldPullUserSettings(100, 100)).toBe(false)
  })

  it('服务端更旧不拉取', () => {
    expect(shouldPullUserSettings(50, 100)).toBe(false)
  })

  it('服务端没有任何设置（0）且本地也是 0，不白拉一次', () => {
    expect(shouldPullUserSettings(0, 0)).toBe(false)
  })

  it('新设备：本地 0、服务端有数据，要全量拉', () => {
    expect(shouldPullUserSettings(1786526758676, 0)).toBe(true)
  })

  it('旧服务端不下发 settingHead（undefined）时不拉取，也不报错', () => {
    expect(shouldPullUserSettings(undefined, 0)).toBe(false)
  })

  it('settingHead 是字符串时按数值比较', () => {
    // 服务端 JSON 里 head 类字段有以字符串下发的先例，容错处理
    expect(shouldPullUserSettings('200', 100)).toBe(true)
    expect(shouldPullUserSettings('50', 100)).toBe(false)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/renderer/src/websocket/handler/connectAckSettingGate.test.ts
```

Expected: 失败，`shouldPullUserSettings is not a function`（或导入失败）

- [ ] **Step 3: 在 connectackhandler 里导出纯函数并接上触发**

`src/renderer/src/websocket/handler/connectackhandler.ts`。在 `export default class` **之前**加入：

```ts
/**
 * 是否需要拉取用户设置。服务端 2.2.12 之前不下发 settingHead，取到 undefined 时不拉。
 * 严格大于：相等说明本地已是最新，服务端为 0 说明它确实没有任何设置。
 */
export function shouldPullUserSettings(serverSettingHead, localVersion){
    const head = Number(serverSettingHead);
    if(!Number.isFinite(head)){
        return false;
    }
    return head > Number(localVersion || 0);
}
```

在 `processMessage(data)` 里，`this.vueWebsocket.getFriend();` 那一行之后加入：

```ts
        //用户设置：保存的群组、会话置顶、会话免打扰
        const settingStore = useUserSettingStore();
        if(shouldPullUserSettings(connectAcceptedMessage.settingHead, settingStore.version)){
            this.vueWebsocket.getUserSettings(settingStore.version);
        }
```

文件头部补 import：

```ts
import { useUserSettingStore } from "../../stores/useUserSettingStore";
```

- [ ] **Step 4: 给 storeDispatcher 加派发分支**

dispatcher 在 `src/renderer/src/stores/useAuthStore.ts:31-58`，是一个 `Record<string, () => void>` 映射表（不是 if/else 链），每行形如 `updateFriendIds: () => friendStore.updateFriendIds(data),`。

在该 map 里追加一行（放在 `updateConversationInfo` 那行附近即可，顺序不影响行为）：

```ts
        applyUserSettings:        () => userSettingStore.applyEntries(data),
```

`userSettingStore` 需要与该文件里既有的 `conversationStore` / `friendStore` 等一样，在 dispatcher 外层先取好实例。照它们的写法在同一处加：

```ts
const userSettingStore = useUserSettingStore()
```

并补 import（该文件的 store import 都用 `@/stores/...` 别名）：

```ts
import { useUserSettingStore } from '@/stores/useUserSettingStore'
```

- [ ] **Step 5: 运行测试确认通过**

```bash
npx vitest run src/renderer/src/websocket/handler/connectAckSettingGate.test.ts
npm test
```

Expected: 7 个门测试通过，既有测试无回归。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/websocket/handler/connectackhandler.ts \
        src/renderer/src/websocket/handler/connectAckSettingGate.test.ts
git add -u
git commit -m "登录时按 settingHead 拉取用户设置，UG 应答派发进设置 store"
```

---

### Task 4: 置顶/免打扰接上报，新建会话时从设置派生

**Files:**
- Modify: `src/renderer/src/stores/useConversationStore.ts:100-120`（四个方法发 UP）与新增会话处（从设置派生初值）
- Test: `src/renderer/src/stores/useConversationStore.test.ts`（该文件不存在则新建）

**Interfaces:**
- Consumes: Task 1 的 `useUserSettingStore`、`USER_SETTING_SCOPE`、`conversationSettingKey`；Task 2 的 `websocket.updateUserSetting(scope, key, value)`
- Produces: 四个开关方法在改本地的同时发 UP；新建会话对象时 `isTop`/`isSilent` 由设置 store 派生

**这是本计划最容易出错的一步。** iOS 端在这里栽过：投影只在 UG 落地那一刻做一次，此后新建的会话永远不回查设置，重装场景全部落空且不可恢复（version 已推进）。electron 的规避方式是**新建会话时从设置派生**，这样 UG 先到或会话先建都得到同样结果。

- [ ] **Step 1: 写失败的测试**

创建（或追加到）`src/renderer/src/stores/useConversationStore.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useUserSettingStore } from './useUserSettingStore'
import { USER_SETTING_SCOPE } from '../constant'

const updateUserSetting = vi.fn()
vi.mock('@/websocket/websocketcli', () => ({
  default: { updateUserSetting: (...args: unknown[]) => updateUserSetting(...args) }
}))

describe('会话设置与服务端同步', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    updateUserSetting.mockClear()
  })

  it('设置先到、会话后建：新会话直接带上置顶与免打扰', () => {
    const settingStore = useUserSettingStore()
    settingStore.applyEntries([
      { scope: USER_SETTING_SCOPE.conversationTop, key: '1-0-group-a', value: '1', updateDt: 100 },
      { scope: USER_SETTING_SCOPE.conversationSilent, key: '1-0-group-a', value: '1', updateDt: 100 }
    ])

    expect(settingStore.isConversationTop(1, 0, 'group-a')).toBe(true)
    expect(settingStore.isConversationSilent(1, 0, 'group-a')).toBe(true)
  })

  it('取消后的 tombstone 不会被当成已设置', () => {
    const settingStore = useUserSettingStore()
    settingStore.applyEntries([
      { scope: USER_SETTING_SCOPE.conversationTop, key: '1-0-group-a', value: '1', updateDt: 100 },
      { scope: USER_SETTING_SCOPE.conversationTop, key: '1-0-group-a', value: '0', updateDt: 200 }
    ])

    expect(settingStore.isConversationTop(1, 0, 'group-a')).toBe(false)
  })
})
```

**注意**：`useConversationStore` 通过门面单例 `@/websocket/websocketcli` 发消息（Step 3 会加），所以 mock 的是那个模块的默认导出，不是 `@/websocket`。

- [ ] **Step 2: 运行测试确认失败或通过**

```bash
npx vitest run src/renderer/src/stores/useConversationStore.test.ts
```

前两个断言只依赖 Task 1 的 store，应当**直接通过**——它们是给 Step 3 的派生逻辑做铺垫的前置事实。若失败，说明 Task 1 有问题，先回头查。

- [ ] **Step 3: 四个开关方法发 UP**

`src/renderer/src/stores/useConversationStore.ts:100-120`，四个方法各加一行上报。以 `topConversation` 为例：

```ts
  function topConversation(targetId: string) {
    const sc = conversations.value.find(c => c.conversationInfo.target === targetId)
    if (sc) {
      sc.conversationInfo.isTop = true
      reportConversationSetting(sc, USER_SETTING_SCOPE.conversationTop, '1')
    }
    updateConverstationOrder()
  }
```

四个方法共用一个私有助手（放在同文件内，`topConversation` 之前）：

```ts
  /** 把一条会话设置上报给服务端。取消传 "0"（tombstone），不要用删除表达 */
  function reportConversationSetting(sc: StateConversationInfo, scope: number, value: string) {
    const info = sc.conversationInfo
    websocket.updateUserSetting(scope, conversationSettingKey(info.conversationType, info.line ?? 0, info.target), value)
  }
```

`unTopConversation` 传 `conversationTop` + `'0'`；`silentConversation` 传 `conversationSilent` + `'1'`；`unSilentConversation` 传 `conversationSilent` + `'0'`。四个方法原有的 `updateConverstationOrder()` 调用位置保持不变。

补 import：

```ts
import { USER_SETTING_SCOPE, conversationSettingKey } from '@/constant'
import webSocketClient from '@/websocket/websocketcli'
```

**websocket 实例通过 `webSocketClient` 单例访问，不要新造一个。** 该单例由 `useAuthStore.ts:61` 的 `webSocketClient.setInstance(vueSocket)` 在登录时填入、登出时置空（`:92`）。

它是个门面单例，对每个操作都写一个显式委托方法（`createGroup`、`quitGroup`、`getGroupInfo`、`getUserInfos` 等，全部形如 `return this._instance?.xxx(...)`）。照这个形状给它加两个方法，放在 `getGroupInfo` 附近：

```js
  getUserSettings(version) { return this._instance?.getUserSettings(version) }
  updateUserSetting(scope, key, value) { return this._instance?.updateUserSetting(scope, key, value) }
```

`_instance` 在登出时被置为 `null`（`useAuthStore.ts:92`），`?.` 已经处理了未登录/已登出的情况，调用方不需要再判空。于是助手写成：

```ts
  /** 把一条会话设置上报给服务端。取消传 "0"（tombstone），不要用删除表达 */
  function reportConversationSetting(sc: StateConversationInfo, scope: number, value: string) {
    const info = sc.conversationInfo
    const key = conversationSettingKey(info.conversationType, info.line ?? 0, info.target)
    webSocketClient.updateUserSetting(scope, key, value)
  }
```

- [ ] **Step 4: 新建会话时从设置派生初值**

会话由 `updateConversationInfo(protoConversationInfo)`（`src/renderer/src/stores/useConversationStore.ts:39`）落地——服务端推来的 `protoConversationInfo` 里带着 `isTop`/`isSilent`，而服务端**不下发**这两个字段的真值（它们是客户端概念），所以新会话会以 falsy 值进来。

在该函数里，往 `conversations.value` 新增会话的那条路径上（`let update = false` 之后的分支逻辑里，未命中既有会话、要 push 新会话的那一支），用设置 store 覆盖这两个字段：

```ts
      // 从设置派生而非沿用服务端推来的 falsy 值：UG 可能先于会话建立到达
      //（重装/换设备场景），只在 UG 落地那一刻投影一次会漏掉之后才建出来的会话
      const settingStore = useUserSettingStore()
      const info = protoConversationInfo
      info.isTop = settingStore.isConversationTop(info.conversationType, info.line ?? 0, info.target)
      info.isSilent = settingStore.isConversationSilent(info.conversationType, info.line ?? 0, info.target)
```

**只在新增分支做，不要在更新既有会话的分支做**——否则用户刚关掉的置顶会被下一条消息按服务端旧值复活。先完整读一遍 `updateConversationInfo` 确认哪条分支是新增、哪条是更新，在报告里写明你改的是哪一支。

改完后 `updateConverstationOrder()` 会按新的 `isTop` 重排，无需额外调用。

补 import：

```ts
import { useUserSettingStore } from '@/stores/useUserSettingStore'
```

- [ ] **Step 5: 运行测试与构建**

```bash
npm test
npm run build
```

Expected: 全绿，既有测试无回归。

- [ ] **Step 6: 提交**

```bash
git add src/renderer/src/stores/useConversationStore.ts \
        src/renderer/src/stores/useConversationStore.test.ts
git commit -m "会话置顶/免打扰改为同时上报服务端，新建会话从设置派生初值"
```

---

### Task 5: 「保存到通讯录」开关与好友 tab 的「群聊」入口

三端里只有 electron 完全没有这个功能，UI 与数据都要新建。

**Files:**
- Modify: `src/renderer/src/components/group/GroupInfo.vue`（新增开关）
- Create: `src/renderer/src/components/group/SavedGroupList.vue`
- Modify: `src/renderer/src/components/friend/FriendList.vue:45-60`（在「新的朋友」下面加「群聊」入口）
- Modify: `src/renderer/src/pages/FriendPage.vue:22,55`（右侧面板加一个分支）
- Test: `src/renderer/src/components/group/SavedGroupList.test.ts`

**查看入口的位置（用户指定）**：好友 tab 左侧列表里，「新的朋友」下面并列一个「**群聊**」，点它右侧面板显示已保存的群列表。

**Interfaces:**
- Consumes: Task 1 的 `useUserSettingStore`（`savedGroupIds`、`settingValue`）、`USER_SETTING_SCOPE`；Task 2 的 `websocket.updateUserSetting`
- Produces: 群详情页的保存开关；一个按 `savedGroupIds` 渲染的列表组件

- [ ] **Step 1: 写失败的测试**

创建 `src/renderer/src/components/group/SavedGroupList.test.ts`：

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'
import SavedGroupList from './SavedGroupList.vue'
import { useUserSettingStore } from '@/stores/useUserSettingStore'

describe('SavedGroupList', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('没有保存任何群时显示空态', () => {
    const wrapper = mount(SavedGroupList)

    expect(wrapper.text()).toContain('还没有保存的群聊')
  })

  it('只渲染 value 为 1 的群，tombstone 不出现', () => {
    const store = useUserSettingStore()
    store.applyEntries([
      { scope: 6, key: 'group-a', value: '1', updateDt: 100 },
      { scope: 6, key: 'group-b', value: '0', updateDt: 200 },
      { scope: 6, key: 'group-c', value: '1', updateDt: 300 }
    ])

    const wrapper = mount(SavedGroupList)

    const items = wrapper.findAll('[data-testid="saved-group-item"]')
    expect(items).toHaveLength(2)
  })

  it('取消保存后该群从列表消失', async () => {
    const store = useUserSettingStore()
    store.applyEntries([{ scope: 6, key: 'group-a', value: '1', updateDt: 100 }])
    const wrapper = mount(SavedGroupList)
    expect(wrapper.findAll('[data-testid="saved-group-item"]')).toHaveLength(1)

    store.applyEntries([{ scope: 6, key: 'group-a', value: '0', updateDt: 200 }])
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('[data-testid="saved-group-item"]')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npx vitest run src/renderer/src/components/group/SavedGroupList.test.ts
```

Expected: 失败，`Failed to resolve import "./SavedGroupList.vue"`

- [ ] **Step 3: 创建列表组件**

`src/renderer/src/components/group/SavedGroupList.vue`。群名称与头像取自 `useGroupStore().groupInfoList`（`GroupInfo[]`，按 `target` 匹配群 id，字段有 `name`、`portrait`、`memberCount`）。本地缺这个群的信息时，用门面 `webSocketClient.getGroupInfo(groupId, false)` 拉一次——重装后本地一个群信息都没有，这一步是「群聊」面板能显示群名的关键。

```vue
<template>
  <div class="saved-group-list">
    <div v-if="savedGroups.length === 0" class="empty">还没有保存的群聊</div>
    <div
      v-for="group in savedGroups"
      :key="group.id"
      data-testid="saved-group-item"
      class="saved-group-item"
      @click="$emit('select', group.id)"
    >
      <img v-if="group.portrait" :src="group.portrait" class="avatar" />
      <span class="name">{{ group.name }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useUserSettingStore } from '@/stores/useUserSettingStore'
import { useGroupStore } from '@/stores/useGroupStore'
import webSocketClient from '@/websocket/websocketcli'

defineEmits<{ (e: 'select', groupId: string): void }>()

const settingStore = useUserSettingStore()

const groupStore = useGroupStore()

// 群信息还没拉回来时退化为显示群 id，保证列表不会空着；同时补拉一次
const savedGroups = computed(() =>
  settingStore.savedGroupIds.map(id => {
    const info = groupStore.groupInfoList.find(g => g.target === id)
    if (!info) webSocketClient.getGroupInfo(id, false)
    return { id, name: info?.name ?? id, portrait: info?.portrait ?? '' }
  })
)
</script>

<style scoped>
.saved-group-list { display: flex; flex-direction: column; }
.saved-group-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; }
.saved-group-item:hover { background: var(--hover-bg, #f5f5f5); }
.avatar { width: 32px; height: 32px; border-radius: 4px; }
.empty { padding: 24px; text-align: center; color: #999; }
</style>
```

`groupName`/`groupPortrait` 两个函数按上一段查到的群信息 store 实际接口实现；查不到就保留退化实现并在报告里说明。样式变量与类名照本仓库既有组件的写法调整。

- [ ] **Step 4: 运行测试确认通过**

```bash
npx vitest run src/renderer/src/components/group/SavedGroupList.test.ts
```

Expected: `3 passed`

- [ ] **Step 5: 群详情页加「保存到通讯录」开关**

`src/renderer/src/components/group/GroupInfo.vue`。照该文件既有开关/行的写法加一行，绑定：

```ts
const settingStore = useUserSettingStore()

const isSaved = computed(() =>
  settingStore.settingValue(USER_SETTING_SCOPE.favoriteGroup, props.groupId) === '1'
)

function toggleSaved(value: boolean) {
  websocket.updateUserSetting(USER_SETTING_SCOPE.favoriteGroup, props.groupId, value ? '1' : '0')
}
```

**注意**：开关的当前状态必须由 `isSaved` 这个 computed 驱动（而不是本地 `ref`），否则从服务端拉回状态后开关不会跟着变——android 端就出过「群列表恢复了、开关还是关的」这个 bug。scope 6 的 key 是**裸 groupId**，不是会话三元组。

- [ ] **Step 6: 在好友 tab 加「群聊」入口**

好友页是左右两栏：左侧 `FriendList.vue` 是列表，右侧 `FriendPage.vue` 的 `main.info-panel` 按选中项切换面板。选中状态由 `friendStore.selectFriendId` 表示，**`0` 是「新的朋友」的哨兵值**（不是真实好友 id）：

- `FriendList.vue:45-60` 是「新的朋友」那个特殊入口：`@click="friendStore.selectFriendId = 0"`、`:class="{ active: selectFriendId === 0 }"`、图标 + `<span class="name">新的朋友</span>`，还带一个 `newFriendRequestCount` 角标。
- `FriendPage.vue:22`：`const showRequests = computed(() => selectFriendId.value === 0)`，`:55` 据此渲染 `<FriendRequestPanel v-if="showRequests" />`。

照这个模式加第二个哨兵值 `-1` 表示「群聊」（好友 id 为正数，`0` 已被占用，`-1` 安全）。

**`FriendList.vue`**：在「新的朋友」那个 `div` 之后、`v-for` 好友列表之前，插入结构完全对称的一项：

```vue
      <!-- 群聊 -->
      <div
        class="friend-item"
        :class="{ active: selectFriendId === -1 }"
        @click="friendStore.selectFriendId = -1"
      >
        <span class="name">群聊</span>
      </div>
```

class 名、图标元素、内部结构照抄上面「新的朋友」那一项的写法（它用了一个特殊图标 class，见 `:113` 附近的样式注释）；群聊项不需要角标。

**`FriendPage.vue`**：`:22` 之后加一个 computed：

```ts
const showSavedGroups = computed(() => selectFriendId.value === -1)
```

`:55` 的面板分支链里，把它插在 `FriendRequestPanel` 之后、`FriendInfo` 之前（`v-else-if` 链的顺序决定优先级，三者互斥）：

```vue
      <FriendRequestPanel v-if="showRequests" />
      <SavedGroupList v-else-if="showSavedGroups" @select="openGroupConversation" />
      <FriendInfo v-else-if="selectedFriend" :friend="selectedFriend" @send-message="sendMessage" />
```

`openGroupConversation(groupId)` 复用该页既有的 `sendMessage` 打开会话的逻辑——先读 `sendMessage` 的实现（它用 `ProtoConversationInfo` 与 `UnreadCount` 构造会话后跳转，见文件头部这两个 import），照它的写法写一个群会话版本：`conversationType` 传 `1`（群聊），`target` 传 `groupId`。若 `sendMessage` 本身已经能接受会话类型参数，直接复用、不要复制一份。

补 import：

```ts
import SavedGroupList from '@/components/group/SavedGroupList.vue'
```

- [ ] **Step 7: 全量测试与构建**

```bash
npm test
npm run build
```

Expected: 全绿。

- [ ] **Step 8: 提交**

```bash
git add src/renderer/src/components/group/ src/renderer/src/pages/FriendPage.vue
git commit -m "新增保存到通讯录开关，好友 tab 增加群聊入口展示已保存群列表"
```

---

### Task 6: 登出清理与端到端验证清单

**Files:**
- Modify: `src/renderer/src/stores/useAuthStore.ts:88` 起的登出流程（已有「清除所有 store 的内存状态」那一段）
- Create: `docs/superpowers/plans/2026-08-13-user-setting-sync-electron-manual-verification.md`

**Interfaces:**
- Consumes: Task 1 的 `useUserSettingStore().clearAll()`

**为什么必须做**：android 端最终评审在这里查出一个数据泄漏——登出不清设置与 version，换账号登录后新账号的拉取被 `settingHead` 门永久压制且无自愈路径。electron 的设置存在 localStorage，同一台机器换账号必然读到上一个账号的数据。

- [ ] **Step 1: 接进既有的登出清理**

清理逻辑已经存在，在 `src/renderer/src/stores/useAuthStore.ts:88` 起的登出流程里：清空 `KEY_VUE_USER_ID`/`KEY_VUE_TOKEN`、`sendDisConnectMessage()`、`vueSocket = null`、`webSocketClient.setInstance(null)`、`LocalStore.clearLocalStore()`，随后有一段带注释「清除所有 store 的内存状态，避免切换账号时残留上一个用户的数据」的代码，逐个取 `useConversationStore()` / `useMessageStore()` / `useFriendStore()` 并清空。

在那一段里照同样的写法加上设置 store：

```ts
    const userSettingStore = useUserSettingStore()
    // ……与其他 store 的清空调用并列
    userSettingStore.clearAll()
```

**`clearAll()` 必须同时清掉设置与 version**（Task 1 已保证）。只清其一就会复现 android 端最终评审查出的那个 bug：换账号后新账号的拉取被 `settingHead` 门永久压制，且无自愈路径。

补 import（该文件的 store import 都用 `@/stores/...` 别名）：

```ts
import { useUserSettingStore } from '@/stores/useUserSettingStore'
```

若 Task 3 Step 4 已经在该文件顶部加过这条 import，不要重复添加。

- [ ] **Step 2: 全量测试与构建**

```bash
npm test
npm run build
```

- [ ] **Step 3: 写端到端验证清单**

创建 `docs/superpowers/plans/2026-08-13-user-setting-sync-electron-manual-verification.md`：

````markdown
# 用户设置同步（electron）端到端验证清单

需要服务端 2.2.12-SNAPSHOT（`push-group` 先于 `push-connector`）已部署。
用 `npm run dev` 起开发版，开发者工具 Console 里观察日志。

| # | 操作 | 预期 |
|---|---|---|
| 1 | 群详情页打开「保存到通讯录」 | 好友 tab →「群聊」里出现该群；Console 有 UP 发送日志 |
| 2 | 刷新窗口（Cmd+R） | 群仍在列表里（localStorage 持久化） |
| 3 | **清空 localStorage 后重新登录** | 日志出现 UG 拉取；好友 tab →「群聊」完整恢复；这是本功能的核心场景 |
| 4 | 右键会话选「消息免打扰」，再右键 | 菜单变为「取消免打扰」 |
| 5 | **清空 localStorage 后重新登录** | 之前置顶/免打扰过的会话，在会话列表重建后仍带正确状态（新建会话从设置派生） |
| 6 | 同账号在手机端改任一设置 | electron 收到 UN 后自动拉取并更新界面 |
| 7 | 群详情页关闭「保存到通讯录」，清 localStorage 重登 | 该群不再出现（服务端返回 tombstone `"0"`） |
| 8 | **登出后用第二个账号登录** | 「群聊」显示第二个账号的群，不是第一个账号的 |

第 3、5、8 条是最容易出问题的三条。第 8 条 android 端曾有数据泄漏 bug。
````

- [ ] **Step 4: 提交**

```bash
git add -u
git add docs/superpowers/plans/2026-08-13-user-setting-sync-electron-manual-verification.md
git commit -m "登出时清空用户设置与 version，补端到端验证清单"
```

---

## 已知限制与后续项

- **全局免打扰（scope 2）没有 UI 入口**，本计划只保证协议侧可用：UG 拉回的 scope 2 条目会写进 store，但没有界面读它。
- **群名称与头像的补齐依赖既有的群信息拉取**。若「群聊」面板首次打开时群信息还没拉回来，列表会短暂显示群 id。Task 5 Step 3 已对缺失的群主动触发 `getGroupInfo` 补拉，拉回后列表会自动刷新。
- **UP 没有 ack 处理**：`sendPublishMessage` 不返回结果，服务端是否成功不可观测。与 android、iOS 当前状态一致，需要时再补 `PUB_ACK` + `UP` 的 handler。
- **老服务端兼容**：若联调环境还没更新到 2.2.12-SNAPSHOT，CONNECT_ACK 不会带 `settingHead`，`shouldPullUserSettings` 取到 `undefined` 直接返回 false，不会拉取也不会报错；UP 发出去会收到未知 topic 的错误码，同样不影响其他功能。
- **`settings` 用扁平的 `${scope}:${key}` 作为键**。若将来某个 key 里出现冒号会与分隔符冲突；当前四个 scope 的 key（groupId、`type-line-target`、空串）都不含冒号，暂不处理。
