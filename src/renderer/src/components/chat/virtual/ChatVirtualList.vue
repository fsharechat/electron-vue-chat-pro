<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { buildOffsets, visibleRange, findIndexAt } from './virtualCore'

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
  (e: 'user-scroll'): void
}>()

const scroller = ref<HTMLElement>()
const scrollTop = ref(0)
const viewportH = ref(0)

// 测量高度缓存(messageId 全局唯一,跨会话共用;非响应式 Map + version 触发重算)
const heights = new Map<string, number>()
const heightsVersion = ref(0)

// 活动锚点:restoreAnchor 后的短时间窗内,每次高度重测都按“当前 offsets”绝对复位,
// 而非依赖增量补偿——估算高度的系统性误差不会累积(上次虚拟化尝试的致命坑)。
// expires 是滑动过期:长内容(表格/图片)的重测常常迟到,固定 1s 窗口过期后这些迟到
// 重测会落到增量 compensate 路径,产生残余小漂移(e2e 复测 2~6px)。因此每次成功
// 绝对复位都把窗口顺延 500ms——只要测量还在持续到达,锚点就一直持有;测量静默
// 500ms 或到 deadline(创建起 3s 硬上限)才交还常规 atBottom/compensate 路径
let activeAnchor: { key: string; delta: number; expires: number; deadline: number } | null = null

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
  // 短会话内容不足一屏时 scrollTop 恒为 0(且 scrollToBottom 的钉底循环会手动调用 onScroll),
  // 必须叠加"内容确实超出视口"的判断,否则每次切换会话/收到消息/流式输出都会误触发 reach-top
  if (el.scrollTop < 10 && el.scrollHeight > el.clientHeight) emit('reach-top')
}

function onWheel() {
  emit('user-scroll')
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
  if (activeAnchor && activeAnchor.expires > performance.now() && keys.value.includes(activeAnchor.key)) {
    // 锚点激活窗口内:不走 atBottom/compensate 增量修正,统一按重算后的绝对 offsets 复位,
    // 避免估算高度的系统性误差在多次 RO 回调中累积漂移。
    // 滑动过期:本次重测落在窗口内,说明测量仍在持续,顺延 500ms(不超过 deadline 硬上限),
    // 让迟到的长内容重测继续走绝对复位,而不是过期后落入增量路径产生残余漂移
    activeAnchor.expires = Math.min(performance.now() + 500, activeAnchor.deadline)
    const pinnedAnchor = activeAnchor
    nextTick(() => {
      const cur = scroller.value
      if (!cur || activeAnchor !== pinnedAnchor) return
      const idx = keys.value.indexOf(pinnedAnchor.key)
      if (idx >= 0) {
        cur.scrollTop = offsets.value[idx] - pinnedAnchor.delta
        scrollTop.value = cur.scrollTop
      }
    })
    return
  }
  if (activeAnchor) activeAnchor = null
  if (atBottom.value) {
    // 贴底状态下高度修正后重新钉底
    nextTick(() => {
      const cur = scroller.value
      if (cur) {
        cur.scrollTop = cur.scrollHeight
        // jsdom 等环境不会为程序性写入触发 scroll 事件,手动同步响应式状态,避免 scrollTop 与 DOM 脱节
        scrollTop.value = cur.scrollTop
      }
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

// 每个 key 复用同一个 ref 回调,避免 Vue 因闭包身份变化在每次 patch 时对未变化的 DOM 节点全量 unobserve/observe
const refFns = new Map<string, (el: unknown) => void>()
function itemRef(key: string) {
  let fn = refFns.get(key)
  if (!fn) {
    fn = (el: unknown) => observeItem(el, key)
    refFns.set(key, fn)
  }
  return fn
}

// items 变化后,不再出现的 key 对应的 ref 回调也一并清理(heights 跨会话缓存需保留,故不在此处理)
watch(keys, (newKeys) => {
  const keySet = new Set(newKeys)
  for (const k of refFns.keys()) {
    if (!keySet.has(k)) refFns.delete(k)
  }
})

onMounted(() => {
  ro = new ResizeObserver(onResizeEntries)
  if (scroller.value) viewportH.value = scroller.value.clientHeight
})
onBeforeUnmount(() => {
  ro?.disconnect()
  itemEls.clear()
  refFns.clear()
})

// —— 聊天特有交互 API ————————————————————————
async function scrollToBottom(): Promise<void> {
  activeAnchor = null // 显式导航到底部时,不与锚点复位逻辑互相争抢 scrollTop
  await nextTick()
  await new Promise<void>((resolve) => {
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
  // 长内容(表格/图片)的高度修正晚于 10 帧收敛窗口,补几次延迟钉底;
  // atBottom 守卫保证用户已上滚时绝不拉回
  for (const delay of [150, 400, 1000]) {
    setTimeout(() => {
      const cur = scroller.value
      if (cur && atBottom.value && gapToBottom(cur) > 1) {
        cur.scrollTop = cur.scrollHeight
        scrollTop.value = cur.scrollTop
      }
    }, delay)
  }
}

function isAtBottom(): boolean {
  return atBottom.value
}

// 历史消息 prepend 保位:记录视口第一个项 → 数据更新后滚回同一视口偏移
let anchor: { key: string; delta: number } | null = null

function captureAnchor(): void {
  activeAnchor = null // 新的锚点捕获会覆盖之前的活动窗口,避免两者互相干扰
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
    // 未测量的新 prepend 项此刻仍按 estimate 参与 offsets 计算,真实高度会在后续
    // ResizeObserver 回调中逐步测出;开启活动窗口(初始 1s、每次复位滑动顺延、3s 硬上限),
    // 期间每次重测都绝对复位,而非依赖增量补偿(避免估算误差系统性累积导致的可视区大幅漂移)
    activeAnchor = {
      key: anchor.key,
      delta: anchor.delta,
      expires: performance.now() + 1000,
      deadline: performance.now() + 3000
    }
  }
  anchor = null
}

defineExpose({ scrollToBottom, captureAnchor, restoreAnchor, isAtBottom })
</script>

<template>
  <div ref="scroller" class="cvl" @scroll="onScroll" @wheel="onWheel">
    <div class="cvl-total" :style="{ height: total + 'px' }">
      <div
        class="cvl-window"
        :style="{ transform: `translateY(${range.top}px)` }"
      >
        <div
          v-for="(item, i) in rendered"
          :key="keys[range.start + i]"
          class="cvl-item"
          :data-vl-key="keys[range.start + i]"
          :ref="itemRef(keys[range.start + i])"
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
  /* 关键:关闭 Chromium 原生 scroll anchoring——它会和本组件的手动锚定/补偿
     互相争抢 scrollTop(e2e 实测:图片密集历史区漂移 13~420px,关闭后全部
     收敛到 ~5px 内)。修正权必须只有一个来源 */
  overflow-anchor: none;
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
