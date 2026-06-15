<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useFriendStore } from '@/stores/useFriendStore'
import { useUIStore } from '@/stores/useUIStore'
import { useMessage } from 'naive-ui'
import UserAvatar from '@/components/common/UserAvatar.vue'
import webSocketClient from '@/websocket/websocketcli'

const friendStore = useFriendStore()
const uiStore = useUIStore()
const message = useMessage()
const { friendRequests } = storeToRefs(friendStore)
const { userInfoList } = storeToRefs(uiStore)

function getUserInfo(uid: string) {
  return userInfoList.value.find((u: any) => u.uid === uid)
}

function getDisplayName(uid: string) {
  const info = getUserInfo(uid)
  return info?.displayName || uid
}

function getPortrait(uid: string) {
  const info = getUserInfo(uid)
  return info?.portrait || ''
}

function handleRequest(fromUid: string, agree: boolean) {
  try {
    // 与 vue-chat-pro 保持一致：发送 { targetUid, status } 对象
    ;(webSocketClient as any)._instance?.handleFriendRequest({
      targetUid: fromUid,
      status: agree ? 1 : 2
    })
    friendStore.handleFriendRequest({ targetUid: fromUid })
    message.success(agree ? '已同意' : '已拒绝')
  } catch { message.error('操作失败') }
}
</script>

<template>
  <div class="friend-request">
    <div class="req-header">新的朋友</div>
    <div v-if="friendRequests.length === 0" class="empty">暂无好友请求</div>
    <div v-for="req in friendRequests" :key="req.from" class="req-item">
      <UserAvatar
        :src="getPortrait(req.from)"
        :name="getDisplayName(req.from)"
        :size="44"
      />
      <div class="req-info">
        <span class="req-name">{{ getDisplayName(req.from) }}</span>
        <span class="req-reason">{{ req.reason }}</span>
      </div>
      <div class="req-actions">
        <span v-if="req.status === 1" class="accepted">已添加</span>
        <template v-else>
          <button class="action-btn agree" @click="handleRequest(req.from, true)">同意</button>
          <button class="action-btn reject" @click="handleRequest(req.from, false)">拒绝</button>
        </template>
      </div>
    </div>
  </div>
</template>

<style scoped>
.friend-request {
  padding: 20px 24px;
  height: 100%;
}

.req-header {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 16px;
}

.empty {
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
  padding: 60px 0;
}

.req-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
}

.req-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.req-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.req-reason {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 3px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.req-actions {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
}

.accepted {
  font-size: 13px;
  color: var(--text-muted);
}

.action-btn {
  padding: 5px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: background var(--dur-normal);
}

.action-btn.agree {
  background: var(--accent);
  color: #fff;
}
.action-btn.agree:hover { background: var(--accent-hover, #4752c4); }

.action-btn.reject {
  background: var(--bg-elevated);
  color: var(--text-muted);
  border: 1px solid var(--border);
}
.action-btn.reject:hover { background: var(--bg-overlay); color: var(--text-primary); }
</style>
