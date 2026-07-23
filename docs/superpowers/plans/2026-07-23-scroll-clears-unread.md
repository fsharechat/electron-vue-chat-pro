# 消息列表滚动清除未读红点 + 到底回弹 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 当前选中会话的消息列表里，任意真实鼠标滚轮/触控板滚动都清除该会话的未读红点（不再要求应用可见/聚焦）；已到底部时继续下拉有一个轻微回弹动画，同样清红点。

**Architecture:** 只改两个渲染层文件。`ChatVirtualList.vue` 新增一个 `wheel` 事件 handler：任意 `wheel` 都 emit 新事件 `user-scroll`；已到底且继续向下滚时额外叠加一个会自动弹回的 `pullOffset` 到现有虚拟列表 transform 上。`MessageList.vue` 监听 `user-scroll`，调用已有的 `useConversationStore.clearUnreadStatus()`。红点清零后，`useUIStore.ts` 里已有的 `watch(unreadTotalCount, ...)` 会在总未读归零时自动停止托盘闪烁——这条链路不用碰。

**Tech Stack:** Vue 3 `<script setup>`，Pinia，vitest + jsdom + @vue/test-utils（现有测试基建，不新增依赖）。

## Global Constraints

- 运行测试前必须先切 Node 20：`export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20`
- 单文件测试命令：`npm test -- <相对路径>`
- renderer 下的文件（`src/renderer/**`）用 jsdom 环境跑（`vitest.config.ts` 的 `environmentMatchGlobs`）
- 不要执行任何 `git commit` / `git push`——用户要求这个功能全部验证通过后由他自己决定是否提交
- 不改动主进程 / preload / IPC，`setFlashTray` 相关代码保持不变

---

### Task 1: ChatVirtualList.vue — wheel 驱动 user-scroll + 到底回弹

**Files:**
- Modify: `src/renderer/src/components/chat/virtual/ChatVirtualList.vue`
- Test: `src/renderer/src/components/chat/virtual/ChatVirtualList.test.ts`

**Interfaces:**
- Produces: 新 emit `(e: 'user-scroll'): void`，只在真实 `wheel` 事件里触发，绝不在 `onScroll()` 被 `scrollToBottom()`/`restoreAnchor()` 程序化调用时触发。Task 2 会监听这个事件。
- 不改动现有 `defineExpose` 的 `scrollToBottom` / `captureAnchor` / `restoreAnchor` / `isAtBottom`。

- [ ] **Step 1: 写失败测试——wheel 事件（任意方向）emit user-scroll，但原生 scroll 事件不 emit**

在 `src/renderer/src/components/chat/virtual/ChatVirtualList.test.ts` 文件末尾（`</script>` 无关，这是纯 `.ts` 测试文件，加在文件最后一个 `describe` 块之后）新增：

```ts
describe('ChatVirtualList wheel 驱动的 user-scroll', () => {
  it('wheel 事件(任意方向)都 emit user-scroll', async () => {
    const { wrapper, el } = mountList(200)
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -50 }))
    await nextTick()
    expect(wrapper.emitted('user-scroll')).toHaveLength(1)
  })

  it('原生 scroll 事件(模拟 scrollToBottom/restoreAnchor 的程序化调用)不 emit user-scroll', async () => {
    const { wrapper, el } = mountList(200)
    el.scrollTop = 5000
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(wrapper.emitted('user-scroll')).toBeFalsy()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/renderer/src/components/chat/virtual/ChatVirtualList.test.ts`
Expected: 第一个新测试 FAIL（`emitted('user-scroll')` 是 `undefined`，`toHaveLength` 报错），第二个新测试 PASS（因为还没加任何 emit，本来就不会 emit）。

- [ ] **Step 3: 实现 wheel handler + user-scroll emit**

在 `ChatVirtualList.vue` 的 `<script setup>` 里：

1. 修改 `emit` 类型定义（原第 15-18 行）：

```ts
const emit = defineEmits<{
  (e: 'reach-top'): void
  (e: 'at-bottom-change', v: boolean): void
  (e: 'user-scroll'): void
}>()
```

2. 在 `function onScroll() { ... }` 定义之后（原第 61 行之后）新增：

