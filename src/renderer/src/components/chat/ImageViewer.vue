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
