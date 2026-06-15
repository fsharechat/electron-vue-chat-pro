<script setup lang="ts">
import { ref, computed, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useMessage } from 'naive-ui'
import { useMessageStore } from '@/stores/useMessageStore'
import { useConversationStore } from '@/stores/useConversationStore'
import { useUIStore } from '@/stores/useUIStore'
import { useGroupStore } from '@/stores/useGroupStore'
import { useCallStore } from '@/stores/useCallStore'
import UserAvatar from '@/components/common/UserAvatar.vue'
import webSocketClient from '@/websocket/websocketcli'
import { SUCCESS_CODE } from '@/constant'
import EmojiPicker from './EmojiPicker.vue'
import SendMessage from '@/websocket/message/sendMessage'
import Message from '@/websocket/message/message'
import ProtoMessage from '@/websocket/message/protomessage'
import FscMessage from '@/websocket/message/FscMessage'
import TextMessageContent from '@/websocket/message/textMessageContent'
import ImageMessageContent from '@/websocket/message/imageMessageContent'
import FileMessageContent from '@/websocket/message/fileMessageContent'
import MessageContentMediaType from '@/websocket/message/messageContentMediaType'
import LocalStore from '@/websocket/store/localstore'
import axios from 'axios'

const msgStore = useMessageStore()
const convStore = useConversationStore()
const uiStore = useUIStore()
const groupStore = useGroupStore()
const callStore = useCallStore()
const message = useMessage()

const { emojis, userInfoList } = storeToRefs(uiStore)

const content = ref('')
const showEmoji = ref(false)
const textareaRef = ref<HTMLTextAreaElement>()
const uploadImgRef = ref<HTMLInputElement>()
const uploadFileRef = ref<HTMLInputElement>()

// @ mention
const showAtMenu = ref(false)
const atLoading = ref(false)
const atQuery = ref('')
const atStartPos = ref(-1)
const atSelectedIndex = ref(0)
const atCompletedPos = ref(-1) // @ position that was already handled by selection
const isComposing = ref(false)

const atMembers = computed(() => {
  const query = atQuery.value.toLowerCase()
  const all = { memberId: '__all__', name: '所有人', portrait: '' }
  const members = groupStore.currentGroupMembers
    .map(m => {
      const info = userInfoList.value.find((u: any) => u.uid === m.memberId)
      return {
        memberId: m.memberId,
        name: m.alias || info?.displayName || m.memberId,
        portrait: info?.portrait || ''
      }
    })
    .filter(m => !query || m.name.toLowerCase().includes(query))
  const list = !query || '所有人'.includes(query) ? [all, ...members] : members
  return list
})

function checkAtMention() {
  if (convStore.isSingleConversation || isComposing.value) return
  const el = textareaRef.value
  if (!el) return
  const pos = el.selectionStart ?? 0
  const text = content.value
  let i = pos - 1
  while (i >= 0 && text[i] !== '@' && text[i] !== '\n') i--
  if (i >= 0 && text[i] === '@') {
    const query = text.slice(i + 1, pos)
    if (!/\s/.test(query)) {
      // Skip @ that was already completed via member selection
      if (i === atCompletedPos.value) {
        showAtMenu.value = false
        return
      }
      atStartPos.value = i
      atQuery.value = query
      atSelectedIndex.value = 0
      showAtMenu.value = true
      if (groupStore.currentGroupMembers.length === 0 && !atLoading.value) {
        atLoading.value = true
        ;(webSocketClient as any)._instance?.getGroupMember(convStore.selectTarget).then((data: any) => {
          if (data?.code === SUCCESS_CODE) {
            groupStore.groupMemberMap.set(convStore.selectTarget, data.result)
          }
          atLoading.value = false
        })
      }
      return
    }
  }
  showAtMenu.value = false
}

function selectAtMember(member: { memberId: string; name: string }) {
  const el = textareaRef.value
  if (!el) return
  const pos = el.selectionStart ?? 0
  const before = content.value.slice(0, atStartPos.value)
  const after = content.value.slice(pos)
  content.value = before + '@' + member.name + ' ' + after
  showAtMenu.value = false
  nextTick(() => {
    const newPos = atStartPos.value + member.name.length + 2
    el.setSelectionRange(newPos, newPos)
    el.focus()
  })
}

