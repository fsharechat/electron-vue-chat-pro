# 滚动清除未读红点 + 到底回弹 设计文档

日期：2026-07-23

## 背景 / 问题

应用在后台运行时，当前选中会话收到新消息：
- 会话列表红点（`unreadCount`）会累加，但只有点击该会话才会清除。
- 用户在消息列表里上下滚动查看新消息时，红点不会消失，托盘图标也不会停止闪烁。

期望改为类似微信的体验：只要用户在当前会话的消息列表里有滚动行为（即使应用仍在后台/未获得系统焦点），就视为“已查看”，清除该会话的未读红点；如果消息已经在底部，继续往下拉会有一个回弹（rubber-band）效果，同时也清除红点。

## 现状梳理

- `useConversationStore.ts`：
  - `selectConversation()` 点击会话时清零 `unreadCount.unread`。
  - `clearUnreadStatus()` 清零当前选中会话的 `unreadCount.unread`，目前只在 `MessageList.vue` 监听 `uiStore.visibilityState` 变为 `'visible'` 时调用。
- `useMessageStore.ts` 的 `addProtoMessage()`：当 `!isCurrentConv || !isAppVisible` 时才累加未读——即“当前会话 + 应用可见且聚焦”时才不累加，其余情况（含“当前会话但后台”）都会累加未读、触发通知/托盘闪烁。
- `useUIStore.ts`：`unreadTotalCount` 是所有会话未读之和的 computed；有 `watch(unreadTotalCount, total => { if (total === 0) window.electronAPI?.setFlashTray(false) })`——**总未读归零会自动停止托盘闪烁**，无需新增托盘相关代码。
- `ChatVirtualList.vue`：
  - `onScroll()` 处理原生 `scroll` 事件，维护 `atBottom`（`gapToBottom < 60`）并 emit `at-bottom-change`。
  - 到达最大 `scrollTop` 后，浏览器会钳制住，继续用滚轮往下滚不会再产生新的 `scroll` 事件。
  - 已设置 `overscroll-behavior: contain` 防止滚动链穿透到父级，但不影响本设计（本设计不依赖浏览器原生回弹，而是自绘）。
- `MessageList.vue`：
  - 维护本地 `unreadBadge`（滚动到底部按钮上的角标，与会话列表红点是两个独立概念）和 `isAtBottom`。
  - `onAtBottomChange(true)` 时清零本地 `unreadBadge` 并清除 `atMeSet`（群 @ 我标记）——这条逻辑保持不变。

## 设计

### 1. 任意滚动清除当前会话未读红点

- **不能挂在 `onScroll()` 里**：`onScroll()` 除了绑定原生 `@scroll` 事件外，还被 `scrollToBottom()`（自动钉底）和 `restoreAnchor()`（历史消息加载后复位）两处程序化调用。浏览器原生 `scroll` 事件无法区分“用户真实滚动”与“代码设置 scrollTop”（两者 `isTrusted` 都是 `true`），如果无条件在 `onScroll()` 里 emit，会导致：当前会话在底部时收到新消息 → 自动 `scrollToBottom()` 钉底 → 内部调用 `onScroll()` → 立刻清掉刚累加的未读红点，即使用户根本没有真正滑动、应用还在后台——未读红点系统会形同虚设。
- 改为只监听 **`wheel` 事件**（`ChatVirtualList.vue` 根元素新增 `@wheel="onWheel"`）：`wheel` 事件只能由真实鼠标滚轮/触控板触发，JS 无法伪造，天然不会与程序化滚动混淆。任意方向的 `wheel` 都视为“用户正在查看”，与到底回弹共用同一个 handler（见第 2 节）。
  - 范围内明确不覆盖：拖动滚动条、键盘 PageUp/PageDown/方向键滚动（这类交互在聊天应用里是少数场景，先不做，后续如有需要再补）。
- `MessageList.vue` 新增 `onUserScroll()` 监听 `@user-scroll`：
  ```ts
  function onUserScroll() {
    const c = conversations.value.find(c => c.conversationInfo.target === selectTarget.value)
    if (c?.conversationInfo.unreadCount?.unread) convStore.clearUnreadStatus()
  }
  ```
  加未读值判断只是避免每次滚动都做一次无意义的 store 写入/computed 重算，逻辑上等价于“任意滚动即清除”。
- 关键变化：**不再判断 `uiStore.isAppVisible`**。这是修复“应用在后台时滚动不清红点”的核心改动——只要这是用户当前正在看（且正在滚动）的会话，无论应用是否聚焦/可见，都视为已读。
- `useConversationStore.clearUnreadStatus()` 本身不用改，复用现有实现。

