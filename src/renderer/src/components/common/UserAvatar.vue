<script setup lang="ts">
import { ref, computed, watch } from 'vue'

const props = defineProps<{
  src?: string
  name?: string
  size?: number
  radius?: string
  isGroup?: boolean
}>()

const failed = ref(false)
const sz = computed(() => props.size ?? 42)

// Reset failed state when src changes
watch(() => props.src, () => { failed.value = false })

const showFallback = computed(() => failed.value || !props.src)

// Generate consistent color from name/id string
function colorFromStr(s: string) {
  const colors = [
    ['#6366f1', '#818cf8'], // indigo
    ['#8b5cf6', '#a78bfa'], // violet
    ['#ec4899', '#f472b6'], // pink
    ['#14b8a6', '#2dd4bf'], // teal
    ['#f59e0b', '#fbbf24'], // amber
    ['#10b981', '#34d399'], // emerald
    ['#3b82f6', '#60a5fa'], // blue
    ['#f97316', '#fb923c'], // orange
  ]
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0
  return colors[Math.abs(hash) % colors.length]
}

const label = computed(() => {
  const n = props.name ?? ''
  if (!n) return props.isGroup ? '#' : '?'
  // Try to get first CJK char or first latin char
  const cjk = n.match(/[一-龥]/)
  if (cjk) return cjk[0]
  return n[0].toUpperCase()
})

const [from, to] = computed(() => colorFromStr(props.name ?? props.src ?? 'x')).value
</script>

<template>
  <!-- Image loads fine -->
  <img
    v-if="!showFallback"
    :src="src"
    class="avatar-img"
    :style="{ width: sz + 'px', height: sz + 'px', borderRadius: radius ?? 'var(--radius-md)' }"
    @error="failed = true"
  />
  <!-- Fallback: gradient + initial -->
  <div
    v-else
    class="avatar-fallback"
    :style="{
      width: sz + 'px',
      height: sz + 'px',
      borderRadius: radius ?? 'var(--radius-md)',
      background: `linear-gradient(135deg, ${from}, ${to})`,
      fontSize: Math.max(10, Math.floor(sz * 0.42)) + 'px',
    }"
  >
    <svg v-if="isGroup && !name" width="40%" height="40%" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color:rgba(255,255,255,0.9)">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
    <span v-else class="avatar-label">{{ label }}</span>
  </div>
</template>

<style scoped>
.avatar-img {
  object-fit: cover;
  display: block;
  flex-shrink: 0;
  border: 1px solid var(--border);
}
.avatar-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid rgba(255,255,255,0.08);
  user-select: none;
}
.avatar-label {
  color: rgba(255, 255, 255, 0.95);
  font-family: var(--font-display);
  font-weight: 700;
  line-height: 1;
  letter-spacing: -0.5px;
}
</style>
