# 消息列表虚拟化(方案③)实施方案

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 消息列表改为虚拟滚动——任何时刻只挂载可视区 ± overscan 的消息组件,支撑放开每会话 50 条消息上限,同时保住贴底、历史加载保位、图片框稳定、跨消息图片预览翻页。

**Architecture:** 手写专用 `ChatVirtualList` 组件(零新依赖):纯函数核心(前缀和 + 二分定位)算可视窗口,`ResizeObserver` 测量真实高度并做「视口上方高度变化补偿」,暴露 `scrollToBottom` / `captureAnchor` / `restoreAnchor` 三个聊天特有 API。图片预览从 `n-image-group`(依赖 DOM 挂载)改为自研 `ImageViewer`(数据源取 store,与挂载解耦)。消息组件的展开状态、图片框、原图升级结果按 messageId 存模块级缓存,滚出视口卸载再回来不丢状态。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript、ResizeObserver、vitest(jsdom)、CDP + playwright-core 端到端验证(项目 verify 技能)。

## Global Constraints

- Node ≥ 20:每个 shell 先 `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20`
- 测试命令:`npm test`(全部)/ `npm test -- <文件路径>`(单文件);渲染进程测试环境为 jsdom
- **不新增 runtime 依赖**;`dependencies` 只保留 `@electron-toolkit/preload` 和 `@electron-toolkit/utils`
- 所有颜色使用 `src/renderer/src/styles/variables.css` 的 CSS 变量,禁止硬编码
- 代码注释、commit message 用中文;commit 尾行加 `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>`
- 只提交本地,**不 push**(用户决定何时 push)
- `<script setup>` 顶层代码是每组件实例执行的;模块级单例(缓存等)必须放普通 `<script>` 块或独立 ts 模块
- 每会话消息上限 `CONVERSATION_MAX_MESSAGE_SIZE` 本方案不改动(虚拟化是放开它的前置条件,放开是后续独立决策)

---

### Task 1: 虚拟化核心纯函数 `virtualCore.ts`

**Files:**
- Create: `src/renderer/src/components/chat/virtual/virtualCore.ts`
- Test: `src/renderer/src/components/chat/virtual/virtualCore.test.ts`

**Interfaces:**
- Consumes: 无
- Produces(Task 2/3 依赖,签名逐字使用):
  - `buildOffsets(keys: string[], heights: Map<string, number>, estimate: number): number[]` — 返回长度 `keys.length + 1` 的前缀和数组,`offsets[i]` 为前 i 项总高,未测量项用 `estimate`
  - `findIndexAt(offsets: number[], y: number): number` — 二分返回覆盖纵坐标 y 的项索引(0..len-1)
  - `visibleRange(offsets: number[], scrollTop: number, viewport: number, overscan: number): { start: number; end: number; top: number }` — 可视窗口起止索引及 `top`(= `offsets[start]`,渲染窗口的绝对偏移);空列表返回 `{ start: 0, end: -1, top: 0 }`

- [ ] **Step 1: 写失败测试**

```ts
// src/renderer/src/components/chat/virtual/virtualCore.test.ts
import { describe, it, expect } from 'vitest'
import { buildOffsets, findIndexAt, visibleRange } from './virtualCore'

const keys10 = Array.from({ length: 10 }, (_, i) => `m${i}`)

describe('buildOffsets', () => {
  it('全部未测量时按估值累加', () => {
    const o = buildOffsets(keys10, new Map(), 100)
    expect(o).toHaveLength(11)
    expect(o[0]).toBe(0)
    expect(o[10]).toBe(1000)
  })
  it('已测量项用真实高度', () => {
    const heights = new Map([['m0', 40], ['m2', 300]])
    const o = buildOffsets(keys10, heights, 100)
    expect(o[1]).toBe(40)     // m0
    expect(o[2]).toBe(140)    // m0+m1(估值)
    expect(o[3]).toBe(440)    // +m2
  })
})

describe('findIndexAt', () => {
  const o = buildOffsets(keys10, new Map(), 100) // 每项 100
  it('边界与中间定位', () => {
    expect(findIndexAt(o, 0)).toBe(0)
    expect(findIndexAt(o, 99)).toBe(0)
    expect(findIndexAt(o, 100)).toBe(1)
    expect(findIndexAt(o, 999)).toBe(9)
  })
  it('越界钳制到最后一项', () => {
    expect(findIndexAt(o, 99999)).toBe(9)
  })
})

describe('visibleRange', () => {
  const o = buildOffsets(keys10, new Map(), 100)
  it('窗口含 overscan', () => {
    const r = visibleRange(o, 300, 200, 100) // 视口覆盖 300~500,overscan 后 200~600
    expect(r.start).toBe(2)
    expect(r.end).toBe(5)
    expect(r.top).toBe(200)
  })
  it('顶部不越界', () => {
    const r = visibleRange(o, 0, 200, 500)
    expect(r.start).toBe(0)
  })
  it('空列表', () => {
    expect(visibleRange([0], 0, 500, 100)).toEqual({ start: 0, end: -1, top: 0 })
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- src/renderer/src/components/chat/virtual/virtualCore.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 实现**

```ts
// src/renderer/src/components/chat/virtual/virtualCore.ts
// 虚拟列表核心:前缀和 + 二分。全部纯函数,无 DOM 依赖。

/** offsets[i] = 前 i 项总高度;未测量的项按 estimate 估算 */
export function buildOffsets(keys: string[], heights: Map<string, number>, estimate: number): number[] {
  const offsets = new Array<number>(keys.length + 1)
  offsets[0] = 0
  for (let i = 0; i < keys.length; i++) {
    offsets[i + 1] = offsets[i] + (heights.get(keys[i]) ?? estimate)
  }
  return offsets
}

