<script setup lang="ts">
import { ref, computed, watch, nextTick } from 'vue'
import { storeToRefs } from 'pinia'
import { useMessage } from 'naive-ui'
import { useMessageStore } from '@/stores/useMessageStore'
import { useConversationStore } from '@/stores/useConversationStore'
import { useUIStore } from '@/stores/useUIStore'
import { useGroupStore } from '@/stores/useGroupStore'
import webSocketClient from '@/websocket/websocketcli'
import { SUCCESS_CODE } from '@/constant'
import MessageBubble from './MessageBubble.vue'
import GroupInfo from '@/components/group/GroupInfo.vue'
import UserProfileCard from '@/components/common/UserProfileCard.vue'
import Conversation from '@/websocket/model/conversation'
import ProtoMessage from '@/websocket/message/protomessage'
import LocalStore from '@/websocket/store/localstore'

const emit = defineEmits<{ (e: 'context-menu', event: MouseEvent, msg: any): void }>()

const msgStore = useMessageStore()
const convStore = useConversationStore()
const uiStore = useUIStore()
const groupStore = useGroupStore()
const message = useMessage()

const { selectedChat, streamingTokenCount, scrollBottomTrigger, incomingMsgTrigger } = storeToRefs(msgStore)
const { selectTarget, isSingleConversation, isLoadRemoteMessage, conversations } = storeToRefs(convStore)
const { showGroupInfo } = storeToRefs(uiStore)

const chatTitle = computed(() => {
  const conv = conversations.value.find(c => c.conversationInfo.target === selectTarget.value)
  return conv?.name || selectTarget.value
})

const listRef = ref<HTMLElement>()
const isLoading = ref(false)

const profileCard = ref<{ userId: string; x: number; y: number } | null>(null)

function onAvatarClick(userId: string, x: number, y: number) {
  profileCard.value = { userId, x, y }
}
const isAtBottom = ref(true)
const unreadBadge = ref(0)
let prevScrollHeight = 0
let autoScrolling = false

function checkAtBottom(el: HTMLElement) {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 60
}

function scrollToBottom() {
  autoScrolling = true
  nextTick(() => requestAnimationFrame(() => {
    if (listRef.value) {
      listRef.value.scrollTop = listRef.value.scrollHeight
      isAtBottom.value = true
      unreadBadge.value = 0
    }
    setTimeout(() => { autoScrolling = false }, 100)
  }))
}

watch(scrollBottomTrigger, () => scrollToBottom())
watch(streamingTokenCount, () => { if (isAtBottom.value) scrollToBottom() })
watch(selectTarget, () => { convStore.isLoadRemoteMessage = false; unreadBadge.value = 0; scrollToBottom(); uiStore.stopAudio() })
// 收到新消息：在底部自动滚，否则徽标 +1
watch(incomingMsgTrigger, () => {
  if (isAtBottom.value) scrollToBottom()
  else unreadBadge.value++
})
// tab 切回来：清除当前会话未读角标；切走时停止语音播放
watch(() => uiStore.visibilityState, (state) => {
  if (state === 'visible') convStore.clearUnreadStatus()
  else uiStore.stopAudio()
})
// 加载历史消息时恢复滚动位置；首次从0变为有消息时（刷新页面初始化）滚到底部
watch(() => msgStore.currentMessages.length, (newLen, oldLen) => {
  if (convStore.isLoadRemoteMessage) {
    nextTick(() => { if (listRef.value) listRef.value.scrollTop = listRef.value.scrollHeight - prevScrollHeight })
  } else if (oldLen === 0 && newLen > 0) {
    scrollToBottom()
  }
})

async function onScroll(e: Event) {
  const el = e.target as HTMLElement
  isAtBottom.value = checkAtBottom(el)
  if (isAtBottom.value) {
    unreadBadge.value = 0
    if (!autoScrolling) {
      convStore.atMeSet.delete(selectTarget.value)
    }
  }
  if (el.scrollTop > 0 || isLoading.value) return
  isLoading.value = true
  prevScrollHeight = el.scrollHeight
  const firstMsg = selectedChat.value.protoMessages[0] as any
  const beforeUid = firstMsg?.messageUid ?? '0'
  const type = isSingleConversation.value ? 0 : 1
  try {
    const conv = new Conversation(type, selectedChat.value.target, 0)
    const data = await webSocketClient.getRemoteMessages(conv, beforeUid, 20)
    if (data?.result) {
      const parsed = JSON.parse(data.result)
      if (parsed.count > 0) {
        for (const raw of parsed.messageResponseList) msgStore.addOldMessage(ProtoMessage.toProtoMessage(raw) as any)
        convStore.isLoadRemoteMessage = true
      }
    }
  } catch { } finally { isLoading.value = false }
}

