<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useMessage } from 'naive-ui'
import { useMessageStore } from '@/stores/useMessageStore'
import { useConversationStore } from '@/stores/useConversationStore'
import { useUIStore } from '@/stores/useUIStore'
import ConversationList from '@/components/conversation/ConversationList.vue'
import MessageList from '@/components/chat/MessageList.vue'
import MessageInput from '@/components/chat/MessageInput.vue'
import RelayMessage from '@/components/common/RelayMessage.vue'
import VoiceCallModal from '@/components/chat/VoiceCallModal.vue'
import VideoCallModal from '@/components/chat/VideoCallModal.vue'
import webSocketClient from '@/websocket/websocketcli'
import { SUCCESS_CODE } from '@/constant'
import type { ProtoMessage } from '@/types'
import LocalStore from '@/websocket/store/localstore'
import RecallMessageNotification from '@/websocket/message/notification/recallMessageNotification'
import MessageContentType from '@/websocket/message/messageContentType'

const uiStore = useUIStore()
const msgStore = useMessageStore()
const convStore = useConversationStore()
const message = useMessage()
const { showRelayMessageDialog, showChatBox, showAudioBox } = storeToRefs(uiStore)

const contextMenuVisible = ref(false)
const contextMenuX = ref(0)
const contextMenuY = ref(0)
const contextMessage = ref<any>(null)

const contextMenuOptions = computed(() => {
  const type = contextMessage.value?.content?.type
  const isMedia = type === MessageContentType.Image || type === MessageContentType.Video
  const base = [
    { label: '转发', key: 'relay' },
    { label: '复制文本', key: 'copy' },
  ]
  if (isMedia) base.push({ label: '下载', key: 'download' })
  base.push({ label: '撤回消息', key: 'recall' })
  base.push({ label: '删除', key: 'delete' })
  return base
})

function onContextMenu(e: MouseEvent, msg: any) {
  contextMenuX.value = e.clientX; contextMenuY.value = e.clientY
  contextMessage.value = msg; contextMenuVisible.value = true
}

async function onContextMenuSelect(key: string) {
  contextMenuVisible.value = false
  const msg = contextMessage.value
  if (!msg) return
  if (key === 'recall') {
    try {
      const data = await webSocketClient.recallMessage(msg.messageUid)
      if (data?.code === SUCCESS_CODE && data.result === 200) {
        const recall = new RecallMessageNotification(LocalStore.getUserId(), msg.messageUid)
        msg.content = recall.encode()
      } else { message.error('非管理员只能撤回自己发送的消息') }
    } catch { message.error('撤回失败') }
  } else if (key === 'relay') {
    uiStore.currentRightMenuMessage = msg; uiStore.showRelayMessageDialog = true
  } else if (key === 'copy') {
    try {
      const text = msg.content?.searchableContent ?? msg.content?.content ?? ''
      if (text) navigator.clipboard.writeText(text)
    } catch { message.error('复制失败') }
  } else if (key === 'download') {
    const url = msg.content?.remoteMediaUrl || msg.content?.remotePath
    if (url) {
      try {
        const res = await fetch(url)
        const blob = await res.blob()
        const objectUrl = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = objectUrl
        a.download = msg.content?.name || url.split('/').pop() || 'download'
        a.click()
        URL.revokeObjectURL(objectUrl)
      } catch { message.error('下载失败') }
    } else {
      message.warning('暂无可下载的文件地址')
    }
  } else if (key === 'delete') {
    msgStore.deleteMessage(msg.messageId)
  }
}

// ── Resizable conversation panel (horizontal) ─────────────
const CONV_WIDTH_KEY = 'conv-panel-width'
const MIN_WIDTH = 200
const MAX_WIDTH = 420

const convWidth = ref(parseInt(localStorage.getItem(CONV_WIDTH_KEY) ?? '270'))

let hDragging = false
let hStartX = 0
let hStartWidth = 0

function onResizerMousedown(e: MouseEvent) {
  hDragging = true
  hStartX = e.clientX
  hStartWidth = convWidth.value
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}

