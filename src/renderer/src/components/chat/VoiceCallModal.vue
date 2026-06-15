<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useCallStore } from '@/stores/useCallStore'
import { useUIStore } from '@/stores/useUIStore'
import UserAvatar from '@/components/common/UserAvatar.vue'
import CallState from '@/webrtc/callState'

const callStore = useCallStore()
const uiStore = useUIStore()
const { callDisplayName, callRemoteImg, callState, isOutgoing, isIncoming, isConnected, isConnecting } = storeToRefs(callStore)

// ── 通话计时 ──────────────────────────────────
const talkSeconds = ref(0)
let talkTimer: ReturnType<typeof setInterval> | null = null

function startTimer() {
  talkSeconds.value = 0
  talkTimer = setInterval(() => talkSeconds.value++, 1000)
}
function stopTimer() {
  if (talkTimer) { clearInterval(talkTimer); talkTimer = null }
}

const talkTimeStr = computed(() => {
  const m = Math.floor(talkSeconds.value / 60).toString().padStart(2, '0')
  const s = (talkSeconds.value % 60).toString().padStart(2, '0')
  return `${m}:${s}`
})

// 监听通话状态变化启停计时
import { watch } from 'vue'
watch(callState, (s) => {
  if (s === CallState.STATUS_CONNECTED) startTimer()
  else if (s === CallState.STATUS_IDLE) stopTimer()
})

onUnmounted(stopTimer)

// ── 拖拽 ──────────────────────────────────────
const modalRef = ref<HTMLElement>()
const pos = ref({ x: 0, y: 0 })
const dragging = ref(false)
let startX = 0, startY = 0, startPosX = 0, startPosY = 0

function onDragStart(e: MouseEvent) {
  if ((e.target as HTMLElement).closest('.call-ops')) return
  dragging.value = true
  startX = e.clientX; startY = e.clientY
  startPosX = pos.value.x; startPosY = pos.value.y
  document.addEventListener('mousemove', onDragMove)
  document.addEventListener('mouseup', onDragEnd)
}

function onDragMove(e: MouseEvent) {
  if (!dragging.value) return
  pos.value.x = startPosX + e.clientX - startX
  pos.value.y = startPosY + e.clientY - startY
}

function onDragEnd() {
  dragging.value = false
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
}

onUnmounted(() => {
  document.removeEventListener('mousemove', onDragMove)
  document.removeEventListener('mouseup', onDragEnd)
})
</script>

<template>
  <div class="voice-overlay">
    <div
      ref="modalRef"
      class="voice-modal"
      :style="{ transform: `translate(${pos.x}px, ${pos.y}px)` }"
      @mousedown="onDragStart"
    >
      <!-- 模糊背景 -->
      <div class="voice-bg">
        <UserAvatar :src="callRemoteImg" :name="callDisplayName" :size="280" style="border-radius:0;opacity:.4" />
        <div class="bg-blur"></div>
      </div>

      <!-- 主内容 -->
      <div class="voice-main">
        <UserAvatar :src="callRemoteImg" :name="callDisplayName" :size="72" />
        <p class="call-name">{{ callDisplayName || '对方' }}</p>

        <p v-if="isOutgoing" class="call-status">等待对方接听...</p>
        <p v-else-if="isIncoming" class="call-status">邀请您通话</p>
        <p v-else-if="isConnecting" class="call-status">正在连接...</p>
        <p v-else-if="isConnected" class="call-status">{{ talkTimeStr }}</p>

        <div class="call-ops">
          <!-- 发出中：取消 -->
          <template v-if="isOutgoing">
            <button class="op-btn cancel-btn" @click="callStore.cancelCall()">取消</button>
          </template>
          <!-- 来电中：拒绝 + 接听 -->
          <template v-else-if="isIncoming">
            <button class="op-btn cancel-btn" @click="callStore.cancelCall()">拒绝</button>
            <button class="op-btn accept-btn" @click="callStore.answerCall()">接听</button>
          </template>
          <!-- 连接中 / 已连接：挂断 -->
          <template v-else>
            <button class="op-btn cancel-btn" @click="callStore.cancelCall()">挂断</button>
          </template>
        </div>
      </div>

      <audio id="wxCallRemoteAudio" autoplay style="display:none"></audio>
    </div>
  </div>
</template>

<style scoped>
.voice-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.voice-modal {
  pointer-events: all;
  position: relative;
  width: 280px;
  height: 360px;
  border-radius: 16px;
  overflow: hidden;
  cursor: grab;
  box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  user-select: none;
}
.voice-modal:active { cursor: grabbing; }

/* ── 背景 ─── */
.voice-bg {
  position: absolute;
  inset: 0;
  overflow: hidden;
}
.bg-blur {
  position: absolute;
  inset: 0;
  background: rgba(20, 80, 40, 0.75);
  backdrop-filter: blur(20px);
}

/* ── 内容 ─── */
.voice-main {
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  padding-top: 52px;
  gap: 8px;
}

.call-name {
  font-size: 18px;
  font-weight: 600;
  color: #fff;
  margin: 0;
}
.call-status {
  font-size: 13px;
  color: rgba(255,255,255,0.75);
  margin: 0;
}

.call-ops {
  margin-top: 48px;
  display: flex;
  gap: 20px;
  justify-content: center;
}

.op-btn {
  padding: 10px 28px;
  border-radius: 24px;
  border: none;
  cursor: pointer;
  font-size: 15px;
  font-weight: 500;
  transition: opacity 150ms;
}
.op-btn:hover { opacity: 0.85; }
.cancel-btn { background: #ff5f5f; color: #fff; }
.accept-btn { background: #39c46a; color: #fff; }
</style>
