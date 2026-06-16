<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import AnnotationToolbar, { type AnnotationTool } from './AnnotationToolbar.vue'
import { drawRect, drawArrow, applyMosaic } from './annotationTools'

const props = withDefaults(
  defineProps<{ show?: boolean; screenshotSrc?: string }>(),
  { show: false, screenshotSrc: '' }
)
const emit = defineEmits<{ cancel: []; done: [dataUrl: string] }>()

// ── Canvas refs ──────────────────────────────────────────────────
const bgCanvasRef = ref<HTMLCanvasElement | null>(null)
const annotationCanvasRef = ref<HTMLCanvasElement | null>(null)
const textInputRef = ref<HTMLInputElement | null>(null)

// ── Phase & background ──────────────────────────────────────────
type Phase = 'cropping' | 'annotating'
const phase = ref<Phase>('cropping')
let bgImage: HTMLImageElement | null = null
let alive = true

// ── Phase 1: crop selection ──────────────────────────────────────
const isDrawing = ref(false)
const startX = ref(0), startY = ref(0), endX = ref(0), endY = ref(0)

// ── Phase 2: annotation ──────────────────────────────────────────
const activeTool = ref<AnnotationTool | null>('rect')
const activeColor = ref('#f5222d')
const MAX_UNDO = 20
const undoStack: ImageData[] = []
let toolDrawing = false
let toolStartX = 0, toolStartY = 0
let previewSnapshot: ImageData | null = null

// ── Text tool ────────────────────────────────────────────────────
const isTextEditing = ref(false)
const textPos = ref({ x: 0, y: 0 })
const textValue = ref('')

// ── Drawing: background canvas ───────────────────────────────────
function drawBg(): void {
  const canvas = bgCanvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (bgImage) ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height)

  ctx.fillStyle = 'rgba(0,0,0,0.4)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const x = Math.min(startX.value, endX.value)
  const y = Math.min(startY.value, endY.value)
  const w = Math.abs(endX.value - startX.value)
  const h = Math.abs(endY.value - startY.value)

  if (w > 0 && h > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip()
    ctx.clearRect(x, y, w, h)
    if (bgImage) ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height)
    ctx.restore()
    ctx.strokeStyle = '#1890ff'
    ctx.lineWidth = 2
    ctx.strokeRect(x, y, w, h)
  }
}

function resizeCanvases(): void {
  const bg = bgCanvasRef.value
  const ann = annotationCanvasRef.value
  if (bg) { bg.width = window.innerWidth; bg.height = window.innerHeight }
  if (ann) { ann.width = window.innerWidth; ann.height = window.innerHeight }
  drawBg()
  undoStack.length = 0
  previewSnapshot = null
}

// ── Phase 1: mouse handlers ───────────────────────────────────────
function onCropMousedown(e: MouseEvent): void {
  isDrawing.value = true
  startX.value = e.clientX; startY.value = e.clientY
  endX.value = e.clientX; endY.value = e.clientY
  drawBg()
}

function onCropMousemove(e: MouseEvent): void {
  if (!isDrawing.value) return
  endX.value = e.clientX; endY.value = e.clientY
  drawBg()
}

function onCropMouseup(e: MouseEvent): void {
  if (!isDrawing.value) return
  isDrawing.value = false
  endX.value = e.clientX; endY.value = e.clientY
  drawBg()
  const w = Math.abs(endX.value - startX.value)
  const h = Math.abs(endY.value - startY.value)
  if (w > 4 && h > 4) {
    phase.value = 'annotating'
    clearAnnotation()
  }
}

// ── Phase 2: annotation helpers ───────────────────────────────────
function getAnnCtx(): CanvasRenderingContext2D | null {
  return annotationCanvasRef.value?.getContext('2d') ?? null
}

function clearAnnotation(): void {
  const ann = annotationCanvasRef.value
  if (!ann) return
  getAnnCtx()?.clearRect(0, 0, ann.width, ann.height)
  undoStack.length = 0
}

function saveUndoSnapshot(): void {
  const ann = annotationCanvasRef.value
  const ctx = getAnnCtx()
  if (!ann || !ctx) return
  previewSnapshot = ctx.getImageData(0, 0, ann.width, ann.height)
}