const sendBtnActive = computed(() => content.value.trim().length > 0)

function buildLocal(mc: any) {
  const sm = new SendMessage(convStore.selectTarget, mc)
  const m = Message.conert2Message(sm)
  const protoMsg = ProtoMessage.convertToProtoMessage(m)
  msgStore.preAddProtoMessage(protoMsg as any)
  msgStore.triggerScrollBottom()
  return { protoMsg, m }
}

function sendToServer(m: any) {
  const fscMsg = FscMessage.convertToFscMessage(m)
  ;(webSocketClient as any)._instance?.sendMessage(fscMsg)
}

function buildAndSend(mc: any) {
  try {
    const { protoMsg, m } = buildLocal(mc)
    sendToServer(m)
    return protoMsg
  } catch (e) {
    console.error('Send failed', e)
    return null
  }
}

function extractMentions(): { mentionedType: number; mentionedTargets: string[] } {
  if (convStore.isSingleConversation) return { mentionedType: 0, mentionedTargets: [] }
  if (content.value.includes('@所有人')) return { mentionedType: 2, mentionedTargets: [] }
  const targets: string[] = []
  for (const m of groupStore.currentGroupMembers) {
    const info = userInfoList.value.find((u: any) => u.uid === m.memberId)
    const name = m.alias || info?.displayName || m.memberId
    if (content.value.includes('@' + name)) targets.push(m.memberId)
  }
  return { mentionedType: targets.length ? 1 : 0, mentionedTargets: targets }
}

function send() {
  if (!content.value.trim()) { message.warning('不能发送空白信息'); return }
  try {
    const { mentionedType, mentionedTargets } = extractMentions()
    const mc = new TextMessageContent(content.value, mentionedType, mentionedTargets)
    buildAndSend(mc)
    content.value = ''
    showAtMenu.value = false
    textareaRef.value?.focus()
  } catch (e) { console.error('Send text failed', e) }
}

function onKeydown(e: KeyboardEvent) {
  if (showAtMenu.value) {
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      atSelectedIndex.value = Math.max(0, atSelectedIndex.value - 1)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      atSelectedIndex.value = Math.min(atMembers.value.length - 1, atSelectedIndex.value + 1)
      return
    }
    if (e.key === 'Enter' && atMembers.value.length > 0) {
      e.preventDefault()
      selectAtMember(atMembers.value[atSelectedIndex.value])
      return
    }
    if (e.key === 'Escape') {
      showAtMenu.value = false
      return
    }
  }
  if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey) {
    e.preventDefault(); send()
  } else if (e.key === 'Enter' && e.ctrlKey) {
    content.value += '\n'; e.preventDefault()
  }
}

function pickEmoji(code: string) {
  content.value += code; showEmoji.value = false; textareaRef.value?.focus()
}

async function onImageSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  await sendImage(file)
  ;(e.target as HTMLInputElement).value = ''
}

async function sendImage(file: File) {
  try {
    const key = `${MessageContentMediaType.Image}-${LocalStore.getUserId()}-${Date.now()}-${file.name}`
    const data = await webSocketClient.getMinioUploadUrl(MessageContentMediaType.Image, key)
    if (data?.code !== SUCCESS_CODE) return

    const thumbnail = await getImageThumbnail(file)
    const { protoMsg, m } = buildLocal(new ImageMessageContent(file, null, thumbnail))

    await fetch(data.result.url, { method: 'PUT', body: file })
    const remotePath = `${data.result.domain}/${key}`
    const finalMc = new ImageMessageContent(file, remotePath, thumbnail)
    m.content = finalMc
    sendToServer(m)
    msgStore.updateSendMessage({ messageId: protoMsg.messageId, messageContent: finalMc })
  } catch (e) { console.error('Image send failed', e) }
}

function getImageThumbnail(file: File): Promise<string> {
  return new Promise(resolve => {
    const reader = new FileReader()
    reader.readAsDataURL(file)
    reader.onload = e => {
      const img = new Image()
      img.src = e.target!.result as string
      img.onload = () => {
        const scale = img.width / img.height
        const w = Math.min(img.width * 0.5, 113)
        const h = w / scale
        const canvas = document.createElement('canvas')
        canvas.width = w; canvas.height = h
        canvas.getContext('2d')!.drawImage(img, 0, 0, w, h)
        resolve(canvas.toDataURL('image/jpeg', 0.5).split(',')[1])
      }
    }
  })
}

