<script setup lang="ts">
import { computed, ref, watch, onMounted, onUnmounted } from 'vue'
import { useGroupStore } from '@/stores/useGroupStore'
import { useUIStore } from '@/stores/useUIStore'
import { useConversationStore } from '@/stores/useConversationStore'
import { useFriendStore } from '@/stores/useFriendStore'
import { useMessage, useDialog } from 'naive-ui'
import UserAvatar from '@/components/common/UserAvatar.vue'
import webSocketClient from '@/websocket/websocketcli'
import LocalStore from '@/websocket/store/localstore'

const props = defineProps<{ targetId: string; isSingle?: boolean }>()
const emit = defineEmits<{ (e: 'close'): void }>()

const panelRef = ref<HTMLElement>()

function onDocClick(e: MouseEvent) {
  if (panelRef.value && !panelRef.value.contains(e.target as Node)) {
    emit('close')
  }
}
onMounted(() => setTimeout(() => document.addEventListener('click', onDocClick), 0))
onUnmounted(() => document.removeEventListener('click', onDocClick))

const groupStore = useGroupStore()
const uiStore = useUIStore()
const convStore = useConversationStore()
const friendStore = useFriendStore()
const message = useMessage()
const dialog = useDialog()

const groupInfo = computed(() => groupStore.groupInfoList.find(g => g.target === props.targetId))
const rawMembers = computed(() => groupStore.groupMemberMap.get(props.targetId) ?? [])

const isGroupOwner = computed(() => {
  // Primary: check groupInfo.owner from server (most reliable)
  if (groupInfo.value?.owner) {
    return groupInfo.value.owner === LocalStore.getUserId()
  }
  // Fallback: check member type from member list
  return rawMembers.value.find((m: any) => m.memberId === LocalStore.getUserId())?.memberType === 2
})

// Member list: add/remove buttons + actual members
// 显式依赖 userInfoList，保证异步拉取完成后自动刷新
const memberList = computed(() => {
  void uiStore.userInfoList.length
  if (props.isSingle) {
    // Single chat: add-member button + self + target
    const selfId = LocalStore.getUserId() ?? ''
    return [
      { type: 'add-single', displayName: '添加成员' },
      { type: 'user', memberId: selfId, displayName: getUserName(selfId), avatarUrl: getUserPortrait(selfId) },
      { type: 'user', memberId: props.targetId, displayName: getUserName(props.targetId), avatarUrl: getUserPortrait(props.targetId) },
    ]
  }
  const items: any[] = [{ type: 'add', displayName: '添加成员' }]
  if (isGroupOwner.value) items.push({ type: 'remove', displayName: '移除成员' })
  for (const m of rawMembers.value) {
    items.push({ type: 'user', memberId: m.memberId, displayName: getUserName(m.memberId), avatarUrl: getUserPortrait(m.memberId) })
  }
  return items
})

function getUserName(uid: string) {
  const friend = friendStore.friendlist.find(f => f.wxid === uid)
  if (friend) return friend.remark || friend.nickname
  const u = uiStore.userInfoList.find((u: any) => u.uid === uid)
  return u?.displayName ?? uid
}

function getUserPortrait(uid: string) {
  const friend = friendStore.friendlist.find(f => f.wxid === uid)
  if (friend?.img) return friend.img
  const u = uiStore.userInfoList.find((u: any) => u.uid === uid)
  return u?.portrait ?? ''
}

// 补拉缺失用户信息
function fetchMissingUserInfos(members: any[]) {
  const missing = members
    .map((m: any) => m.memberId)
    .filter(uid => {
      if (!uid) return false
      if (friendStore.friendlist.find(f => f.wxid === uid)) return false
      if (uiStore.userInfoList.find((u: any) => u.uid === uid)) return false
      return true
    })
  if (missing.length > 0) webSocketClient.getUserInfos(missing)
}

// 面板打开时拉取，成员列表变化时补拉
watch(rawMembers, (members) => fetchMissingUserInfos(members), { immediate: true })

function openAddMember() {
  groupStore.groupOperateState = props.isSingle ? 3 : 1
  groupStore.groupMemberTracker++
  uiStore.showCreateGroupDialog = true
}

function openRemoveMember() {
  groupStore.groupOperateState = 2
  groupStore.groupMemberTracker++
  uiStore.showCreateGroupDialog = true
}

function quitGroup() {
  dialog.warning({
    title: '退出群聊',
    content: '确定要退出该群聊吗？',
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const data = await webSocketClient.quitGroup(props.targetId)
        if (data?.code === 200) {
          message.success('已退出群聊')
          emit('close')
          setTimeout(() => convStore.deleteConversation(props.targetId), 500)
        } else {
          message.error('退出失败')
        }
      } catch { message.error('退出失败') }
    },
    onNegativeClick: () => message.info('已取消')
  })
}

