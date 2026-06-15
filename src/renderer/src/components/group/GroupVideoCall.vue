<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { useGroupCallStore } from '@/stores/useGroupCallStore'
import { useUIStore } from '@/stores/useUIStore'
import LocalStore from '@/websocket/store/localstore'

const groupCallStore = useGroupCallStore()
const uiStore = useUIStore()

const localUserId = LocalStore.getUserId() ?? ''
const localStream = ref<MediaStream | null>(null)
const showLocalVideo = ref(false)

// ── Dragging ────────────────────────────────────────────
const pos = ref({ x: 0, y: 0 })
const dragging = ref(false)
const dragOrig = ref({ mx: 0, my: 0, px: 0, py: 0 })

function onHeaderMousedown(e: MouseEvent) {
  dragging.value = true
  dragOrig.value = { mx: e.clientX, my: e.clientY, px: pos.value.x, py: pos.value.y }
  document.addEventListener('mousemove', onMousemove)
  document.addEventListener('mouseup', onMouseup)
}
function onMousemove(e: MouseEvent) {
  if (!dragging.value) return
  pos.value = {
    x: dragOrig.value.px + e.clientX - dragOrig.value.mx,
    y: dragOrig.value.py + e.clientY - dragOrig.value.my,
  }
}
function onMouseup() {
  dragging.value = false
  document.removeEventListener('mousemove', onMousemove)
  document.removeEventListener('mouseup', onMouseup)
}

// ── Local camera preview ─────────────────────────────────
async function startLocalCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true })
    localStream.value = stream
    showLocalVideo.value = true
    await attachLocalStream()
  } catch (e) {
    console.warn('Camera unavailable:', e)
  }
}

async function attachLocalStream() {
  if (!localStream.value) return
  // retry until the element is in the DOM (kurento may already own it)
  for (let i = 0; i < 10; i++) {
    const el = document.getElementById(localUserId) as HTMLVideoElement | null
    if (el && !el.srcObject) {
      el.srcObject = localStream.value
      el.play().catch(() => {})
      return
    }
    if (el?.srcObject) return  // kurento already attached
    await new Promise(r => setTimeout(r, 100))
  }
}

function stopLocalCamera() {
  localStream.value?.getTracks().forEach(t => t.stop())
  localStream.value = null
  showLocalVideo.value = false
}

onMounted(() => {
  startLocalCamera()
  // keep member portraits up-to-date
  watch(() => uiStore.userInfoList, list => groupCallStore.updateMemberInfo(list), { immediate: true })
})

onUnmounted(() => {
  stopLocalCamera()
  document.removeEventListener('mousemove', onMousemove)
  document.removeEventListener('mouseup', onMouseup)
})

function endCall() {
  stopLocalCamera()
  groupCallStore.endCall()
}

function cancel() {
  stopLocalCamera()
  groupCallStore.endCall()
}

function answerCall() {
  groupCallStore.answerCall()
}
</script>

<template>
  <div class="gvc-overlay">
    <div
      class="gvc-modal"
      :style="{ transform: `translate(${pos.x}px, ${pos.y}px)` }"
    >
      <!-- Draggable header -->
      <div class="gvc-header" @mousedown.prevent="onHeaderMousedown">
        <span>群组视频通话</span>
        <button class="gvc-close" @click="endCall">×</button>
      </div>

      <!-- Remote participants area -->
      <div class="gvc-members">
        <div
          v-for="member in groupCallStore.members"
          :key="member.uid"
          class="gvc-member-tile"
        >
          <video
            :id="member.uid"
            autoplay
            playsinline
            :class="{ hidden: !member.showVideo }"
          ></video>
          <img
            v-if="!member.showVideo"
            :src="member.img || '/images/default_avatar.png'"
            class="gvc-avatar"
          />
          <span class="gvc-name">{{ member.name }}</span>
        </div>
      </div>

      <!-- Local self-view (bottom-right) -->
      <div class="gvc-local-wrap">
        <video
          :id="localUserId"
          autoplay
          muted
          playsinline
          :class="{ hidden: !showLocalVideo }"
        ></video>
        <div v-if="!showLocalVideo" class="gvc-local-placeholder"></div>
      </div>

      <!-- Controls -->
      <div class="gvc-controls">
        <!-- Incoming call -->
        <template v-if="!groupCallStore.isSender">
          <button class="gvc-btn gvc-reject" @click="cancel">拒绝</button>
          <button class="gvc-btn gvc-accept" @click="answerCall">接听</button>
        </template>
        <!-- Outgoing / in-call -->
        <template v-else>
          <button class="gvc-btn gvc-hangup" @click="endCall">结束通话</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.gvc-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  pointer-events: none;
}
.gvc-modal {
  pointer-events: all;
  width: 700px;
  min-height: 480px;
  background: #16192a;
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 40px rgba(0,0,0,0.6);
  position: relative;
  user-select: none;
}
.gvc-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: rgba(255,255,255,0.06);
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  cursor: move;
  flex-shrink: 0;
}
.gvc-close {
  background: none;
  border: none;
  color: #aaa;
  font-size: 22px;
  cursor: pointer;
  line-height: 1;
}
.gvc-close:hover { color: #fff; }

.gvc-members {
  flex: 1;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 12px 12px 8px;
  overflow-y: auto;
  min-height: 300px;
}
.gvc-member-tile {
  position: relative;
  width: 200px;
  height: 150px;
  background: #222438;
  border-radius: 8px;
  overflow: hidden;
  flex-shrink: 0;
}
.gvc-member-tile video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.gvc-member-tile video.hidden {
  display: none;
}
.gvc-avatar {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.gvc-name {
  position: absolute;
  bottom: 6px;
  left: 8px;
  color: #fff;
  font-size: 12px;
  text-shadow: 0 1px 3px rgba(0,0,0,0.8);
}

/* Local self-view */
.gvc-local-wrap {
  position: absolute;
  right: 16px;
  bottom: 68px;
  width: 160px;
  height: 120px;
  border-radius: 8px;
  overflow: hidden;
  box-shadow: 0 4px 16px rgba(0,0,0,0.5);
  background: #111;
}
.gvc-local-wrap video {
  width: 100%;
  height: 100%;
  object-fit: cover;
}
.gvc-local-wrap video.hidden {
  display: none;
}
.gvc-local-placeholder {
  width: 100%;
  height: 100%;
  background: #222438;
}

/* Controls */
.gvc-controls {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding: 12px 16px;
  background: rgba(255,255,255,0.04);
  flex-shrink: 0;
}
.gvc-btn {
  padding: 8px 28px;
  border-radius: 8px;
  border: none;
  color: #fff;
  font-size: 14px;
  cursor: pointer;
  font-weight: 500;
}
.gvc-hangup { background: #ff6161; }
.gvc-reject  { background: #ff6161; }
.gvc-accept  { background: #39ba70; }
.gvc-btn:hover { opacity: 0.85; }
</style>
