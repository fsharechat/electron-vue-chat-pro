<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import type { StateConversationInfo } from '@/types'
import { useConversationStore } from '@/stores/useConversationStore'
import { useUIStore } from '@/stores/useUIStore'
import UserAvatar from '@/components/common/UserAvatar.vue'
import MessageConfig from '@/websocket/message/messageConfig'
import TimeUtils from '@/websocket/utils/timeUtils'

const props = defineProps<{ conversation: StateConversationInfo; isActive: boolean }>()
const emit = defineEmits<{ (e: 'context-menu', event: MouseEvent, conv: StateConversationInfo): void }>()
const convStore = useConversationStore()
const uiStore = useUIStore()
const { userInfoList, minuteTick } = storeToRefs(uiStore)

const isGroup = computed(() => props.conversation.conversationInfo.conversationType === 1)

const lastMessageText = computed(() => {
  const msg = props.conversation.conversationInfo.lastMessage
  if (!msg) return ''
  // Notifications (type ≥ 80) must always be decoded — searchableContent may be raw data, not display text
  if (msg.content?.type !== undefined && msg.content.type >= 80) {
    // Depend on userInfoList so the text re-resolves when user info is fetched
    void userInfoList.value
    try {
      const mc = MessageConfig.convert2MessageContent(msg.from, msg.content) as any
      return mc?.formatNotification?.() ?? mc?.digest?.() ?? ''
    } catch { return '' }
  }
  return msg.content?.searchableContent || msg.content?.content || ''
})

const timeText = computed(() => {
  void minuteTick.value
  const ts = props.conversation.conversationInfo.timestamp
  if (!ts) return ''
  return TimeUtils.getTimeStringAutoShort2(ts, false)
})

const unread = computed(() => props.conversation.conversationInfo.unreadCount?.unread ?? 0)
const isTop = computed(() => !!props.conversation.conversationInfo.isTop)
const isSilent = computed(() => !!props.conversation.conversationInfo.isSilent)
const displayName = computed(() => props.conversation.name || props.conversation.conversationInfo.target)
const isAtMe = computed(() => convStore.atMeSet.has(props.conversation.conversationInfo.target))

function select() { convStore.selectConversation(props.conversation.conversationInfo.target) }
</script>

<template>
  <div class="conv-item" :class="{ active: isActive, unread: unread > 0, pinned: isTop }" @click="select" @contextmenu.prevent="emit('context-menu', $event, conversation)">
    <div class="avatar-wrap">
      <UserAvatar
        :src="conversation.img"
        :name="displayName"
        :size="42"
        :is-group="isGroup"
      />
    </div>
    <div class="info">
      <div class="top-row">
        <span class="name">{{ displayName }}</span>
        <div class="meta-right">
          <svg v-if="isSilent" class="icon-silent" viewBox="0 0 24 24" fill="currentColor" width="11" height="11">
            <path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/>
          </svg>
          <span class="time">{{ timeText }}</span>
        </div>
      </div>
      <div class="bottom-row">
        <span v-if="isAtMe" class="at-me-tag">[有人@我]</span>
        <span class="preview" :class="{ 'has-unread': unread > 0 }">{{ lastMessageText || '暂无消息' }}</span>
        <span v-if="unread > 0" class="unread-badge">{{ unread > 99 ? '99+' : unread }}</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.conv-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  margin: 1px 8px;
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: background var(--dur-normal);
  position: relative;
}
.conv-item::before {
  content: '';
  position: absolute;
  left: -8px;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  width: 3px;
  height: 22px;
  background: var(--accent);
  border-radius: 0 2px 2px 0;
  transition: transform var(--dur-normal) var(--ease-out);
}
.conv-item:hover { background: var(--bg-elevated); }
.conv-item.active { background: var(--accent-subtle); }
.conv-item.active::before { transform: translateY(-50%) scaleY(1); }
.conv-item.pinned { background: var(--bg-elevated); }
.conv-item.pinned::after {
  content: '';
  position: absolute;
  top: 0; right: 0;
  border-style: solid;
  border-width: 0 8px 8px 0;
  border-color: transparent var(--accent) transparent transparent;
  border-radius: 0 var(--radius-md) 0 0;
}

.avatar-wrap { flex-shrink: 0; }
.bottom-row {
  display: flex;
  align-items: center;
  gap: 6px;
}
.unread-badge {
  flex-shrink: 0;
  min-width: 18px; height: 18px;
  padding: 0 5px;
  background: var(--danger); color: #fff;
  border-radius: var(--radius-pill);
  font-size: 10px; font-weight: 600;
  font-family: var(--font-mono);
  line-height: 18px; text-align: center;
}

.info { flex: 1; min-width: 0; }
.top-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 3px;
}
.meta-right {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
}
.icon-silent {
  color: var(--text-muted);
  flex-shrink: 0;
}
.name {
  font-size: 13.5px; font-weight: 500;
  color: var(--text-primary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  flex: 1; min-width: 0; margin-right: 8px;
}
.time {
  font-family: var(--font-mono); font-size: 10.5px;
  color: var(--text-muted); flex-shrink: 0;
}
.preview {
  flex: 1;
  min-width: 0;
  font-size: 12px; color: var(--text-muted);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  line-height: 1.4;
}
.preview.has-unread { color: var(--text-secondary); font-weight: 500; }
.at-me-tag {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--danger);
  margin-right: 4px;
}
</style>
