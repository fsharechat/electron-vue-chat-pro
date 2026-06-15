<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useUIStore } from '@/stores/useUIStore'
import webSocketClient from '@/websocket/websocketcli'

const props = defineProps<{ userId: string; x: number; y: number }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const uiStore = useUIStore()
const userInfo = computed(() => uiStore.userInfoList.find((u: any) => u.uid === props.userId))

const imgFailed = ref(false)
watch(() => userInfo.value?.portrait, () => { imgFailed.value = false })

const showFallback = computed(() => imgFailed.value || !userInfo.value?.portrait)

function colorFromStr(s: string) {
  const colors = [
    ['#6366f1', '#818cf8'],
    ['#8b5cf6', '#a78bfa'],
    ['#ec4899', '#f472b6'],
    ['#14b8a6', '#2dd4bf'],
    ['#f59e0b', '#fbbf24'],
    ['#10b981', '#34d399'],
    ['#3b82f6', '#60a5fa'],
    ['#f97316', '#fb923c'],
  ]
  let hash = 0
  for (let i = 0; i < s.length; i++) hash = (hash * 31 + s.charCodeAt(i)) | 0
  return colors[Math.abs(hash) % colors.length]
}

const bannerColors = computed(() => colorFromStr(userInfo.value?.displayName || props.userId))

const bannerLabel = computed(() => {
  const n = userInfo.value?.displayName || props.userId
  const cjk = n.match(/[一-龥]/)
  if (cjk) return cjk[0]
  return n[0]?.toUpperCase() ?? '?'
})

const cardW = 256
const cardH = 340

const style = computed(() => {
  let left = props.x + 14
  let top = props.y - 50
  if (left + cardW > window.innerWidth - 10) left = props.x - cardW - 14
  if (top + cardH > window.innerHeight - 10) top = window.innerHeight - cardH - 10
  if (top < 10) top = 10
  return { left: `${left}px`, top: `${top}px` }
})

function onClickOutside(e: MouseEvent) {
  const card = document.getElementById('user-profile-card')
  if (card && !card.contains(e.target as Node)) emit('close')
}

onMounted(() => {
  webSocketClient.getUserInfos([props.userId])
  setTimeout(() => document.addEventListener('click', onClickOutside), 0)
})
onUnmounted(() => document.removeEventListener('click', onClickOutside))
</script>

<template>
  <div class="profile-card" id="user-profile-card" :style="style">
    <div
      class="card-hd"
      :style="showFallback ? { background: `linear-gradient(135deg, ${bannerColors[0]}, ${bannerColors[1]})` } : {}"
    >
      <img
        v-if="!showFallback"
        :src="userInfo!.portrait"
        class="banner-img"
        @error="imgFailed = true"
      />
      <span v-else-if="userInfo" class="banner-label">{{ bannerLabel }}</span>
      <span v-else class="spinner"></span>
    </div>
    <div class="card-bd">
      <p class="nickname">{{ userInfo?.displayName || userId }}</p>
      <div class="meta-area">
        <div class="meta-item">
          <span class="label">飞享号：</span>
          <span class="value">{{ userId }}</span>
        </div>
        <div v-if="userInfo?.mobile" class="meta-item">
          <span class="label">手机号：</span>
          <span class="value">{{ userInfo.mobile }}</span>
        </div>
        <div v-if="userInfo?.email" class="meta-item">
          <span class="label">邮　箱：</span>
          <span class="value">{{ userInfo.email }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.profile-card {
  position: fixed;
  z-index: 300;
  width: 256px;
  background: var(--bg-secondary);
  border-radius: 6px;
  overflow: hidden;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.25);
  border: 1px solid var(--border);
}

.card-hd {
  position: relative;
}

.card-hd {
  width: 256px;
  height: 200px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-top-left-radius: 6px;
  border-top-right-radius: 6px;
  overflow: hidden;
  background: var(--bg-elevated);
}

.banner-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center top;
}

.banner-label {
  color: rgba(255, 255, 255, 0.92);
  font-family: var(--font-display);
  font-weight: 700;
  font-size: 72px;
  line-height: 1;
  letter-spacing: -2px;
  user-select: none;
}

.spinner {
  width: 28px;
  height: 28px;
  border: 3px solid rgba(255, 255, 255, 0.3);
  border-top-color: #fff;
  border-radius: 50%;
  animation: spin 0.7s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.card-bd {
  padding: 14px 18px 16px;
}

.nickname {
  font-size: 18px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  margin-bottom: 8px;
  line-height: 1.5;
}

.meta-area {
  line-height: 1.9;
}

.meta-item {
  display: flex;
  align-items: baseline;
  overflow: hidden;
}

.label {
  font-size: 12px;
  color: var(--text-muted);
  white-space: nowrap;
  flex-shrink: 0;
}

.value {
  font-size: 12px;
  color: var(--text-muted);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