```ts
function onWheel(e: WheelEvent) {
  emit('user-scroll')
}
```

（回弹逻辑在 Step 6 里扩展这个函数，这一步先只保证 emit 独立可测。）

3. 修改模板根元素（原第 237 行），新增 `@wheel`：

```html
<div ref="scroller" class="cvl" @scroll="onScroll" @wheel="onWheel">
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/renderer/src/components/chat/virtual/ChatVirtualList.test.ts`
Expected: 全部 PASS，包括 Step 1 新增的两个测试。

- [ ] **Step 5: 写失败测试——到底后继续下拉产生限幅回弹，未到底时不产生**

在 Step 1 新增的 `describe('ChatVirtualList wheel 驱动的 user-scroll', ...)` 块内，先在文件顶部（`mountList` 函数定义之后）加一个小工具函数，从 `.cvl-window` 的内联 style 里解析当前 `translateY` 像素值：

```ts
function translateY(wrapper: any): number {
  const style = wrapper.find('.cvl-window').attributes('style') || ''
  const m = style.match(/translateY\((-?[\d.]+)px\)/)
  return m ? parseFloat(m[1]) : 0
}
```

然后在 `describe('ChatVirtualList wheel 驱动的 user-scroll', ...)` 块内追加：

```ts
  it('已到底部时继续向下滚,叠加负向 pullOffset 且限幅在 -24px', async () => {
    const { wrapper, el } = mountList(200)
    el.scrollTop = 19500 // gap = 20000 - 19500 - 500 = 0,贴底
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    const before = translateY(wrapper)
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 500 })) // 500*0.15=75,应被限幅到 24
    await nextTick()
    expect(before - translateY(wrapper)).toBe(24)
  })

  it('未到底部时 wheel 不产生回弹,但仍 emit user-scroll', async () => {
    const { wrapper, el } = mountList(200)
    el.scrollTop = 1000 // 远离底部
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    const before = translateY(wrapper)
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 500 }))
    await nextTick()
    expect(translateY(wrapper)).toBe(before)
    expect(wrapper.emitted('user-scroll')).toBeTruthy()
  })

  it('停止拉动约100ms后 pullOffset 弹回 0', async () => {
    const { wrapper, el } = mountList(200)
    el.scrollTop = 19500
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    const before = translateY(wrapper)
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 500 }))
    await nextTick()
    expect(before - translateY(wrapper)).toBe(24)
    await new Promise((r) => setTimeout(r, 150))
    await nextTick()
    expect(translateY(wrapper)).toBe(before)
  })
```

- [ ] **Step 6: 运行测试确认失败**

Run: `npm test -- src/renderer/src/components/chat/virtual/ChatVirtualList.test.ts`
Expected: Step 5 新增的三个测试 FAIL（`pullOffset` 逻辑还不存在，`translateY` 差值恒为 0）。

- [ ] **Step 7: 实现 pullOffset 状态 + 回弹动画**

在 `<script setup>` 里，`const atBottom = ref(true)` 附近（原第 45 行之后）新增：

```ts
const pullOffset = ref(0)
const bouncingBack = ref(false)
let pullRestoreTimer: ReturnType<typeof setTimeout> | null = null

function springBack() {
  bouncingBack.value = true
  pullOffset.value = 0
  setTimeout(() => { bouncingBack.value = false }, 220)
}
```

把 Step 3 里的 `onWheel` 替换为：

```ts
function onWheel(e: WheelEvent) {
  emit('user-scroll')
  if (!atBottom.value || e.deltaY <= 0) return
  bouncingBack.value = false
  pullOffset.value = Math.max(pullOffset.value - e.deltaY * 0.15, -24)
  if (pullRestoreTimer) clearTimeout(pullRestoreTimer)
  pullRestoreTimer = setTimeout(springBack, 100)
}
```

在 `onBeforeUnmount(() => { ... })`（原第 159-163 行）里加一行清理：

```ts
onBeforeUnmount(() => {
  ro?.disconnect()
  itemEls.clear()
  refFns.clear()
  if (pullRestoreTimer) clearTimeout(pullRestoreTimer)
})
```

