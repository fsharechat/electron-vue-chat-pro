<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'

const props = withDefaults(defineProps<{ show?: boolean }>(), { show: false })
const emit = defineEmits<{ cancel: []; done: [] }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
const isDrawing = ref(false)
const startX = ref(0)
const startY = ref(0)
const endX = ref(0)
const endY = ref(0)
// hasCrop tracks whether the user has finished a drag selection
const hasCrop = ref(false)

// alive flag: prevents stale img.onload callbacks from firing after unmount
let alive = true

function onWindowKeydown(e: KeyboardEvent) {
  if (props.show && e.key === 'Escape') emit('cancel')
}

function onMousedown(e: MouseEvent) {
  isDrawing.value = true
  hasCrop.value = false
  startX.value = e.clientX
  startY.value = e.clientY
  endX.value = e.clientX
  endY.value = e.clientY
  draw()
}

function onMousemove(e: MouseEvent) {
  if (!isDrawing.value) return
  endX.value = e.clientX
  endY.value = e.clientY
  draw()
}

function onMouseup(e: MouseEvent) {
  if (!isDrawing.value) return
  isDrawing.value = false
  endX.value = e.clientX
  endY.value = e.clientY
  hasCrop.value = true
  draw()
}

function draw() {
  const canvas = canvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  ctx.clearRect(0, 0, canvas.width, canvas.height)
  ctx.fillStyle = 'rgba(0,0,0,0.4)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  const x = Math.min(startX.value, endX.value)
  const y = Math.min(startY.value, endY.value)
  const w = Math.abs(endX.value - startX.value)
  const h = Math.abs(endY.value - startY.value)
  if (w > 0 && h > 0) {
    ctx.clearRect(x, y, w, h)
    ctx.strokeStyle = '#1890ff'
    ctx.lineWidth = 2
    ctx.strokeRect(x, y, w, h)
  }
}

function resizeCanvas() {
  const canvas = canvasRef.value
  if (!canvas) return
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  draw()
}

async function confirm() {
  const x = Math.min(startX.value, endX.value)
  const y = Math.min(startY.value, endY.value)
  const w = Math.abs(endX.value - startX.value)
  const h = Math.abs(endY.value - startY.value)

  // Guard: no crop region selected
  if (!hasCrop.value || w === 0 || h === 0) {
    emit('done')
    return
  }

  const sources = await window.electronAPI?.getScreenSources?.() ?? []
  const src = sources[0]
  if (!src) {
    emit('done')
    return
  }

  const img = new Image()
  img.onload = () => {
    // Don't emit or write if component was unmounted before load finished
    if (!alive) return
    const offscreen = document.createElement('canvas')
    const dpr = window.devicePixelRatio || 1
    offscreen.width = w * dpr
    offscreen.height = h * dpr
    const ctx = offscreen.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img, x * dpr, y * dpr, w * dpr, h * dpr, 0, 0, w * dpr, h * dpr)
    window.electronAPI?.writeImageToClipboard(offscreen.toDataURL('image/png'))
    emit('done')
  }
  img.src = src.thumbnail
}

function cancel() { emit('cancel') }

watch(() => props.show, (v) => {
  if (v) {
    hasCrop.value = false
    // nextTick ensures the canvas element is in the DOM before resizing
    nextTick(resizeCanvas)
  }
})

onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown)
  window.addEventListener('resize', resizeCanvas)
})
onUnmounted(() => {
  alive = false
  window.removeEventListener('keydown', onWindowKeydown)
  window.removeEventListener('resize', resizeCanvas)
})
</script>

<template>
  <div
    v-if="show"
    class="screenshot-overlay"
    @mousedown="onMousedown"
    @mousemove="onMousemove"
    @mouseup="onMouseup"
  >
    <canvas ref="canvasRef" class="screenshot-canvas" />
    <div class="screenshot-toolbar">
      <button data-action="confirm" class="ss-btn ss-btn--confirm" title="截图确认" @click.stop="confirm">✓ 确认</button>
      <button data-action="cancel" class="ss-btn ss-btn--cancel" title="取消截图" @click.stop="cancel">✗ 取消</button>
    </div>
  </div>
</template>

<style scoped>
.screenshot-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  cursor: crosshair;
  outline: none;
}

.screenshot-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.screenshot-toolbar {
  position: absolute;
  bottom: 32px;
  right: 32px;
  display: flex;
  gap: 8px;
  z-index: 10000;
}

.ss-btn {
  padding: 6px 16px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
}

.ss-btn--confirm {
  background: #1890ff;
  color: #fff;
}

.ss-btn--confirm:hover { background: #40a9ff; }

.ss-btn--cancel {
  background: rgba(255,255,255,0.15);
  color: #fff;
}

.ss-btn--cancel:hover { background: rgba(255,255,255,0.25); }
</style>