### 2. 已到底部继续下拉的回弹动画

到达最大 `scrollTop` 后浏览器会钳制住，继续往下滚 `wheel` 事件仍会持续触发（滚轮本身一直在产生 deltaY），只是 `scrollTop` 不再变化——这正好可以复用第 1 节的同一个 `onWheel`：

- `ChatVirtualList.vue` 新增：
  - `pullOffset` ref（默认 `0`），叠加进现有的 `cvl-window` transform：`translateY(${range.top + pullOffset}px)`（复用现有 transform 属性，不新增 DOM 层）。
  - `onWheel(e: WheelEvent)`（绑定在 `.cvl` 根元素的 `@wheel`）：
    ```ts
    let pullRestoreTimer: ReturnType<typeof setTimeout> | null = null

    function onWheel(e: WheelEvent) {
      emit('user-scroll') // 任意方向/任意时刻的真实滚轮事件都清红点
      if (!atBottom.value || e.deltaY <= 0) return
      pullOffset.value = Math.max(pullOffset.value - e.deltaY * 0.15, -24) // 限幅 -24px，跟手，无 transition
      if (pullRestoreTimer) clearTimeout(pullRestoreTimer)
      pullRestoreTimer = setTimeout(springBack, 100) // 100ms 无新的“到底下拉”事件后弹回
    }

    function springBack() {
      // 给 transform 加一次性 transition class，动画结束后移除，
      // 避免影响后续 scrollToBottom()/锚点复位等瞬时定位逻辑
    }
    ```
  - 回弹动画通过临时切一个 CSS class（例如 `.cvl-window--bounce-back`，`transition: transform 220ms cubic-bezier(0.34, 1.56, 0.64, 1)`）实现“轻微回弹”手感；拉动阶段（`onWheel` 累加 `pullOffset` 时）不带 transition，保证跟手。
  - 纯视觉效果：不修改真实 `scrollTop`，不影响虚拟列表的测量/锚点逻辑。Windows 鼠标滚轮和 macOS 触控板表现一致（不依赖系统原生回弹）。

### 3. 托盘闪烁停止

无需新代码。第 1/2 条清零当前会话 `unreadCount` 后，若这是唯一未读会话，`useUIStore.unreadTotalCount` 归零，已有的 `watch` 会自动调用 `setFlashTray(false)`。若还有其它会话未读，托盘继续闪烁——符合预期（总未读没清空前不应该停）。

### 4. @我标记（atMeSet）保持不变

群聊中的“有人@我”标记不参与本次改动，维持现状：仅在 `onAtBottomChange(true)`（真正滚动到底部）时清除，任意滚动不提前清除。理由：@ 意味着有一条具体消息需要用户实际看到，任意滚动不能证明用户已经看到那条被 @ 的消息。

## 涉及文件

- `src/renderer/src/components/chat/virtual/ChatVirtualList.vue`：新增 `onWheel` handler（同时负责 `user-scroll` emit 和到底回弹）、`pullOffset` 状态与 transform 叠加、回弹动画 CSS。
- `src/renderer/src/components/chat/MessageList.vue`：监听 `@user-scroll`，调用 `convStore.clearUnreadStatus()`。
- 不涉及主进程 / preload / IPC 改动。

## 测试计划

在现有 vitest（`environmentMatchGlobs` → renderer 用 jsdom）下：

- `ChatVirtualList.vue`：
  - 触发 `wheel` 事件（任意 `deltaY`）→ `user-scroll` 被 emit。
  - 已到底（`atBottom = true`）时触发 `wheel`（`deltaY > 0`）→ `pullOffset` 变为负值且被限幅在 -24px。
  - 未到底时触发同样的 `wheel` 事件 → `pullOffset` 不变化（不触发回弹），但 `user-scroll` 仍然 emit。
  - 等待 100ms 后 `pullOffset` 弹回 `0`。
  - 触发原生 `scroll` 事件（模拟 `scrollToBottom`/`restoreAnchor` 的程序化调用）→ **不** emit `user-scroll`（验证不会误清红点）。
- `MessageList.vue`：
  - mock `useConversationStore`，当前会话 `unreadCount.unread > 0` 时，子组件 emit `user-scroll` → `clearUnreadStatus` 被调用一次。
  - 当前会话 `unreadCount.unread === 0` 时 emit `user-scroll` → `clearUnreadStatus` 不被调用（避免无意义写入）。
  - 验证不再依赖 `uiStore.isAppVisible`：即使 mock 该值为 `false`，`user-scroll` 依然触发清除。
  - `atMeSet` 在 `user-scroll` 时保持不变，只有 `at-bottom-change(true)` 才清除。