修改模板里 `cvl-window` 那一层（原第 239 行），叠加 `pullOffset` 并按 `bouncingBack` 切换回弹 class：

```html
<div
  class="cvl-window"
  :class="{ 'cvl-window--bounce-back': bouncingBack }"
  :style="{ transform: `translateY(${range.top + pullOffset}px)` }"
>
```

在 `<style scoped>` 里 `.cvl-window { ... }` 规则（原第 266-272 行）之后新增：

```css
.cvl-window--bounce-back {
  transition: transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
```

- [ ] **Step 8: 运行测试确认通过**

Run: `npm test -- src/renderer/src/components/chat/virtual/ChatVirtualList.test.ts`
Expected: 全部测试 PASS（包括改动前就存在的所有旧测试——尤其注意 `scrollToBottom`/`restoreAnchor` 相关测试不应受 `pullOffset` 影响，因为它们不触发 `wheel`）。

- [ ] **Step 9: Commit（先不要执行——用户要求全部验证通过后由他决定是否提交，跳过这一步，仅本地保留改动）**

---

### Task 2: MessageList.vue — 监听 user-scroll，清除当前会话未读红点

**Files:**
- Modify: `src/renderer/src/components/chat/MessageList.vue`
- Test: 新建 `src/renderer/src/components/chat/MessageList.test.ts`

**Interfaces:**
- Consumes: Task 1 产出的 `ChatVirtualList` 的 `user-scroll` emit（无 payload）。
- Consumes: `useConversationStore` 已有的 `clearUnreadStatus(): void`（清零当前 `selectTarget` 对应会话的 `conversationInfo.unreadCount.unread`，定义于 `src/renderer/src/stores/useConversationStore.ts:32-37`，本任务不修改它）。
- 不产出新的对外接口。

- [ ] **Step 1: 写失败测试——mount MessageList,子组件 emit user-scroll 后 clearUnreadStatus 被调用**

新建 `src/renderer/src/components/chat/MessageList.test.ts`：