async function onFileSelected(e: Event) {
  const file = (e.target as HTMLInputElement).files?.[0]
  if (!file) return
  try {
    const key = `${MessageContentMediaType.File}-${LocalStore.getUserId()}-${Date.now()}-${file.name}`
    const data = await webSocketClient.getMinioUploadUrl(MessageContentMediaType.File, key)
    if (data?.code !== SUCCESS_CODE) return
    const { protoMsg, m } = buildLocal(new FileMessageContent(file, ''))
    try {
      await axios.request({
        method: 'PUT', url: data.result.url, data: file,
        onUploadProgress: (p: any) => msgStore.setFileDownloadStatus({ messageId: protoMsg.messageId, downloadStatus: 1, downloadPercent: Math.floor(p.loaded / p.total * 100) })
      })
      msgStore.setFileDownloadStatus({ messageId: protoMsg.messageId, downloadStatus: 2, downloadPercent: 100 })
      const finalMc = new FileMessageContent(file, `${data.result.domain}/${key}`)
      m.content = finalMc
      sendToServer(m)
      msgStore.updateSendMessage({ messageId: protoMsg.messageId, messageContent: finalMc })
    } catch { message.error('文件上传失败') }
  } catch (e) { console.error('File send failed', e) }
  ;(e.target as HTMLInputElement).value = ''
}

function startAudioCall() {
  if (!convStore.isSingleConversation) return
  callStore.startCall(convStore.selectTarget, true)
}

function startVideoCall() {
  if (convStore.isSingleConversation) {
    callStore.startCall(convStore.selectTarget, false)
  } else {
    uiStore.showCreateGroupDialog = true
    groupStore.groupOperateState = 4
  }
}

function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of Array.from(items)) {
    if (item.kind === 'file') {
      const blob = item.getAsFile()
      if (blob && blob.size > 0) { sendImage(blob); break }
    }
  }
}
</script>

<template>
  <div class="message-input" style="position:relative">
    <!-- Toolbar -->
    <div class="toolbar">
      <n-popover v-model:show="showEmoji" trigger="click" placement="top-start" :show-arrow="false" style="padding:0">
        <template #trigger>
          <button class="tool-btn" title="表情">
            <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/>
            </svg>
          </button>
        </template>
        <EmojiPicker @pick="pickEmoji" />
      </n-popover>

      <label class="tool-btn" title="发送图片">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
        </svg>
        <input ref="uploadImgRef" type="file" accept="image/*" class="hidden-input" @change="onImageSelected" />
      </label>

      <label class="tool-btn" title="发送文件">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
        </svg>
        <input ref="uploadFileRef" type="file" class="hidden-input" @change="onFileSelected" />
      </label>

      <div class="toolbar-divider"></div>

      <button v-if="convStore.isSingleConversation" class="tool-btn" title="语音通话" @click="startAudioCall">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 12 19.79 19.79 0 0 1 1.65 3.4 2 2 0 0 1 3.62 1.2h3a2 2 0 0 1 2 1.72c.127.96.361 1.903.7 2.81a2 2 0 0 1-.45 2.11L7.91 9.4a16 16 0 0 0 5.66 5.66l1.47-1.47a2 2 0 0 1 2.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0 1 22 16.92z"/>
        </svg>
      </button>

      <button class="tool-btn" title="视频通话" @click="startVideoCall">
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2" ry="2"/>
        </svg>
      </button>
    </div>

    <!-- @ mention menu -->
    <Transition name="at-fade">
      <div v-if="showAtMenu" class="at-menu">
        <div v-if="atLoading" class="at-loading">
          <span class="at-spinner"></span>
          <span>加载成员中…</span>
        </div>
        <template v-else-if="atMembers.length > 0">
          <div
            v-for="(m, i) in atMembers"
            :key="m.memberId"
            class="at-item"
            :class="{ active: i === atSelectedIndex, 'at-all': m.memberId === '__all__' }"
            @mousedown.prevent="selectAtMember(m)"
            @mouseover="atSelectedIndex = i"
          >
            <div v-if="m.memberId === '__all__'" class="at-all-icon">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
            </div>
            <UserAvatar v-else :src="m.portrait" :name="m.name" :size="32" radius="var(--radius-sm)" />
            <span class="at-name">{{ m.name }}</span>
          </div>
        </template>
        <div v-else class="at-empty">没有匹配的成员</div>
      </div>
    </Transition>

    <!-- Text area -->
    <textarea
      ref="textareaRef"
      v-model="content"
      class="text-input"
      placeholder="发送消息…"
      @keydown="onKeydown"
      @input="checkAtMention"
      @compositionstart="isComposing = true"
      @compositionend="isComposing = false; checkAtMention()"
      @paste="onPaste"
      @focus="convStore.clearUnreadStatus()"
      @click="showEmoji = false; showAtMenu = false"
    ></textarea>

    <!-- Send -->
    <div class="send-row">
      <span class="shortcut-hint">Enter 发送 · Ctrl+Enter 换行</span>
      <button class="send-btn" :class="{ active: sendBtnActive }" :disabled="!sendBtnActive" @click="send">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>
        </svg>
        发送
      </button>
    </div>
  </div>