function pushUndo(): void {
  if (!previewSnapshot) return
  if (undoStack.length >= MAX_UNDO) undoStack.shift()
  undoStack.push(previewSnapshot)
}

function handleUndo(): void {
  const ctx = getAnnCtx()
  const ann = annotationCanvasRef.value
  if (!ctx || !ann || undoStack.length === 0) return
  const snap = undoStack.pop()!
  ctx.putImageData(snap, 0, 0)
  previewSnapshot = null
}

// ── Phase 2: mouse handlers ────────────────────────────────────────
function onAnnMousedown(e: MouseEvent): void {
  if (activeTool.value === 'text') return
  toolDrawing = true
  toolStartX = e.clientX; toolStartY = e.clientY
  saveUndoSnapshot()
}

function onAnnMousemove(e: MouseEvent): void {
  if (!toolDrawing) return
  const ctx = getAnnCtx()
  const ann = annotationCanvasRef.value
  if (!ctx || !ann || !previewSnapshot) return
  ctx.putImageData(previewSnapshot, 0, 0)
  const tool = activeTool.value
  if (tool === 'rect') {
    drawRect(ctx, toolStartX, toolStartY, e.clientX, e.clientY, activeColor.value)
  } else if (tool === 'arrow') {
    drawArrow(ctx, toolStartX, toolStartY, e.clientX, e.clientY, activeColor.value)
  } else if (tool === 'mosaic' && bgImage) {
    const x = Math.min(toolStartX, e.clientX)
    const y = Math.min(toolStartY, e.clientY)
    const w = Math.abs(e.clientX - toolStartX)
    const h = Math.abs(e.clientY - toolStartY)
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x, y, w, h); ctx.restore()
  }
}

function onAnnMouseup(e: MouseEvent): void {
  if (!toolDrawing) return
  toolDrawing = false
  const ctx = getAnnCtx()
  const ann = annotationCanvasRef.value
  if (!ctx || !ann) return
  if (previewSnapshot) ctx.putImageData(previewSnapshot, 0, 0)
  const tool = activeTool.value
  if (tool === 'rect') {
    pushUndo()
    drawRect(ctx, toolStartX, toolStartY, e.clientX, e.clientY, activeColor.value)
  } else if (tool === 'arrow') {
    pushUndo()
    drawArrow(ctx, toolStartX, toolStartY, e.clientX, e.clientY, activeColor.value)
  } else if (tool === 'mosaic' && bgImage) {
    pushUndo()
    const x = Math.min(toolStartX, e.clientX)
    const y = Math.min(toolStartY, e.clientY)
    const w = Math.abs(e.clientX - toolStartX)
    const h = Math.abs(e.clientY - toolStartY)
    applyMosaic(ctx, bgImage, x, y, w, h, ann.width, ann.height)
  }
  previewSnapshot = null
}

function onOverlayClick(e: MouseEvent): void {
  if (phase.value !== 'annotating' || activeTool.value !== 'text') return
  textPos.value = { x: e.clientX, y: e.clientY }
  textValue.value = ''
  isTextEditing.value = true
  nextTick(() => textInputRef.value?.focus())
}

function commitText(): void {
  if (!textValue.value.trim()) { isTextEditing.value = false; return }
  const ctx = getAnnCtx()
  if (!ctx) { isTextEditing.value = false; return }
  saveUndoSnapshot()
  pushUndo()
  ctx.save()
  ctx.font = '18px sans-serif'
  ctx.fillStyle = activeColor.value
  ctx.fillText(textValue.value, textPos.value.x, textPos.value.y + 18)
  ctx.restore()
  isTextEditing.value = false
  textValue.value = ''
}

// ── Composite output ─────────────────────────────────────────────
function getComposited(): string {
  const bg = bgCanvasRef.value
  const ann = annotationCanvasRef.value
  if (!bg) return ''
  const x = Math.min(startX.value, endX.value)
  const y = Math.min(startY.value, endY.value)
  const w = Math.abs(endX.value - startX.value)
  const h = Math.abs(endY.value - startY.value)
  if (w === 0 || h === 0) return ''

  const dpr = window.devicePixelRatio || 1
  const out = document.createElement('canvas')
  out.width = w * dpr
  out.height = h * dpr
  const ctx = out.getContext('2d')!

  if (bgImage) {
    const sx = bgImage.naturalWidth / bg.width
    const sy = bgImage.naturalHeight / bg.height
    ctx.drawImage(bgImage, x * sx, y * sy, w * sx, h * sy, 0, 0, out.width, out.height)
  }
  if (ann) ctx.drawImage(ann, x, y, w, h, 0, 0, out.width, out.height)

  return out.toDataURL('image/png')
}

