<script setup lang="ts">
import { computed, ref } from 'vue'
import type { ProtoMessage } from '@/types'
import { storeToRefs } from 'pinia'
import { useUIStore } from '@/stores/useUIStore'
import { useConversationStore } from '@/stores/useConversationStore'
import { useGroupStore } from '@/stores/useGroupStore'
import MarkdownText from './MarkdownText.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'
import LocationMessage from './LocationMessage.vue'
import MessageConfig from '@/websocket/message/messageConfig'
import TimeUtils from '@/websocket/utils/timeUtils'
import Utils from '@/websocket/utils/utils'

const props = defineProps<{
  message: ProtoMessage
  prevMessage?: ProtoMessage
}>()

const emit = defineEmits<{
  (e: 'contextmenu', event: MouseEvent): void
  (e: 'avatar-click', userId: string, x: number, y: number): void
}>()

const uiStore = useUIStore()
const convStore = useConversationStore()
const groupStore = useGroupStore()
const { userInfoList, stateMessageReports, emojis, minuteTick } = storeToRefs(uiStore)
const { isSingleConversation } = storeToRefs(convStore)
const { currentGroupMemberCount } = storeToRefs(groupStore)

const isSelf = computed(() => props.message.direction === 0)

const isNotification = computed(() => props.message.content.type >= 80 && props.message.content.type <= 117)
const isRecallNotification = computed(() => props.message.content.type === 84)
const isGroupNotification = computed(() => isNotification.value && !isRecallNotification.value && !isSystemMsg.value)
const isSystemMsg = computed(() => props.message.content.type === 90)

const notificationText = computed(() => {
  // Explicitly depend on userInfoList so the text re-resolves when user info is fetched
  void userInfoList.value
  try {
    const mc = MessageConfig.convert2MessageContent(props.message.from, props.message.content) as any
    return mc?.formatNotification?.() ?? mc?.digest?.() ?? ''
  } catch { return '' }
})

const showTimestamp = computed(() => {
  if (!props.prevMessage) return true
  return props.message.timestamp - props.prevMessage.timestamp > 5 * 60 * 1000
})

const avatarSrc = computed(() => {
  const u = userInfoList.value.find((u: any) => u.uid === props.message.from)
  return u?.portrait ?? '/images/vue.jpg'
})

const senderName = computed(() => {
  const u = userInfoList.value.find((u: any) => u.uid === props.message.from)
  return u?.displayName ?? props.message.from
})

const isText = computed(() => props.message.content.type === 1 || props.message.content.type === 0)
const isAudio = computed(() => props.message.content.type === 2)
const isImage = computed(() => props.message.content.type === 3)
const isFile = computed(() => props.message.content.type === 5)
const isVideo = computed(() => props.message.content.type === 6)
const isLocation = computed(() => props.message.content.type === 4)
const locationData = computed(() => {
  if (!isLocation.value) return null
  try {
    const mc = MessageConfig.convert2MessageContent(props.message.from, props.message.content) as any
    return { title: mc.title, thumbnail: mc.thumbnail, lat: mc.lat, long: mc.long }
  } catch { return null }
})
const isVoip = computed(() => props.message.content.type >= 400)

const voipText = computed(() => {
  if (!isVoip.value) return ''
  try {
    const mc = MessageConfig.convert2MessageContent(props.message.from, props.message.content) as any
    return mc?.digest?.() ?? '[语音通话]'
  } catch { return '[语音通话]' }
})

const textContent = computed(() => {
  if ((props.message as any).streaming) return props.message.content.searchableContent ?? ''
  return props.message.content.searchableContent ?? props.message.content.content ?? ''
})

const thumbnailSrc = computed(() => {
  const b = props.message.content.binaryContent
  return b ? `data:image/png;base64,${b}` : ''
})

const audioInfo = computed(() => {
  try {
    const mc = MessageConfig.convert2MessageContent(props.message.from, props.message.content)
    return { duration: (mc as any).duration ?? 0, url: (mc as any).remotePath ?? '' }
  } catch { return { duration: 0, url: '' } }
})

const audioMsgWidth = computed(() => {
  const d = audioInfo.value.duration
  return Math.min(220, 80 + d * 4) + 'px'
})

const fileInfo = computed(() => {
  try {
    const mc = MessageConfig.convert2MessageContent(props.message.from, props.message.content) as any
    const size = mc.size ? Utils.formateSize(mc.size) : ''
    return { name: mc.name ?? '', size, url: mc.remotePath ?? '' }
  } catch { return { name: '', size: '', url: '' } }
})

const messageStatus = computed(() => {
  if (!isSelf.value) return 0
  if (!isSingleConversation.value) return 4
  let status = 3
  const smr = stateMessageReports.value.find((r: any) => r.target === props.message.target)
  if (smr) {
    for (const r of smr.messageReports) {
      if (r.date > props.message.timestamp) {
        if (r.reportType === 2) { status = 2; break }
        else if (r.reportType === 1) status = 1
      }
    }
  }
  return status
})