function dismissGroup() {
  dialog.warning({
    title: '解散群组',
    content: '此操作将永久解散群组，是否继续？',
    positiveText: '确定',
    negativeText: '取消',
    onPositiveClick: async () => {
      try {
        const data = await webSocketClient.dismissGroup(props.targetId)
        if (data?.code === 200) {
          message.success('解散群组成功')
          emit('close')
          setTimeout(() => convStore.deleteConversation(props.targetId), 500)
        } else {
          message.error('解散失败，仅群主可操作')
        }
      } catch { message.error('解散失败') }
    },
    onNegativeClick: () => message.info('已取消解散群组')
  })
}

function saveGroupName(e: FocusEvent) {
  const name = (e.target as HTMLElement).innerText.trim()
  if (!name || name === groupInfo.value?.name) return
  webSocketClient.modifyGroupInfo({ groupId: props.targetId, type: 0, value: name })
}
</script>

<template>
  <div class="group-info-panel" ref="panelRef">
    <!-- Group name + announcement (group only) -->
    <div v-if="!isSingle" class="panel-top">
      <div class="section-row">
        <span class="section-label">群名</span>
        <p class="group-name-editable" contenteditable="true"
           @blur="saveGroupName" @keydown.enter.prevent="($event.target as HTMLElement).blur()">
          {{ groupInfo?.name ?? targetId }}
        </p>
      </div>
      <div class="section-row">
        <span class="section-label">群公告</span>
        <span class="section-value muted">暂无公告</span>
      </div>
    </div>

    <!-- Member list -->
    <div class="member-list">
      <div v-for="(item, i) in memberList" :key="i" class="member-cell">
        <!-- Add member button -->
        <template v-if="item.type === 'add' || item.type === 'add-single'">
          <div class="action-icon add-icon" @click="openAddMember">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
              <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
          </div>
          <span class="member-cell-name">添加</span>
        </template>
        <!-- Remove member button -->
        <template v-else-if="item.type === 'remove'">
          <div class="action-icon remove-icon" @click="openRemoveMember">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
              <rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="12" x2="16" y2="12"/>
            </svg>
          </div>
          <span class="member-cell-name">移除</span>
        </template>
        <!-- User -->
        <template v-else>
          <UserAvatar :src="item.avatarUrl" :name="item.displayName" :size="40" />
          <span class="member-cell-name">{{ item.displayName }}</span>
        </template>
      </div>
    </div>

    <!-- Group actions at bottom (group only) -->
    <div v-if="!isSingle" class="panel-bottom">
      <span v-if="!isGroupOwner" class="action-text quit" @click="quitGroup">退出群聊</span>
      <span v-else class="action-text dismiss" @click="dismissGroup">解散群聊</span>
    </div>
  </div>
</template>

<style scoped>
.group-info-panel {
  position: absolute;
  top: 52px; right: 0; bottom: 0;
  width: 220px;
  background: var(--bg-overlay);
  border-left: 1px solid var(--border);
  z-index: 100;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-top {
  padding: 12px;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.section-row {
  display: flex;
  flex-direction: column;
  margin-bottom: 10px;
}
.section-row:last-child { margin-bottom: 0; }
.section-label { font-size: 11px; color: var(--text-muted); margin-bottom: 3px; }
.group-name-editable {
  font-size: 14px; color: var(--text-primary);
  outline: none; cursor: text;
  overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
  padding: 2px 4px; border-radius: 4px;
}
.group-name-editable:focus { background: var(--bg-elevated); }
.section-value { font-size: 13px; color: var(--text-primary); }
.section-value.muted { color: var(--text-muted); }

.member-list {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 10px 4px;
  align-content: start;
}
.member-cell {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  cursor: default;
  min-width: 0;
}
.action-icon {
  width: 40px; height: 40px;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer; flex-shrink: 0;
  color: var(--text-muted);
  transition: background 150ms;
}
.action-icon:hover { background: var(--bg-elevated); color: var(--text-primary); }
.member-cell-name {
  font-size: 11px; color: var(--text-secondary);
  width: 100%;
  text-align: center;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

.panel-bottom {
  padding: 8px 12px;
  border-top: 1px solid var(--border);
  flex-shrink: 0;
  text-align: center;
}
.action-text {
  font-size: 13px; cursor: pointer;
}
.action-text.quit { color: var(--accent); }
.action-text.dismiss { color: var(--danger); }
</style>