// ── Toolbar actions ───────────────────────────────────────────────
function handleConfirm(): void {
  const dataUrl = getComposited()
  if (dataUrl) window.electronAPI?.writeImageToClipboard(dataUrl)
  emit('done', dataUrl)
}

function handleSave(): void {
  const dataUrl = getComposited()
  if (!dataUrl) return
  const [header, b64] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/png'
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const blob = new Blob([bytes], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `screenshot-${Date.now()}.png`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function handleCancel(): void {
  phase.value = 'cropping'
  clearAnnotation()
  drawBg()
}

// ── Keyboard ──────────────────────────────────────────────────────
function onWindowKeydown(e: KeyboardEvent): void {
  if (!props.show) return
  if (e.key === 'Escape') {
    if (isTextEditing.value) { textValue.value = ''; isTextEditing.value = false; return }
    if (phase.value === 'annotating') { handleCancel(); return }
    emit('cancel')
  }
}

// ── Watchers ──────────────────────────────────────────────────────
watch(() => props.show, (v) => {
  if (v) {
    phase.value = 'cropping'
    isDrawing.value = false
    clearAnnotation()
    nextTick(resizeCanvases)
  } else {
    bgImage = null
    phase.value = 'cropping'
  }
})

watch(() => props.screenshotSrc, (src) => {
  if (!src) { bgImage = null; return }
  const img = new Image()
  img.onload = () => { if (!alive) return; bgImage = img; drawBg() }
  img.src = src
}, { immediate: true })

// ── Lifecycle ─────────────────────────────────────────────────────
onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown)
  window.addEventListener('resize', resizeCanvases)
})
onUnmounted(() => {
  alive = false
  window.removeEventListener('keydown', onWindowKeydown)
  window.removeEventListener('resize', resizeCanvases)
})

// ── Mouse event router ────────────────────────────────────────────
function onMousedown(e: MouseEvent): void {
  if (phase.value === 'cropping') onCropMousedown(e)
  else onAnnMousedown(e)
}
function onMousemove(e: MouseEvent): void {
  if (phase.value === 'cropping') onCropMousemove(e)
  else onAnnMousemove(e)
}
function onMouseup(e: MouseEvent): void {
  if (phase.value === 'cropping') onCropMouseup(e)
  else onAnnMouseup(e)
}
</script>

<template>
  <div
    v-if="show"
    class="screenshot-overlay"
    @mousedown.prevent="onMousedown"
    @mousemove="onMousemove"
    @mouseup="onMouseup"
    @click="onOverlayClick"
  >
    <canvas ref="bgCanvasRef" class="ss-canvas" />
    <canvas ref="annotationCanvasRef" class="ss-canvas" />

    <input
      v-if="isTextEditing"
      ref="textInputRef"
      v-model="textValue"
      class="text-tool-input"
      :style="{ left: textPos.x + 'px', top: textPos.y + 'px', color: activeColor }"
      @blur="commitText"
      @keydown.enter.prevent="commitText"
      @click.stop
    />

    <AnnotationToolbar
      v-if="phase === 'annotating'"
      :active-tool="activeTool"
      :active-color="activeColor"
      :can-undo="undoStack.length > 0"
      @select-tool="t => activeTool = t"
      @select-color="c => activeColor = c"
      @undo="handleUndo"
      @save="handleSave"
      @cancel="handleCancel"
      @confirm="handleConfirm"
    />
  </div>
</template>

<style scoped>
.screenshot-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  cursor: crosshair;
}

.ss-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.text-tool-input {
  position: absolute;
  background: transparent;
  border: 1px dashed rgba(255,255,255,0.6);
  font-size: 18px;
  font-family: sans-serif;
  min-width: 80px;
  outline: none;
  padding: 2px 4px;
  z-index: 10001;
  caret-color: currentColor;
}
</style>