// ── Resizable input area (vertical) ───────────────────────
const INPUT_HEIGHT_KEY = 'input-area-height'
const MIN_HEIGHT = 100
const MAX_HEIGHT = 400

const inputHeight = ref(parseInt(localStorage.getItem(INPUT_HEIGHT_KEY) ?? '196'))

let vDragging = false
let vStartY = 0
let vStartHeight = 0

function onHResizerMousedown(e: MouseEvent) {
  vDragging = true
  vStartY = e.clientY
  vStartHeight = inputHeight.value
  document.body.style.cursor = 'row-resize'
  document.body.style.userSelect = 'none'
}

// ── Shared mousemove / mouseup ─────────────────────────────
function onMousemove(e: MouseEvent) {
  if (hDragging) {
    const delta = e.clientX - hStartX
    convWidth.value = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, hStartWidth + delta))
  }
  if (vDragging) {
    const delta = vStartY - e.clientY          // 向上拖 → delta 正 → 高度增加
    inputHeight.value = Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, vStartHeight + delta))
  }
}

function onMouseup() {
  if (hDragging) {
    hDragging = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    localStorage.setItem(CONV_WIDTH_KEY, String(convWidth.value))
  }
  if (vDragging) {
    vDragging = false
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    localStorage.setItem(INPUT_HEIGHT_KEY, String(inputHeight.value))
  }
}

onMounted(() => {
  document.addEventListener('mousemove', onMousemove)
  document.addEventListener('mouseup', onMouseup)
})

onUnmounted(() => {
  document.removeEventListener('mousemove', onMousemove)
  document.removeEventListener('mouseup', onMouseup)
})
</script>

<template>
  <div class="chat-page">
    <aside class="conv-panel" :style="{ width: convWidth + 'px' }">
      <ConversationList />
    </aside>

    <div class="resizer" @mousedown.prevent="onResizerMousedown"></div>

    <main class="chat-area" v-if="convStore.selectTarget">
      <div class="message-area">
        <MessageList @context-menu="onContextMenu" />
      </div>
      <div class="h-resizer" @mousedown.prevent="onHResizerMousedown"></div>
      <div class="input-area" :style="{ height: inputHeight + 'px' }">
        <MessageInput />
      </div>
    </main>
    <div v-else class="chat-empty">
      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
      </svg>
      <p>选择一个会话开始聊天</p>
    </div>

    <n-dropdown
      :show="contextMenuVisible"
      :options="contextMenuOptions"
      :x="contextMenuX" :y="contextMenuY"
      placement="bottom-start"
      @select="onContextMenuSelect"
      @clickoutside="contextMenuVisible = false"
    />

    <RelayMessage v-if="showRelayMessageDialog" />
    <VideoCallModal v-if="showChatBox" />
    <VoiceCallModal v-if="showAudioBox" />
  </div>
</template>

<style scoped>
.chat-page { display: flex; height: 100%; overflow: hidden; }

.conv-panel { flex-shrink: 0; overflow: hidden; }

.resizer {
  width: 1px;
  flex-shrink: 0;
  cursor: col-resize;
  background: var(--border);
  position: relative;
  transition: background 120ms;
  z-index: 10;
}
.resizer::after {
  content: '';
  position: absolute;
  inset: 0 -5px;
}
.resizer:hover { background: var(--accent); }

.chat-area { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg-base); }
.message-area { flex: 1; min-height: 0; overflow: hidden; }
.h-resizer {
  height: 1px;
  flex-shrink: 0;
  cursor: row-resize;
  background: var(--border);
  position: relative;
  transition: background 120ms;
  z-index: 10;
}
.h-resizer::after {
  content: '';
  position: absolute;
  inset: -5px 0;
}
.h-resizer:hover { background: var(--accent); }
.input-area { flex-shrink: 0; }
.chat-empty {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  color: var(--text-muted); gap: 12px;
}
.chat-empty svg { color: var(--text-muted); opacity: 0.4; }
.chat-empty p { font-size: 13.5px; }
</style>