const readCountText = computed(() => {
  let total = currentGroupMemberCount.value - 1
  const smr = stateMessageReports.value.find((r: any) => r.target === props.message.target)
  if (smr) {
    for (const r of smr.messageReports) {
      if (r.reportType === 2 && r.date > props.message.timestamp) total--
    }
  }
  return total <= 0 ? '全部已读' : `${total}人未读`
})

function formatTime(ts: number) {
  void minuteTick.value  // 每分钟触发重渲染，使"刚刚"等相对时间自动更新
  return TimeUtils.getTimeStringAutoShort2(ts, true)
}

function onAvatarClick(e: MouseEvent) {
  e.stopPropagation()
  emit('avatar-click', props.message.from, e.clientX, e.clientY)
}

const isAudioPlaying = computed(() => uiStore.currentAudioMessageId === props.message.messageId)
function toggleAudio() {
  if (isAudioPlaying.value) { uiStore.stopAudio(); return }
  uiStore.playAudio(audioInfo.value.url, props.message.messageId, () => {})
}
</script>

<template>
  <div v-if="showTimestamp" class="time-divider">
    <span>{{ formatTime(message.timestamp) }}</span>
  </div>

  <div v-if="isGroupNotification || isRecallNotification || isSystemMsg" class="notification-bar">
    <span>{{ isSystemMsg ? (message.content.content ?? '') : notificationText }}</span>
  </div>

  <div v-else-if="!isNotification" class="message-row" :class="{ self: isSelf }" @contextmenu.prevent="emit('contextmenu', $event)">
    <div class="avatar-btn" @click.stop="onAvatarClick">
      <UserAvatar :src="avatarSrc" :name="senderName" :size="34" radius="var(--radius-sm)" />
    </div>
    <div class="bubble-wrap">
      <div v-if="!isSingleConversation && !isSelf" class="sender-name">{{ senderName }}</div>
      <div class="bubble-meta" :class="{ self: isSelf }">
        <div v-if="isSelf" class="read-status">
          <span v-if="messageStatus === 2" class="read">已读</span>
          <span v-else-if="messageStatus === 1" class="delivered">已送达</span>
          <span v-else-if="messageStatus === 3" class="unread">未读</span>
          <span v-else-if="messageStatus === 4" :class="readCountText === '全部已读' ? 'read' : 'unread'">{{ readCountText }}</span>
        </div>
        <div class="bubble" :class="{ 'bubble-self': isSelf, 'bubble-other': !isSelf }">
          <MarkdownText v-if="isText" :content="textContent" :streaming="!!(message as any).streaming" :emojis="emojis" />
          <div v-else-if="isAudio" class="audio-msg" :style="{ width: audioMsgWidth }" @click="toggleAudio">
            <span class="audio-duration">{{ audioInfo.duration }}"</span>
            <div class="audio-icon" :class="{ playing: isAudioPlaying }">
              <span class="bar"></span>
              <span class="bar"></span>
              <span class="bar"></span>
            </div>
          </div>
          <n-image v-else-if="isImage"
            :src="thumbnailSrc || message.content.remoteMediaUrl"
            :preview-src="message.content.remoteMediaUrl ?? thumbnailSrc"
            width="160" style="border-radius:4px;display:block"
          />
          <div v-else-if="isFile" class="file-msg">
            <div class="file-icon"></div>
            <div class="file-info">
              <p class="file-name">{{ fileInfo.name }}</p>
              <p class="file-size">{{ fileInfo.size }}</p>
            </div>
            <a v-if="fileInfo.url" :href="fileInfo.url" target="_blank" class="file-download" title="下载"></a>
          </div>
          <video v-else-if="isVideo"
            :src="message.content.remoteMediaUrl"
            :poster="thumbnailSrc" controls width="250" style="border-radius:4px;max-height:330px"
          ></video>
          <LocationMessage
            v-else-if="isLocation && locationData"
            :title="locationData.title"
            :thumbnail="locationData.thumbnail"
            :lat="locationData.lat"
            :long="locationData.long"
          />
          <div v-else-if="isVoip" class="voip-msg">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0">
              <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.64 3.4 2 2 0 0 1 3.6 1.23h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 8.37a16 16 0 0 0 6.29 6.29l.95-.95a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
            </svg>
            <span>{{ voipText }}</span>
          </div>
          <span v-else class="unknown-msg">[不支持的消息类型]</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
/* ── Time divider ─────────────────────────────────────── */
.time-divider {
  text-align: center;
  margin: 16px 0 8px;
  padding: 0 20px;
}
.time-divider span {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-muted);
  white-space: nowrap;
  padding: 0 4px;
}

/* ── Notification bar ─────────────────────────────────── */
.notification-bar {
  text-align: center;
  margin: 4px 20px;
  font-size: 11.5px;
  color: var(--text-muted);
}
.notification-bar span {
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  padding: 3px 12px;
  border-radius: var(--radius-pill);
  display: inline-block;
}

/* ── Message row ──────────────────────────────────────── */
.message-row {
  display: flex;
  align-items: flex-start;
  padding: 2px 20px;
  gap: 10px;
  transition: background var(--dur-fast);
}
.message-row:hover { background: rgba(255,255,255,0.015); }
.message-row.self { flex-direction: row-reverse; }