/** 二分:返回覆盖纵坐标 y 的项索引(最大的 i 使 offsets[i] <= y),钳制在 0..len-1 */
export function findIndexAt(offsets: number[], y: number): number {
  let lo = 0
  let hi = offsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= y) lo = mid
    else hi = mid - 1
  }
  return Math.min(lo, offsets.length - 2)
}

/** 可视窗口(含上下 overscan 像素);top 为渲染窗口在总内容中的绝对偏移 */
export function visibleRange(
  offsets: number[],
  scrollTop: number,
  viewport: number,
  overscan: number
): { start: number; end: number; top: number } {
  if (offsets.length <= 1) return { start: 0, end: -1, top: 0 }
  const start = findIndexAt(offsets, Math.max(0, scrollTop - overscan))
  const end = findIndexAt(offsets, scrollTop + viewport + overscan)
  return { start, end, top: offsets[start] }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- src/renderer/src/components/chat/virtual/virtualCore.test.ts`
Expected: PASS(7 个测试)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/chat/virtual/
git commit -m "feat: 虚拟列表核心纯函数(前缀和+二分定位)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 2: `ChatVirtualList.vue` 渲染窗口

**Files:**
- Create: `src/renderer/src/components/chat/virtual/ChatVirtualList.vue`
- Test: `src/renderer/src/components/chat/virtual/ChatVirtualList.test.ts`

**Interfaces:**
- Consumes: Task 1 的三个纯函数
- Produces(Task 3 在同文件补交互;Task 7 使用):
  - Props: `items: any[]`、`keyField?: string`(默认 `'messageId'`)、`estimate?: number`(默认 80)、`overscan?: number`(默认 600,单位 px)
  - 默认插槽作用域:`{ item: any; index: number; prev: any | undefined }`(`prev` 为原数组前一项,供 MessageBubble 的时间分隔线判断)
  - 根元素类名 `cvl`,可从父组件透传 class

- [ ] **Step 1: 写失败测试**

```ts
// src/renderer/src/components/chat/virtual/ChatVirtualList.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import ChatVirtualList from './ChatVirtualList.vue'

// jsdom 无布局引擎:stub ResizeObserver,手动设置 clientHeight/scrollHeight
class ROStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => vi.stubGlobal('ResizeObserver', ROStub))

function makeItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({ messageId: `m${i}` }))
}

function mountList(n = 200) {
  const wrapper = mount(ChatVirtualList, {
    props: { items: makeItems(n), estimate: 100, overscan: 0 },
    slots: {
      default: ({ item, index, prev }: any) =>
        h('div', { class: 'row', 'data-idx': index, 'data-prev': prev?.messageId ?? '' }, item.messageId)
    }
  })
  const el = wrapper.element as HTMLElement
  Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { value: 100 * n, configurable: true })
  return { wrapper, el }
}