```ts
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('naive-ui', () => ({ useMessage: () => ({ error: vi.fn(), success: vi.fn() }) }))
vi.mock('benz-amr-recorder', () => ({ default: vi.fn() }))
vi.mock('@/websocket/websocketcli', () => ({
  default: { getRemoteMessages: vi.fn(), getGroupInfo: vi.fn(), getUserInfos: vi.fn() }
}))

import MessageList from './MessageList.vue'
import { useConversationStore } from '@/stores/useConversationStore'
import { useUIStore } from '@/stores/useUIStore'

function mountMessageList() {
  return mount(MessageList, {
    global: {
      stubs: {
        GroupInfo: true,
        UserProfileCard: true,
        ImageViewer: true,
        MessageBubble: true
      }
    }
  })
}

describe('MessageList 滚动清除未读红点', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('子组件 emit user-scroll 时,清零当前会话未读红点', async () => {
    const convStore = useConversationStore()
    convStore.conversations = [{
      name: '张三',
      img: '',
      conversationInfo: {
        conversationType: 0, target: 'u1', line: 0, isTop: false, isSilent: false,
        timestamp: 0, unreadCount: { unread: 3 }, lastMessage: null
      }
    }] as any
    convStore.selectTarget = 'u1'

    const wrapper = mountMessageList()
    await wrapper.findComponent({ name: 'ChatVirtualList' }).vm.$emit('user-scroll')

    expect(convStore.conversations[0].conversationInfo.unreadCount.unread).toBe(0)
  })

  it('即使 uiStore.isAppVisible 为 false(应用在后台),user-scroll 依然清除红点', async () => {
    const convStore = useConversationStore()
    const uiStore = useUIStore()
    uiStore.visibilityChange('visible')
    uiStore.setWindowFocused(false) // 模拟窗口在后台失焦
    expect(uiStore.isAppVisible).toBe(false)

    convStore.conversations = [{
      name: '张三',
      img: '',
      conversationInfo: {
        conversationType: 0, target: 'u1', line: 0, isTop: false, isSilent: false,
        timestamp: 0, unreadCount: { unread: 5 }, lastMessage: null
      }
    }] as any
    convStore.selectTarget = 'u1'

    const wrapper = mountMessageList()
    await wrapper.findComponent({ name: 'ChatVirtualList' }).vm.$emit('user-scroll')

    expect(convStore.conversations[0].conversationInfo.unreadCount.unread).toBe(0)
  })

  it('user-scroll 不清除群聊的 @我标记(atMeSet),只有真正滚到底部才清除', async () => {
    const convStore = useConversationStore()
    convStore.conversations = [{
      name: '项目群',
      img: '',
      conversationInfo: {
        conversationType: 1, target: 'g1', line: 0, isTop: false, isSilent: false,
        timestamp: 0, unreadCount: { unread: 2 }, lastMessage: null
      }
    }] as any
    convStore.selectTarget = 'g1'
    convStore.atMeSet.add('g1')

    const wrapper = mountMessageList()
    const vl = wrapper.findComponent({ name: 'ChatVirtualList' })
    await vl.vm.$emit('user-scroll')
    expect(convStore.atMeSet.has('g1')).toBe(true) // 仅滚动不清除 @ 标记

    await vl.vm.$emit('at-bottom-change', true)
    expect(convStore.atMeSet.has('g1')).toBe(false) // 真正到底才清除
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `npm test -- src/renderer/src/components/chat/MessageList.test.ts`
Expected: 前两个测试 FAIL（`unread` 仍是 `3`/`5`，因为 `MessageList.vue` 还没有监听 `user-scroll`）；第三个测试（`atMeSet`）此时应该 PASS，因为它验证的是既有的 `onAtBottomChange` 行为，与本任务要新增的代码无关。如果失败原因是挂载报错（缺少某个 mock），先解决挂载问题，确认是因为断言失败而不是挂载异常后再继续。

- [ ] **Step 3: 实现 onUserScroll 并接线到模板**

在 `MessageList.vue` 的 `<script setup>` 里，`function onAtBottomChange(v: boolean) { ... }`（原第 54-60 行）之后新增：

```ts
function onUserScroll() {
  convStore.clearUnreadStatus()
}
```

不加 `unread > 0` 判断——Vue 的响应式 setter 在新旧值相同时本来就不会触发依赖更新，重复清零一个已经是 0 的值是无副作用的空操作，没必要在业务代码里再判断一次。

在模板里 `<ChatVirtualList ...>` 标签（原第 177-184 行）新增一个事件绑定：

```html
<ChatVirtualList
  ref="vlRef"
  class="messages-scroll"
  :items="selectedChat.protoMessages"
  key-field="messageId"
  :estimate="80"
  @reach-top="loadHistory"
  @at-bottom-change="onAtBottomChange"
  @user-scroll="onUserScroll"
>
```

- [ ] **Step 4: 运行测试确认通过**

Run: `npm test -- src/renderer/src/components/chat/MessageList.test.ts`
Expected: 三个测试全部 PASS。

- [ ] **Step 5: 跑一遍相关旧测试,确认没有回归**

Run: `npm test -- src/renderer/src/components/chat/virtual/ChatVirtualList.test.ts src/renderer/src/components/chat/MessageList.test.ts src/renderer/src/stores/useUIStore.test.ts`
Expected: 全部 PASS。

- [ ] **Step 6: Commit（先不要执行——用户要求全部验证通过后由他决定是否提交,跳过这一步，仅本地保留改动）**

---

## 完成后的手动验证（不是自动化任务，供用户/执行者参考）

1. `npm run dev` 启动应用，两个账号互发消息。
2. 把应用窗口切到后台（点别的应用，不最小化），用另一个账号给当前选中会话发消息——确认会话列表红点出现、托盘开始闪烁。
3. 把鼠标移到消息列表上滚动几下（不点击、不聚焦窗口）——确认红点消失、托盘停止闪烁。
4. 滚动到消息列表底部后继续往下滚动滚轮——确认有一个轻微下沉再弹回的视觉效果，且红点/托盘同样已经是清除状态。
5. 群聊场景：让另一个账号 @ 当前用户，只在消息列表滚动（不滚到底部）——确认未读红点清除，但 @ 我的高亮标记仍然保留，只有滚动到底部才消失。