async function toggleInfoPanel() {
  if (showGroupInfo.value) { showGroupInfo.value = false; return }
  if (isSingleConversation.value) {
    showGroupInfo.value = true
    return
  }
  const data = await (webSocketClient as any)._instance?.getGroupMember(selectedChat.value.target)
  if (data?.code === SUCCESS_CODE) {
    if (!data.result?.length) { message.error('该群组已解散'); convStore.deleteConversation(selectedChat.value.target); return }
    const isMember = data.result.some((m: any) => m.memberId === LocalStore.getUserId())
    if (!isMember) { message.error('您不是群组成员'); convStore.deleteConversation(selectedChat.value.target); return }
    groupStore.groupMemberMap.set(selectedChat.value.target, data.result)
    // Ensure group info (including owner) is loaded
    if (!groupStore.groupInfoList.find((g: any) => g.target === selectedChat.value.target)) {
      webSocketClient.getGroupInfo(selectedChat.value.target, false)
    }
    showGroupInfo.value = true
  }
}
</script>

<template>
  <div class="message-list-container">
    <!-- Header -->
    <div class="msg-header">
      <div class="header-left">
        <span class="chat-name">{{ chatTitle }}</span>
        <span v-if="!isSingleConversation" class="chat-type-tag">群组</span>
      </div>
      <div class="header-actions">
        <button class="action-btn" :title="isSingleConversation ? '用户信息' : '群组成员'" @click="toggleInfoPanel">
          <svg v-if="isSingleConversation" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>
          </svg>
          <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </button>
      </div>
    </div>

    <!-- Info panel: positioned absolute over messages area -->
    <GroupInfo v-if="showGroupInfo" :target-id="selectedChat.target" :is-single="isSingleConversation" @close="showGroupInfo = false" />

    <UserProfileCard
      v-if="profileCard"
      :user-id="profileCard.userId"
      :x="profileCard.x"
      :y="profileCard.y"
      @close="profileCard = null"
    />

    <!-- Messages -->
    <div class="messages-scroll" ref="listRef" @scroll="onScroll">
      <div v-if="isLoading" class="loading-tip">
        <div class="loading-dot"></div>
        <div class="loading-dot" style="animation-delay:.15s"></div>
        <div class="loading-dot" style="animation-delay:.3s"></div>
      </div>
      <MessageBubble
        v-for="(msg, idx) in selectedChat.protoMessages"
        :key="(msg as any).messageId"
        :message="msg as any"
        :prev-message="idx > 0 ? (selectedChat.protoMessages[idx - 1] as any) : undefined"
        @contextmenu="(e: MouseEvent) => emit('context-menu', e, msg)"
        @avatar-click="onAvatarClick"
      />
    </div>

    <!-- 滚动到底部徽标 -->
    <Transition name="badge-fade">
      <button v-if="!isAtBottom" class="scroll-bottom-btn" @click="scrollToBottom">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="6 9 12 15 18 9"/>
        </svg>
        <span v-if="unreadBadge > 0" class="scroll-badge">{{ unreadBadge > 99 ? '99+' : unreadBadge }}</span>
      </button>
    </Transition>
  </div>
</template>

<style scoped>
.message-list-container { display: flex; flex-direction: column; height: 100%; position: relative; }

/* Header */
.msg-header {
  height: 52px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
  background: var(--bg-base);
  position: relative;
}
.header-left { display: flex; align-items: center; gap: 10px; flex: 1; min-width: 0; }
.chat-name {
  font-family: var(--font-display);
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  letter-spacing: -0.2px;
}
.chat-type-tag {
  font-size: 10px;
  font-weight: 500;
  color: var(--accent);
  background: var(--accent-subtle);
  padding: 1px 7px;
  border-radius: var(--radius-pill);
  border: 1px solid var(--border-accent);
  flex-shrink: 0;
}
.header-actions { display: flex; gap: 4px; }
.action-btn {
  width: 32px; height: 32px; border: none;
  background: transparent; color: var(--text-muted);
  border-radius: var(--radius-sm); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: background var(--dur-normal), color var(--dur-normal);
}
.action-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }

/* Messages */
.messages-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 12px 0 8px;
  background: var(--bg-base);
  overscroll-behavior: contain;
}

/* Loading dots */
.loading-tip {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  padding: 16px;
}
.loading-dot {
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--text-muted);
  animation: bounce 0.9s ease-in-out infinite;
}
@keyframes bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
  40% { transform: scale(1); opacity: 1; }
}

/* 滚动到底部按钮 */
.scroll-bottom-btn {
  position: absolute;
  right: 20px;
  bottom: 16px;
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: none;
  background: var(--bg-float);
  color: var(--text-primary);
  box-shadow: var(--shadow-md);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--dur-normal), transform var(--dur-fast);
}
.scroll-bottom-btn:hover { background: var(--bg-elevated); transform: translateY(-2px); }

.scroll-badge {
  position: absolute;
  top: -6px;
  right: -6px;
  min-width: 18px;
  height: 18px;
  padding: 0 4px;
  border-radius: var(--radius-pill);
  background: var(--accent);
  color: #fff;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.badge-fade-enter-active, .badge-fade-leave-active { transition: opacity var(--dur-normal), transform var(--dur-normal); }
.badge-fade-enter-from, .badge-fade-leave-to { opacity: 0; transform: translateY(8px); }
</style>