.avatar-btn {
  flex-shrink: 0;
  cursor: pointer;
  border-radius: var(--radius-sm);
  transition: opacity var(--dur-fast);
}
.avatar-btn:hover { opacity: 0.85; }

.avatar {
  width: 34px;
  height: 34px;
  border-radius: var(--radius-sm);
  object-fit: cover;
  flex-shrink: 0;
  border: 1px solid var(--border);
  margin-top: 2px;
}

/* Bubble container */
.bubble-wrap { display: flex; flex-direction: column; max-width: 68%; }
.sender-name {
  font-size: 11px;
  font-weight: 500;
  color: var(--accent);
  margin-bottom: 4px;
  padding-left: 2px;
}
.bubble-meta { display: flex; align-items: flex-end; gap: 6px; }
.bubble-meta.self { justify-content: flex-end; }

/* Read status */
.read-status {
  font-family: var(--font-mono);
  font-size: 10px;
  white-space: nowrap;
  flex-shrink: 0;
}
.read     { color: var(--text-muted); }
.delivered{ color: var(--text-muted); }
.unread   { color: var(--color-online); }

/* Bubble */
.bubble {
  padding: 9px 13px;
  border-radius: var(--radius-lg);
  font-size: 13.5px;
  line-height: 1.6;
  word-break: break-word;
  max-width: 100%;
}
.bubble-other {
  background: var(--bg-bubble-in);
  color: var(--text-primary);
  border-radius: var(--radius-sm) var(--radius-lg) var(--radius-lg) var(--radius-lg);
  border: 1px solid var(--border);
}
.bubble-self {
  background: var(--bg-bubble-out);
  color: #fff;
  border-radius: var(--radius-lg) var(--radius-sm) var(--radius-lg) var(--radius-lg);
}
.bubble-self :deep(a) {
  color: rgba(255, 255, 255, 0.85);
  text-decoration: underline;
  text-underline-offset: 2px;
  word-break: break-all;
}

/* Audio */
.audio-msg {
  display: flex; align-items: center; justify-content: space-between;
  cursor: pointer; min-width: 80px; padding: 2px 0; gap: 12px;
}
.audio-duration { font-family: var(--font-mono); font-size: 12px; opacity: 0.8; }
.audio-icon {
  display: flex; align-items: flex-end; gap: 2px; height: 16px; flex-shrink: 0;
}
.audio-icon .bar {
  display: block; width: 3px; border-radius: 2px;
  background: rgba(255,255,255,0.75);
  height: 6px;
  transition: height 0.1s;
}
.audio-icon .bar:nth-child(1) { height: 5px; }
.audio-icon .bar:nth-child(2) { height: 9px; }
.audio-icon .bar:nth-child(3) { height: 5px; }
.audio-icon.playing .bar:nth-child(1) { animation: audioBar 0.7s ease-in-out infinite alternate; }
.audio-icon.playing .bar:nth-child(2) { animation: audioBar 0.7s ease-in-out 0.15s infinite alternate; }
.audio-icon.playing .bar:nth-child(3) { animation: audioBar 0.7s ease-in-out 0.3s infinite alternate; }
@keyframes audioBar {
  from { height: 3px; opacity: 0.5; }
  to   { height: 14px; opacity: 1; }
}
.bubble-other .audio-icon .bar { background: var(--text-secondary); }

/* File */
.file-msg {
  display: flex; align-items: center; gap: 12px;
  min-width: 200px; max-width: 280px; padding: 2px 0;
}
.file-icon {
  width: 38px; height: 38px;
  background: rgba(99,102,241,0.2);
  border: 1px solid var(--border-accent);
  border-radius: var(--radius-sm);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0;
}
.file-icon::after { content: '📄'; font-size: 18px; }
.file-info { flex: 1; min-width: 0; }
.file-name { font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.file-size { font-family: var(--font-mono); font-size: 10.5px; color: rgba(255,255,255,0.5); margin-top: 2px; }
.file-download {
  width: 28px; height: 28px; border-radius: var(--radius-sm);
  background: rgba(255,255,255,0.1); flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  text-decoration: none; color: rgba(255,255,255,0.7);
  transition: background var(--dur-fast);
}
.file-download:hover { background: rgba(255,255,255,0.2); }
.file-download::after { content: '↓'; font-size: 14px; font-weight: 600; }

/* 接收方气泡（浅色背景）颜色覆盖 */
.bubble-other .file-size { color: var(--text-muted); }
.bubble-other .file-download {
  background: var(--bg-elevated);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}
.bubble-other .file-download:hover { background: var(--bg-tertiary); }
.bubble-other .audio-icon { color: var(--text-secondary); }
.bubble-other .unknown-msg { color: var(--text-muted); font-style: italic; }

/* Location / Unknown */
.voip-msg { display: flex; align-items: center; gap: 8px; min-width: 120px; padding: 2px 0; }
.voip-msg span { font-size: 13px; }
.unknown-msg { font-size: 12px; color: rgba(255,255,255,0.4); font-style: italic; }
</style>