describe('ChatVirtualList 渲染窗口', () => {
  it('只渲染视口附近的项,而非全部', async () => {
    const { wrapper, el } = mountList(200)
    el.dispatchEvent(new Event('scroll')) // 触发读取 clientHeight
    await nextTick()
    const rows = wrapper.findAll('.row')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(30) // 200 项只渲染视口窗口
  })

  it('滚动后窗口移动,且 index/prev 对应原数组', async () => {
    const { wrapper, el } = mountList(200)
    el.scrollTop = 5000
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    const first = wrapper.find('.row')
    expect(first.text()).toBe('m50') // 5000/100
    expect(first.attributes('data-idx')).toBe('50')
    expect(first.attributes('data-prev')).toBe('m49')
  })

  it('空列表不渲染任何项', async () => {
    const wrapper = mount(ChatVirtualList, {
      props: { items: [] },
      slots: { default: ({ item }: any) => h('div', { class: 'row' }, item.messageId) }
    })
    await nextTick()
    expect(wrapper.findAll('.row')).toHaveLength(0)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- src/renderer/src/components/chat/virtual/ChatVirtualList.test.ts`
Expected: FAIL(组件不存在)

- [ ] **Step 3: 实现组件(本任务只做渲染窗口,交互 API 在 Task 3 补)**

```vue
<!-- src/renderer/src/components/chat/virtual/ChatVirtualList.vue -->
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { buildOffsets, findIndexAt, visibleRange } from './virtualCore'

const props = withDefaults(
  defineProps<{
    items: any[]
    keyField?: string
    estimate?: number
    overscan?: number
  }>(),
  { keyField: 'messageId', estimate: 80, overscan: 600 }
)

const emit = defineEmits<{
  (e: 'reach-top'): void
  (e: 'at-bottom-change', v: boolean): void
}>()

const scroller = ref<HTMLElement>()
const scrollTop = ref(0)
const viewportH = ref(0)

// 测量高度缓存(messageId 全局唯一,跨会话共用;非响应式 Map + version 触发重算)
const heights = new Map<string, number>()
const heightsVersion = ref(0)

const keys = computed(() => props.items.map((it) => String(it[props.keyField])))
const offsets = computed(() => {
  void heightsVersion.value
  return buildOffsets(keys.value, heights, props.estimate)
})
const total = computed(() => offsets.value[offsets.value.length - 1])
const range = computed(() => visibleRange(offsets.value, scrollTop.value, viewportH.value, props.overscan))
const rendered = computed(() => props.items.slice(range.value.start, range.value.end + 1))

const atBottom = ref(true)
watch(atBottom, (v) => emit('at-bottom-change', v))

function gapToBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight
}

function onScroll() {
  const el = scroller.value
  if (!el) return
  scrollTop.value = el.scrollTop
  viewportH.value = el.clientHeight
  atBottom.value = gapToBottom(el) < 60
  if (el.scrollTop < 10) emit('reach-top')
}

// —— 尺寸测量:观察每个渲染项,真实高度回写 heights ——
const itemEls = new Map<string, HTMLElement>()
let ro: ResizeObserver | null = null

function onResizeEntries(entries: ResizeObserverEntry[]) {
  const el = scroller.value
  if (!el) return
  let compensate = 0
  let changed = false
  for (const entry of entries) {
    const target = entry.target as HTMLElement
    const key = target.dataset.vlKey
    if (!key) continue
    const h = target.offsetHeight
    if (h === 0) continue // 卸载中的元素
    const old = heights.get(key)
    if (old === undefined || Math.abs(old - h) > 0.5) {
      // 视口上方的项高度变化会推挤内容,补偿 scrollTop 防止可见区域跳动
      const idx = keys.value.indexOf(key)
      if (idx >= 0 && offsets.value[idx] < el.scrollTop - 1) compensate += h - (old ?? props.estimate)
      heights.set(key, h)
      changed = true
    }
  }
  if (!changed) return
  heightsVersion.value++
  if (atBottom.value) {
    // 贴底状态下高度修正后重新钉底
    nextTick(() => {
      const cur = scroller.value
      if (cur) cur.scrollTop = cur.scrollHeight
    })
  } else if (compensate !== 0) {
    el.scrollTop += compensate
    scrollTop.value = el.scrollTop
  }
}

function observeItem(el: unknown, key: string) {
  const old = itemEls.get(key)
  if (old && old !== el) {
    ro?.unobserve(old)
    itemEls.delete(key)
  }
  if (el instanceof HTMLElement) {
    itemEls.set(key, el)
    ro?.observe(el)
  }
}

onMounted(() => {
  ro = new ResizeObserver(onResizeEntries)
  if (scroller.value) viewportH.value = scroller.value.clientHeight
})
onBeforeUnmount(() => {
  ro?.disconnect()
  itemEls.clear()
})
</script>

<template>
  <div ref="scroller" class="cvl" @scroll="onScroll">
    <div class="cvl-total" :style="{ height: total + 'px' }">
      <div class="cvl-window" :style="{ transform: `translateY(${range.top}px)` }">
        <div
          v-for="(item, i) in rendered"
          :key="keys[range.start + i]"
          class="cvl-item"
          :data-vl-key="keys[range.start + i]"
          :ref="(el) => observeItem(el, keys[range.start + i])"
        >
          <slot :item="item" :index="range.start + i" :prev="props.items[range.start + i - 1]" />
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.cvl {
  overflow-y: auto;
  overscroll-behavior: contain;
}
.cvl-total {
  position: relative;
}
.cvl-window {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  will-change: transform;
}
/* 关键:flow-root 阻止子元素 margin 塌陷穿透包裹层,
   否则 offsetHeight 量不到 time-divider 等的外边距,测量偏小导致滚动漂移
   (上一次虚拟化尝试踩过的真实坑) */
.cvl-item {
  display: flow-root;
}
</style>
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- src/renderer/src/components/chat/virtual/ChatVirtualList.test.ts`
Expected: PASS(3 个测试)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/chat/virtual/
git commit -m "feat: ChatVirtualList 虚拟渲染窗口(ResizeObserver 测量+上方高度补偿)

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 3: `ChatVirtualList` 交互 API(贴底 / 锚定 / 触顶)

**Files:**
- Modify: `src/renderer/src/components/chat/virtual/ChatVirtualList.vue`(Task 2 产物)
- Test: `src/renderer/src/components/chat/virtual/ChatVirtualList.test.ts`(追加)

**Interfaces:**
- Produces(Task 7 使用,通过 `defineExpose`):
  - `scrollToBottom(): Promise<void>` — 逐帧钉底直到 `gap ≤ 1px` 收敛(最多 10 帧,兼容估算高度渐次修正)
  - `captureAnchor(): void` — 记录当前视口第一个项的 key 与视口偏移
  - `restoreAnchor(): Promise<void>` — 数据变化(prepend)后把锚点项滚回原视口偏移
  - `isAtBottom(): boolean`
  - emit `reach-top`(scrollTop < 10 时,Task 2 已实现)、`at-bottom-change`

- [ ] **Step 1: 追加失败测试**

```ts
// 追加到 ChatVirtualList.test.ts
describe('ChatVirtualList 交互 API', () => {
  it('scrollToBottom 钉到底并报告 atBottom', async () => {
    const { wrapper, el } = mountList(200)
    await (wrapper.vm as any).scrollToBottom()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    expect(el.scrollTop).toBe(el.scrollHeight)
    expect((wrapper.vm as any).isAtBottom()).toBe(true)
  })

  it('captureAnchor/restoreAnchor:prepend 后锚点项回到原视口偏移', async () => {
    const { wrapper, el } = mountList(100)
    el.scrollTop = 1000 // 视口第一项 m10,偏移 delta=0
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    ;(wrapper.vm as any).captureAnchor()
    // 头部 prepend 20 条
    const more = Array.from({ length: 20 }, (_, i) => ({ messageId: `old${i}` }))
    await wrapper.setProps({ items: [...more, ...makeItems(100)] })
    await (wrapper.vm as any).restoreAnchor()
    // m10 现在是第 30 项,offsets[30]=3000,delta 0 → scrollTop 应为 3000
    expect(el.scrollTop).toBe(3000)
  })

  it('滚到顶部 emit reach-top', async () => {
    const { wrapper, el } = mountList(100)
    el.scrollTop = 0
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(wrapper.emitted('reach-top')).toBeTruthy()
  })

  it('整组 items 替换(切换会话)后窗口基于新数据计算', async () => {
    // 上一次虚拟化尝试的真实回归:切换到消息数恰好相同的会话时状态未刷新
    const { wrapper, el } = mountList(100)
    el.scrollTop = 5000
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    const newItems = Array.from({ length: 100 }, (_, i) => ({ messageId: `x${i}` }))
    await wrapper.setProps({ items: newItems })
    await (wrapper.vm as any).scrollToBottom()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    expect(el.scrollTop).toBe(el.scrollHeight)
    const rows = wrapper.findAll('.row')
    expect(rows.every((r) => r.text().startsWith('x'))).toBe(true)
  })
})
```

- [ ] **Step 2: 运行确认新增用例失败**

Run: `npm test -- src/renderer/src/components/chat/virtual/ChatVirtualList.test.ts`
Expected: 前 2 个新用例 FAIL(方法未定义),reach-top 用例 PASS(Task 2 已实现)

- [ ] **Step 3: 在 `<script setup>` 末尾(onBeforeUnmount 之后)追加实现**

```ts
// —— 聊天特有交互 API ————————————————————————
async function scrollToBottom(): Promise<void> {
  await nextTick()
  return new Promise((resolve) => {
    let tries = 0
    const pin = () => {
      const el = scroller.value
      if (!el) return resolve()
      el.scrollTop = el.scrollHeight
      onScroll()
      if (++tries < 10 && gapToBottom(el) > 1) requestAnimationFrame(pin)
      else resolve()
    }
    requestAnimationFrame(pin)
  })
}

function isAtBottom(): boolean {
  return atBottom.value
}

// 历史消息 prepend 保位:记录视口第一个项 → 数据更新后滚回同一视口偏移
let anchor: { key: string; delta: number } | null = null

function captureAnchor(): void {
  const el = scroller.value
  if (!el || keys.value.length === 0) {
    anchor = null
    return
  }
  const idx = findIndexAt(offsets.value, el.scrollTop)
  anchor = { key: keys.value[idx], delta: offsets.value[idx] - el.scrollTop }
}

async function restoreAnchor(): Promise<void> {
  await nextTick()
  const el = scroller.value
  if (!el || !anchor) return
  const idx = keys.value.indexOf(anchor.key)
  if (idx >= 0) {
    el.scrollTop = offsets.value[idx] - anchor.delta
    onScroll()
  }
  anchor = null
}

defineExpose({ scrollToBottom, captureAnchor, restoreAnchor, isAtBottom })
```

- [ ] **Step 4: 运行确认全部通过**

Run: `npm test -- src/renderer/src/components/chat/virtual/ChatVirtualList.test.ts`
Expected: PASS(6 个测试)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/chat/virtual/
git commit -m "feat: ChatVirtualList 贴底收敛、prepend 锚定保位、触顶事件

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 4: `MarkdownText` 展开状态跨挂载保持

虚拟化后滚出视口的消息组件会真正卸载,「展开全文」状态若只存组件内,滚回来会重新折叠。按 messageId 存模块级 Set。

**Files:**
- Modify: `src/renderer/src/components/chat/MarkdownText.vue`
- Test: `src/renderer/src/components/chat/MarkdownText.test.ts`(追加)

**Interfaces:**
- Produces: `MarkdownText` 新增可选 prop `messageId?: string`(Task 7 中 MessageBubble 传入 `message.messageId`)

- [ ] **Step 1: 追加失败测试**

```ts
// 追加到 MarkdownText.test.ts
describe('MarkdownText 展开状态跨挂载保持', () => {
  it('展开后卸载重挂(模拟滚出视口再回来)仍是展开态', async () => {
    const content = bigTable('PERSIST')
    const w1 = mount(MarkdownText, { props: { content, messageId: 'persist-1' } })
    await w1.find('.md-expand-btn').trigger('click')
    expect(w1.find('table').exists()).toBe(true)
    w1.unmount()
    const w2 = mount(MarkdownText, { props: { content, messageId: 'persist-1' } })
    expect(w2.find('table').exists()).toBe(true) // 不再折叠
    // 收起后重挂恢复折叠
    await w2.find('.md-expand-btn').trigger('click')
    w2.unmount()
    const w3 = mount(MarkdownText, { props: { content, messageId: 'persist-1' } })
    expect(w3.find('table').exists()).toBe(false)
  })

  it('未传 messageId 时行为不变(默认折叠)', () => {
    const w = mount(MarkdownText, { props: { content: bigTable('NOID') } })
    expect(w.find('table').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- src/renderer/src/components/chat/MarkdownText.test.ts`
Expected: 第一个新用例 FAIL(重挂后 table 不存在)

- [ ] **Step 3: 实现**

普通 `<script lang="ts">` 块追加(与 parseCache 同级,模块作用域):

```ts
// 「展开全文」状态按消息持久(虚拟列表卸载重挂时恢复)
const expandedIds = new Set<string>()
```

`<script setup>` 中修改 props 定义与 expanded 初始化:

```ts
const props = defineProps<{
  content: string
  streaming?: boolean
  messageId?: string
  emojis?: { file: string; code: string; reg: RegExp }[]
}>()
```

把现有的 `const expanded = ref(!!props.streaming)` 替换为:

```ts
// streaming 中挂载的消息(AI 流式回复)保持展开,结束后也不突然收起;
// 非 streaming 时从模块级 Set 恢复上次的展开状态
const expanded = ref(!!props.streaming || (props.messageId ? expandedIds.has(props.messageId) : false))
watch(expanded, (v) => {
  if (!props.messageId) return
  if (v) expandedIds.add(props.messageId)
  else expandedIds.delete(props.messageId)
})
```

(`watch` 需加入 vue import:`import { computed, ref, watch } from 'vue'`)

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- src/renderer/src/components/chat/MarkdownText.test.ts`
Expected: PASS(8 个测试)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/chat/MarkdownText.vue src/renderer/src/components/chat/MarkdownText.test.ts
git commit -m "feat: MarkdownText 展开状态按 messageId 持久,虚拟列表卸载重挂不丢失

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 5: MessageBubble 图片状态缓存 + 图片点击事件

虚拟化后组件卸载重挂:图片显示框(imgBox)与已升级的原图 URL 若丢失,滚回来会重新走「缩略图→原图」流程导致闪烁。仿照现有 `fileDownloadStates.ts` 的 `dlStateCache` 模式做模块级缓存。同时为 Task 6 的 ImageViewer 铺路:禁用 n-image 自带预览,点击改为向上抛事件。

**Files:**
- Create: `src/renderer/src/components/chat/imageStateCache.ts`
- Modify: `src/renderer/src/components/chat/MessageBubble.vue`
- Test: `src/renderer/src/components/chat/MessageBubble.test.ts`(追加)

**Interfaces:**
- Produces:
  - `imgStateCache: Map<string, { box: { w: number; h: number } | null; upgradedSrc: string }>`(按 messageId)
  - `MessageBubble` 新增 emit:`(e: 'image-click', message: ProtoMessage): void`(Task 7 监听)
  - `MessageBubble` 移除 emit `image-loaded`(虚拟列表 ResizeObserver 接管贴底,Task 7 同步移除监听)

- [ ] **Step 1: 追加失败测试**

```ts
// 追加到 MessageBubble.test.ts(顶部补 import { imgStateCache } from './imageStateCache')
describe('imgStateCache', () => {
  it('按 messageId 读写图片显示状态', () => {
    imgStateCache.set('msg-1', { box: { w: 120, h: 90 }, upgradedSrc: 'http://x/1.png' })
    expect(imgStateCache.get('msg-1')).toEqual({ box: { w: 120, h: 90 }, upgradedSrc: 'http://x/1.png' })
    expect(imgStateCache.get('msg-nonexistent')).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- src/renderer/src/components/chat/MessageBubble.test.ts`
Expected: FAIL(模块不存在)

- [ ] **Step 3: 创建缓存模块**

```ts
// src/renderer/src/components/chat/imageStateCache.ts
// 图片消息的显示状态缓存(模式同 fileDownloadStates.ts 的 dlStateCache):
// 虚拟列表把滚出视口的气泡真正卸载,重挂时从这里恢复已锁定的显示框和
// 已升级的原图 URL,避免重新走「缩略图→原图」流程造成闪烁
export interface ImgState {
  box: { w: number; h: number } | null
  upgradedSrc: string
}

export const imgStateCache = new Map<string, ImgState>()
```

- [ ] **Step 4: 修改 MessageBubble.vue**

(a) import 区追加:

```ts
import { imgStateCache } from './imageStateCache'
```

(b) emits 定义:删除 `(e: 'image-loaded'): void`,追加 image-click:

```ts
const emit = defineEmits<{
  (e: 'contextmenu', event: MouseEvent): void
  (e: 'avatar-click', userId: string, x: number, y: number): void
  (e: 'image-click', message: ProtoMessage): void
}>()
```

(c) 把现有的 `const hasBecomeVisible = ref(false)`、`const upgradedSrc = ref('')`、`const imgBox = ref<...>(null)` 三个声明与 `onThumbnailLoad` 函数替换为以下内容(**中间的 `imageImgProps` computed 保留不动**):

```ts
// 从缓存恢复(虚拟列表重挂场景);有缓存说明此前已进入过视口
const cachedImg = imgStateCache.get(props.message.messageId)
const hasBecomeVisible = ref(!!cachedImg)
const upgradedSrc = ref(cachedImg?.upgradedSrc ?? '')

// 首次(缩略图)加载后锁定显示框;原图稍后到达时框不再变化
const imgBox = ref<{ w: number; h: number } | null>(cachedImg?.box ?? null)

function persistImgState() {
  imgStateCache.set(props.message.messageId, { box: imgBox.value, upgradedSrc: upgradedSrc.value })
}

function onThumbnailLoad(e?: Event) {
  const img = e?.target as HTMLImageElement | undefined
  if (!imgBox.value && img?.naturalWidth) {
    imgBox.value = fitImageBox(img.naturalWidth, img.naturalHeight)
    persistImgState()
  }
  hasBecomeVisible.value = true
}
```

(d) 原图升级 watch 中,`img.onload` 回调里升级后持久化,替换为:

```ts
watch(
  [hasBecomeVisible, () => props.message.content.remoteMediaUrl],
  ([visible, url]) => {
    if (!visible || !thumbnailSrc.value || !url || upgradedSrc.value === url) return
    const img = new Image()
    img.onload = () => {
      upgradedSrc.value = url
      persistImgState()
    }
    img.src = url
  },
  { immediate: true }
)
```

(e) 模板中图片消息块替换(去掉 lazy——虚拟列表挂载即接近可见;禁用内置预览;点击抛事件):

```vue
          <div v-else-if="isImage" class="img-msg" @click.stop="emit('image-click', message)">
            <n-image
              :src="bubbleImageSrc"
              :img-props="imageImgProps"
              preview-disabled
              @load="onThumbnailLoad"
            />
          </div>
```

(f) 样式区追加:

```css
.img-msg { cursor: zoom-in; }
```

(g) 模板中 MarkdownText 传入 messageId(接通 Task 4 的展开状态持久化):

```vue
          <MarkdownText v-if="isText" :content="textContent" :streaming="!!(message as any).streaming" :message-id="message.messageId" :emojis="emojis" />
```

- [ ] **Step 5: 运行全量测试确认通过**

Run: `npm test`
Expected: PASS(此时 MessageBubble 的 emit('image-loaded') 调用已移除;若 MessageList 仍监听 `@image-loaded` 只是无事发生,不报错)

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/chat/imageStateCache.ts src/renderer/src/components/chat/MessageBubble.vue src/renderer/src/components/chat/MessageBubble.test.ts
git commit -m "feat: 图片状态按 messageId 缓存,重挂不闪烁;图片点击改为抛 image-click 事件

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 6: 自研 `ImageViewer` 图片预览

替代 `n-image-group`:数据源与 DOM 挂载解耦,虚拟化后仍可翻遍当前会话全部图片。

**Files:**
- Create: `src/renderer/src/components/chat/ImageViewer.vue`
- Test: `src/renderer/src/components/chat/ImageViewer.test.ts`

**Interfaces:**
- Produces(Task 7 使用):
  - Props: `images: { id: string; src: string }[]`、`startIndex: number`
  - Emits: `(e: 'close'): void`
  - 交互:左右按钮/方向键切换、ESC 或点遮罩关闭、滚轮缩放(0.2~5 倍)、双击复位

- [ ] **Step 1: 写失败测试**

```ts
// src/renderer/src/components/chat/ImageViewer.test.ts
import { describe, it, expect, afterEach } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import ImageViewer from './ImageViewer.vue'

const images = [
  { id: 'a', src: 'http://x/a.png' },
  { id: 'b', src: 'http://x/b.png' },
  { id: 'c', src: 'http://x/c.png' },
]

let wrapper: VueWrapper
afterEach(() => wrapper?.unmount())

// 组件用 Teleport 渲染到 body,断言走 document
function q(sel: string) {
  return document.body.querySelector(sel) as HTMLElement | null
}

describe('ImageViewer', () => {
  it('显示起始图片与计数', () => {
    wrapper = mount(ImageViewer, { props: { images, startIndex: 1 } })
    expect(q('.iv-img')?.getAttribute('src')).toBe('http://x/b.png')
    expect(q('.iv-counter')?.textContent).toContain('2 / 3')
  })

  it('点击右侧按钮切到下一张;末张时右按钮消失', async () => {
    wrapper = mount(ImageViewer, { props: { images, startIndex: 1 } })
    q('.iv-next')!.click()
    await wrapper.vm.$nextTick()
    expect(q('.iv-img')?.getAttribute('src')).toBe('http://x/c.png')
    expect(q('.iv-next')).toBeNull()
  })

  it('方向键切换,ESC emit close', async () => {
    wrapper = mount(ImageViewer, { props: { images, startIndex: 1 } })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    await wrapper.vm.$nextTick()
    expect(q('.iv-img')?.getAttribute('src')).toBe('http://x/a.png')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `npm test -- src/renderer/src/components/chat/ImageViewer.test.ts`
Expected: FAIL(组件不存在)

- [ ] **Step 3: 实现**

```vue
<!-- src/renderer/src/components/chat/ImageViewer.vue -->
<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps<{
  images: { id: string; src: string }[]
  startIndex: number
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const index = ref(Math.min(Math.max(props.startIndex, 0), props.images.length - 1))
const scale = ref(1)
const current = computed(() => props.images[index.value])

function prev() {
  if (index.value > 0) {
    index.value--
    scale.value = 1
  }
}
function next() {
  if (index.value < props.images.length - 1) {
    index.value++
    scale.value = 1
  }
}
function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
  else if (e.key === 'ArrowLeft') prev()
  else if (e.key === 'ArrowRight') next()
}
function onWheel(e: WheelEvent) {
  e.preventDefault()
  scale.value = Math.min(5, Math.max(0.2, scale.value * (e.deltaY < 0 ? 1.1 : 0.9)))
}

onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="iv-mask" @click.self="emit('close')" @wheel="onWheel">
      <img
        v-if="current"
        class="iv-img"
        :src="current.src"
        :style="{ transform: `scale(${scale})` }"
        @dblclick="scale = 1"
      />
      <button v-if="index > 0" class="iv-nav iv-prev" @click.stop="prev">‹</button>
      <button v-if="index < images.length - 1" class="iv-nav iv-next" @click.stop="next">›</button>
      <button class="iv-close" @click.stop="emit('close')">×</button>
      <div class="iv-counter">{{ index + 1 }} / {{ images.length }}</div>
    </div>
  </Teleport>
</template>

<style scoped>
.iv-mask {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.85);
  display: flex;
  align-items: center;
  justify-content: center;
}
.iv-img {
  max-width: 90vw;
  max-height: 85vh;
  border-radius: 4px;
  transition: transform 0.15s ease-out;
  user-select: none;
}
.iv-nav {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  width: 44px;
  height: 44px;
  border: none;
  border-radius: 50%;
  background: var(--bg-float);
  color: var(--text-primary);
  font-size: 24px;
  line-height: 1;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
}
.iv-nav:hover { background: var(--bg-elevated); }
.iv-prev { left: 24px; }
.iv-next { right: 24px; }
.iv-close {
  position: absolute;
  top: 16px;
  right: 20px;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: var(--bg-float);
  color: var(--text-primary);
  font-size: 20px;
  cursor: pointer;
}
.iv-close:hover { background: var(--bg-elevated); }
.iv-counter {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  font-family: var(--font-mono);
  font-size: 12px;
  color: rgba(255, 255, 255, 0.85);
  background: rgba(0, 0, 0, 0.4);
  padding: 4px 12px;
  border-radius: var(--radius-pill);
}
</style>
```

- [ ] **Step 4: 运行确认通过**

Run: `npm test -- src/renderer/src/components/chat/ImageViewer.test.ts`
Expected: PASS(3 个测试)

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/chat/ImageViewer.vue src/renderer/src/components/chat/ImageViewer.test.ts
git commit -m "feat: 自研 ImageViewer 图片预览,数据源与 DOM 挂载解耦

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 7: MessageList 接入虚拟列表

**Files:**
- Modify: `src/renderer/src/components/chat/MessageList.vue`

**Interfaces:**
- Consumes:
  - `ChatVirtualList`:props `items/key-field/estimate`、emits `reach-top/at-bottom-change`、方法 `scrollToBottom()/captureAnchor()/restoreAnchor()/isAtBottom()`、插槽 `{ item, index, prev }`
  - `ImageViewer`:props `images/startIndex`、emit `close`
  - `MessageBubble`:emit `image-click`(不再有 `image-loaded`)

- [ ] **Step 1: 修改 script 部分**

(a) import 调整:

```ts
import ChatVirtualList from './virtual/ChatVirtualList.vue'
import ImageViewer from './ImageViewer.vue'
```

(b) 删除 `listRef`、`isAtBottom`、`prevScrollHeight`、`autoScrolling`、`checkAtBottom`、`scrollToBottom`、`onScroll`、`onImageLoaded` 及 `watch(() => msgStore.currentMessages.length, ...)` 中的历史加载分支,替换为:

```ts
const vlRef = ref<InstanceType<typeof ChatVirtualList>>()
const isLoading = ref(false)
const isAtBottom = ref(true)
const unreadBadge = ref(0)

function scrollToBottom() {
  nextTick(() => vlRef.value?.scrollToBottom())
}

function onAtBottomChange(v: boolean) {
  isAtBottom.value = v
  if (v) {
    unreadBadge.value = 0
    convStore.atMeSet.delete(selectTarget.value)
  }
}

// 触顶加载历史:captureAnchor → 拉取 → restoreAnchor 保位
async function loadHistory() {
  if (isLoading.value) return
  const firstMsg = selectedChat.value.protoMessages[0] as any
  if (!firstMsg) return
  isLoading.value = true
  vlRef.value?.captureAnchor()
  const beforeUid = firstMsg.messageUid ?? '0'
  const type = isSingleConversation.value ? 0 : 1
  try {
    const conv = new Conversation(type, selectedChat.value.target, 0)
    const data = await webSocketClient.getRemoteMessages(conv, beforeUid, 20)
    if (data?.result) {
      const parsed = JSON.parse(data.result)
      if (parsed.count > 0) {
        for (const raw of parsed.messageResponseList) msgStore.addOldMessage(ProtoMessage.toProtoMessage(raw) as any)
        convStore.isLoadRemoteMessage = true
        await vlRef.value?.restoreAnchor()
      }
    }
  } catch { } finally { isLoading.value = false }
}

// 图片预览:数据源取 store 当前会话全部图片消息,与虚拟列表挂载解耦
const viewer = ref<{ list: { id: string; src: string }[]; index: number } | null>(null)

function openViewer(msg: any) {
  const list = (msgStore.currentMessages as any[])
    .filter((m) => m.content.type === 3)
    .map((m) => ({
      id: m.messageId as string,
      src: (m.content.remoteMediaUrl as string) ||
        (m.content.binaryContent ? `data:image/png;base64,${m.content.binaryContent}` : '')
    }))
    .filter((i) => i.src)
  const index = list.findIndex((i) => i.id === msg.messageId)
  if (list.length > 0) viewer.value = { list, index: Math.max(0, index) }
}
```

(c) 现有 watch 保留但简化(scrollToBottom 已换实现,签名不变,无需改动这几行本身):

```ts
watch(scrollBottomTrigger, () => scrollToBottom())
watch(streamingTokenCount, () => { if (isAtBottom.value) scrollToBottom() })
watch(selectTarget, () => { convStore.isLoadRemoteMessage = false; unreadBadge.value = 0; scrollToBottom(); uiStore.stopAudio() })
watch(incomingMsgTrigger, () => {
  if (isAtBottom.value) scrollToBottom()
  else unreadBadge.value++
})
// 首次从 0 变为有消息(刷新页面初始化)滚到底部;历史加载保位已由 loadHistory 的锚定接管
watch(() => msgStore.currentMessages.length, (newLen, oldLen) => {
  if (oldLen === 0 && newLen > 0) scrollToBottom()
})
```

- [ ] **Step 2: 修改模板**

把 `<!-- Messages -->` 区块(`<div class="messages-scroll" ref="listRef" @scroll="onScroll">` 到对应 `</div>`,含 `n-image-group`)整体替换为:

```vue
    <!-- Messages(虚拟列表:只挂载可视区 ± overscan 的消息) -->
    <div v-if="isLoading" class="loading-tip loading-float">
      <div class="loading-dot"></div>
      <div class="loading-dot" style="animation-delay:.15s"></div>
      <div class="loading-dot" style="animation-delay:.3s"></div>
    </div>
    <ChatVirtualList
      ref="vlRef"
      class="messages-scroll"
      :items="selectedChat.protoMessages"
      key-field="messageId"
      :estimate="80"
      @reach-top="loadHistory"
      @at-bottom-change="onAtBottomChange"
    >
      <template #default="{ item, prev }">
        <MessageBubble
          :message="item as any"
          :prev-message="prev as any"
          @contextmenu="(e: MouseEvent) => emit('context-menu', e, item)"
          @avatar-click="onAvatarClick"
          @image-click="openViewer"
        />
      </template>
    </ChatVirtualList>

    <ImageViewer
      v-if="viewer"
      :images="viewer.list"
      :start-index="viewer.index"
      @close="viewer = null"
    />
```

- [ ] **Step 3: 样式调整**

`.messages-scroll` 中删去 `overflow-y: auto;` 与 `overscroll-behavior: contain;`(已由 `.cvl` 提供,保留会重复但无害——为清晰起见删除),追加 loading 浮层定位:

```css
.loading-float {
  position: absolute;
  top: 60px;
  left: 0;
  right: 0;
  z-index: 10;
  pointer-events: none;
}
```

- [ ] **Step 4: 全量测试 + 手动冒烟**

Run: `npm test`
Expected: 全部 PASS

Run: `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20 && npm run dev`
手动确认:切换会话正常显示并贴底、上滚加载历史不跳动、点击图片打开 ImageViewer 可左右翻页、「展开全文」滚出视口再回来仍展开。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/chat/MessageList.vue
git commit -m "feat: MessageList 接入虚拟列表,历史加载锚定保位,图片预览改用 ImageViewer

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

### Task 8: CDP 端到端验证

**Files:**
- 无源码改动;探针脚本写在 scratchpad(参考 `.claude/skills/verify/SKILL.md` 配方与 scratchpad 已有 `drive-cdp.mjs` / `probe-convs.mjs` / `probe-imgsize.mjs`)

- [ ] **Step 1: 启动可驱动实例**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20
npx electron-vite dev -- --remote-debugging-port=9223   # 后台
# 就绪:curl -s --noproxy "*" http://127.0.0.1:9223/json/version
```

- [ ] **Step 2: 验证以下量化指标(每项 CDP 探针断言,选择器注意:滚动容器现为 `.messages-scroll.cvl`)**

| 指标 | 断言 |
|---|---|
| 切换到「系统通知」长任务 | PerformanceObserver longtask 总时长 ≤ 100ms |
| 渲染的消息 DOM 数 | 历史加载 200+ 条后,`.cvl [data-vl-key]` 数量 < 40(虚拟化生效) |
| 贴底 | 切换后 `scrollHeight - scrollTop - clientHeight ≤ 1` |
| 历史加载保位 | 滚顶触发加载后,加载前视口第一条消息的 `getBoundingClientRect().top` 变化 ≤ 2px |
| 图片预览翻页 | 点击任一图片 → `.iv-mask` 出现;连续 ArrowRight 可翻到会话内全部图片(计数器到 N/N),包括未挂载消息的图 |
| 快速滚动 | scrollTop 从底到顶分 20 步快速设置,每步渲染项非空(无白屏死区) |
| 展开状态 | 展开一条日报 → 滚离两屏再滚回 → 仍展开 |

- [ ] **Step 3: 对照回归**

遍历全部会话逐个切换:贴底 gap ≤ 1、图片缩略图渲染正常、无异常长任务(参考 probe-convs.mjs)。

- [ ] **Step 4: 停掉 dev 实例,清理探针**

```bash
pkill -f "electron-vite dev"; pkill -f "remote-debugging-port=9223"
```

任何指标不达标:回到对应 Task 修复后重跑本任务。

---

### Task 9: 版本号、更新日志、提交

**Files:**
- Modify: `package.json`(version → `1.4.0`)
- Modify: `package-lock.json`(`npm install --package-lock-only` 同步)
- Modify: `src/renderer/src/changelog.ts`(数组头部插入)

- [ ] **Step 1: 更新版本与日志**

changelog.ts 头部插入(日期用当天):

```ts
  {
    version: '1.4.0',
    date: 'YYYY-MM-DD',
    items: [
      '消息列表全面虚拟化:任何时刻只渲染可视区域附近的消息,长会话(数百条历史消息)滚动与切换性能不再随消息数增长下降',
      '历史消息加载改用锚定保位:上滚加载时可见内容纹丝不动',
      '图片预览重构为独立查看器:虚拟化后仍可左右翻看当前会话全部图片,支持方向键、滚轮缩放、双击复位',
      '「展开全文」、图片显示框等消息状态在滚出视口后保留,滚回来不重置不闪烁',
    ]
  },
```

- [ ] **Step 2: 全量测试**

Run: `npm test`
Expected: 全部 PASS

- [ ] **Step 3: Commit(不 push)**

```bash
git add package.json package-lock.json src/renderer/src/changelog.ts
git commit -m "chore: 版本号升级至 v1.4.0，补充更新日志

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>"
```

---

## 上一次虚拟化尝试的教训(2026-07-12,实现已被整体丢弃,孤儿提交 db194b8..d63beff)

1. **margin 塌陷测量偏小**:包裹层不建 BFC 时,time-divider 等子元素的外边距塌陷穿透,`offsetHeight` 量不到,累计滚动漂移 → 本方案 `.cvl-item { display: flow-root }` 从一开始就规避
2. **两条互不协调的滚动补偿路径**(命令式 scrollTop 恢复 vs RO 驱动补偿)导致历史加载锚定漂移 → 本方案只有一条数据源(offsets)+ 一处补偿(onResizeEntries),restoreAnchor 只做初始定位,后续修正统一走 RO 补偿
3. **切会话消息数恰好相同时状态未刷新**(只 watch 了 length)→ 本方案 offsets/range 全部由 `props.items` 的 computed 派生,无手动 refresh;Task 3 有对应回归测试
4. 该次尝试的交互式 QA 由用户手动执行发现问题 → 本方案 Task 8 用 CDP 探针把贴底/保位/翻页全部自动化量化

## 风险与回退

- **风险点 1 — RO 补偿与贴底竞争**:图片集中加载时多次高度修正,若观察到贴底抖动,把 `onResizeEntries` 里的钉底改为 `scrollToBottom()`(逐帧收敛版)。
- **风险点 2 — jsdom 测不到真实布局**:组件测试只覆盖窗口切片与 API 计算,布局正确性完全依赖 Task 8 的 CDP 验证,不可跳过。
- **风险点 3 — content-visibility 与虚拟列表叠加**:MessageBubble 上保留的 `content-visibility: auto` 与虚拟化不冲突(overscan 区内未进视口的行仍然跳过渲染),保留作为双保险;若出现测量高度为 0 的异常,优先排查该属性与 `offsetHeight` 的交互,必要时移除该 CSS(虚拟化已覆盖其收益)。
- **回退**:每个任务独立提交,`git revert` 对应提交即可整体回退;Task 7 之前的任务(1~6)不影响现有行为,可安全先行合入。