</template>

<style scoped>
.message-input {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-surface);
}

/* Toolbar */
.toolbar {
  display: flex;
  align-items: center;
  gap: 1px;
  padding: 6px 16px;
  border-bottom: 1px solid var(--border);
}
.tool-btn {
  position: relative;
  width: 30px; height: 30px;
  border: none; background: transparent;
  color: var(--text-muted); cursor: pointer;
  border-radius: var(--radius-sm);
  display: flex; align-items: center; justify-content: center;
  transition: background var(--dur-normal), color var(--dur-normal);
}
.tool-btn:hover { background: var(--bg-elevated); color: var(--text-secondary); }
.toolbar-divider {
  width: 1px; height: 16px;
  background: var(--border);
  margin: 0 6px;
  flex-shrink: 0;
}
.hidden-input { position: absolute; inset: 0; opacity: 0; cursor: pointer; font-size: 0; width: 100%; height: 100%; }

/* Textarea */
.text-input {
  flex: 1;
  padding: 12px 20px;
  background: transparent;
  border: none; outline: none; resize: none;
  color: var(--text-primary);
  font-size: 13.5px;
  font-family: var(--font-body);
  line-height: 1.7;
}
.text-input::placeholder { color: var(--text-muted); }

/* Send row */
.send-row {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  padding: 8px 16px 12px;
}
.shortcut-hint {
  font-family: var(--font-mono);
  font-size: 10.5px;
  color: var(--text-muted);
}
.send-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 16px;
  border-radius: var(--radius-md);
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-muted);
  font-size: 12.5px;
  font-weight: 500;
  font-family: var(--font-body);
  cursor: pointer;
  transition: all var(--dur-normal) var(--ease-out);
}
.send-btn:disabled { cursor: default; }
.send-btn.active {
  background: var(--accent);
  color: #fff;
  border-color: var(--accent);
  box-shadow: 0 0 12px var(--accent-glow);
}
.send-btn.active:hover {
  background: var(--accent-hover);
  border-color: var(--accent-hover);
}

/* @ mention menu */
.at-menu {
  position: absolute;
  left: 16px;
  bottom: calc(100% - 44px);
  z-index: 300;
  background: var(--bg-float);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 20px var(--shadow);
  min-width: 200px;
  max-width: 300px;
  max-height: 320px;
  overflow-y: auto;
  overflow-x: hidden;
}

.at-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 14px;
  cursor: pointer;
  transition: background var(--dur-fast);
}
.at-item.active,
.at-item:hover {
  background: var(--accent-subtle);
}

.at-name {
  font-size: 13px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.at-all .at-name { font-weight: 600; color: var(--accent); }

.at-all-icon {
  width: 32px;
  height: 32px;
  border-radius: var(--radius-sm);
  background: var(--accent-subtle);
  color: var(--accent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.at-loading, .at-empty {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 14px;
  font-size: 12px;
  color: var(--text-muted);
}

.at-spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--border);
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: at-spin 0.7s linear infinite;
  flex-shrink: 0;
}
@keyframes at-spin { to { transform: rotate(360deg); } }

.at-fade-enter-active, .at-fade-leave-active {
  transition: opacity var(--dur-fast), transform var(--dur-fast);
}
.at-fade-enter-from, .at-fade-leave-to {
  opacity: 0;
  transform: translateY(6px);
}
</style>
