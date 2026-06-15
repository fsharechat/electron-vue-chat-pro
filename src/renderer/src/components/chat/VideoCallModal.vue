<script setup lang="ts">
import { ref, computed, watch, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useCallStore } from '@/stores/useCallStore'
import UserAvatar from '@/components/common/UserAvatar.vue'
import CallState from '@/webrtc/callState'

const callStore = useCallStore()
const { callDisplayName, callRemoteImg, callState, isOutgoing, isIncoming, isConnected, isConnecting } = storeToRefs(callStore)

// ── 通话计时 ──────────────────────────────────
const talkSeconds = ref(0)
let talkTimer: ReturnType<typeof setInterval> | null = null

function startTimer() { talkSeconds.value = 0; talkTimer = setInterval(() => talkSeconds.value++, 1000) }
function stopTimer() { if (talkTimer) { clearInterval(talkTimer); talkTimer = null } }

const talkTimeStr = computed(() => {
  const m = Math.floor(talkSeconds.value / 60).toString().padStart(2, '0')
  const s = (talkSeconds.value % 60).toString().padStart(2, '0')
  return `${m}:${s}`
})

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
  if ((e.target as HTMLElement).closest('.video-controls')) return
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
  <div class="video-overlay">
    <div
      ref="modalRef"
      class="video-modal"
      :style="{ transform: `translate(${pos.x}px, ${pos.y}px)` }"
      @mousedown="onDragStart"
    >
      <!-- 远端视频 / 等待画面 -->
      <div class="remote-area">
        <video
          v-show="isConnected"
          id="wxCallRemoteVideo"
          autoplay playsinline
          style="width:100%;height:100%;object-fit:cover;background:#000"
        ></video>
        <div v-show="!isConnected" class="waiting-cover">
          <UserAvatar :src="callRemoteImg" :name="callDisplayName" :size="80" />
          <p class="waiting-text">
            <span v-if="isOutgoing">等待对方接听...</span>
            <span v-else-if="isIncoming">邀请您视频通话</span>
            <span v-else>正在连接...</span>
          </p>
        </div>
      </div>

      <!-- 本地视频小窗 -->
      <div class="local-area" v-show="isConnected || isConnecting || isOutgoing">
        <video id="wxCallLocalVideo" autoplay muted playsinline style="width:100%;height:100%;object-fit:cover"></video>
      </div>

      <!-- 底部控制栏 -->
      <div class="video-controls">
        <UserAvatar :src="callRemoteImg" :name="callDisplayName" :size="32" />
        <span class="ctrl-name">{{ callDisplayName || '对方' }}</span>
        <span v-if="isConnected" class="ctrl-time">{{ talkTimeStr }}</span>

        <template v-if="isIncoming">
          <button class="ctrl-btn reject" @click="callStore.cancelCall()">拒绝</button>
          <button class="ctrl-btn accept" @click="callStore.answerCall()">接听</button>
        </template>
        <template v-else-if="isOutgoing">
          <button class="ctrl-btn reject" @click="callStore.cancelCall()">取消</button>
        </template>
        <template v-else>
          <button class="ctrl-btn reject" @click="callStore.cancelCall()">挂断</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.video-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
}

.video-modal {
  pointer-events: all;
  position: relative;
  width: 640px;
  height: 420px;
  border-radius: 10px;
  overflow: hidden;
  background: #111;
  box-shadow: 0 20px 60px rgba(0,0,0,0.6);
  cursor: grab;
  user-select: none;
}
.video-modal:active { cursor: grabbing; }

/* ── 远端 ─── */
.remote-area {
  position: absolute;
  inset: 0;
  bottom: 56px;
}
.waiting-cover {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background: #1a1a2e;
  gap: 16px;
}
.waiting-text {
  font-size: 14px;
  color: rgba(255,255,255,0.7);
  margin: 0;
}

/* ── 本地小窗 ─── */
.local-area {
  position: absolute;
  right: 12px;
  bottom: 68px;
  width: 140px;
  height: 100px;
  border-radius: 8px;
  overflow: hidden;
  border: 2px solid rgba(255,255,255,0.2);
  background: #222;
}

/* ── 控制栏 ─── */
.video-controls {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 56px;
  background: rgba(255,255,255,0.95);
  display: flex;
  align-items: center;
  padding: 0 16px;
  gap: 10px;
}
.ctrl-name {
  flex: 1;
  font-size: 13px;
  color: #333;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ctrl-time {
  font-size: 12px;
  color: #666;
}
.ctrl-btn {
  padding: 6px 18px;
  border-radius: 20px;
  border: none;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}
.reject { background: #ff5f5f; color: #fff; }
.accept { background: #39c46a; color: #fff; }
</style>
