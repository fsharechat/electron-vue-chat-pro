<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useFriendStore } from '@/stores/useFriendStore'
import { useConversationStore } from '@/stores/useConversationStore'
import { useGroupStore } from '@/stores/useGroupStore'
import { useUIStore } from '@/stores/useUIStore'
import { useRouter } from 'vue-router'
import SearchBar from '@/components/common/SearchBar.vue'
import FriendList from '@/components/friend/FriendList.vue'
import FriendInfo from '@/components/friend/FriendInfo.vue'
import FriendRequestPanel from '@/components/friend/FriendRequest.vue'
import SavedGroupList from '@/components/group/SavedGroupList.vue'
import ProtoConversationInfo from '@/websocket/model/protoConversationInfo'
import UnreadCount from '@/websocket/model/unReadCount'

const friendStore = useFriendStore()
const convStore = useConversationStore()
const groupStore = useGroupStore()
const uiStore = useUIStore()
const router = useRouter()
const { selectFriendId, selectedFriend } = storeToRefs(friendStore)
const { showSearchFriendDialog } = storeToRefs(uiStore)

const showRequests = computed(() => selectFriendId.value === 0)
const showSavedGroups = computed(() => selectFriendId.value === -1)

function sendMessage() {
  if (!selectedFriend.value) return
  const target = selectedFriend.value.wxid
  const existing = convStore.conversations.find(c => c.conversationInfo.target === target)
  if (!existing) {
    const pci = new ProtoConversationInfo()
    pci.conversationType = 0; pci.target = target; pci.line = 0
    pci.timestamp = Date.now(); pci.unreadCount = new UnreadCount()
    convStore.conversations.unshift({
      name: selectedFriend.value.remark || selectedFriend.value.nickname,
      img: selectedFriend.value.img,
      conversationInfo: pci as any
    })
    convStore.updateConverstationOrder()
    // 这里是绕开 updateConversationInfo 直接建行的两个口子之一，没有 deriveFlag 派发，
    // 新行的 isTop/isSilent 永远是 ProtoConversationInfo 的默认值 false。用已落地的设置表
    // 补投影一次，避免「设置已经是 UG 落地的置顶/免打扰，但会话是这一刻才第一次建出来」时
    // 被 deep watch 落盘成 false、且再也没有机会被 UN/UG 之外的路径纠正。
    convStore.projectUserSettings()
  }
  convStore.selectTarget = target
  router.push('/conversation')
}

// 「群聊」面板选中一个已保存的群后打开对应会话，写法照 sendMessage：会话不存在则先建一条
function openGroupConversation(groupId: string) {
  const existing = convStore.conversations.find(c => c.conversationInfo.target === groupId)
  if (!existing) {
    const info = groupStore.groupInfoList.find(g => g.target === groupId)
    const pci = new ProtoConversationInfo()
    pci.conversationType = 1; pci.target = groupId; pci.line = 0
    pci.timestamp = Date.now(); pci.unreadCount = new UnreadCount()
    convStore.conversations.unshift({
      name: info?.name ?? groupId,
      img: info?.portrait ?? '',
      conversationInfo: pci as any
    })
    convStore.updateConverstationOrder()
    // 同上：新建的会话行绕开了 updateConversationInfo 的 deriveFlag，
    // 用设置表补投影一次，否则已保存到通讯录的群第一次被点开时会丢失置顶/免打扰。
    convStore.projectUserSettings()
  }
  convStore.selectTarget = groupId
  router.push('/conversation')
}
</script>

<template>
  <div class="friend-page">
    <aside class="friend-panel">
      <div class="panel-header">
        <span class="panel-title">好友</span>
        <button class="add-btn" title="添加好友" @click="showSearchFriendDialog = true">+</button>
      </div>
      <SearchBar v-model="friendStore.friendSearchText" placeholder="搜索好友" />
      <FriendList />
    </aside>
    <main class="info-panel">
      <FriendRequestPanel v-if="showRequests" />
      <SavedGroupList v-else-if="showSavedGroups" @select="openGroupConversation" />
      <FriendInfo v-else-if="selectedFriend" :friend="selectedFriend" @send-message="sendMessage" />
      <div v-else class="empty">选择一个好友查看详情</div>
    </main>
  </div>
</template>

<style scoped>
.friend-page { display: flex; height: 100%; }
/* 两栏同色，分栏线不能只靠底色差，需用强描边 */
.friend-panel { width: 260px; flex-shrink: 0; border-right: 1px solid var(--border-strong); display: flex; flex-direction: column; background: var(--bg-overlay); }
.panel-header { padding: 16px 12px 8px; display: flex; align-items: center; justify-content: space-between; }
.panel-title { font-size: 16px; font-weight: 700; color: var(--text-primary); }
.add-btn { width: 28px; height: 28px; border-radius: 6px; border: none; background: var(--bg-secondary); color: var(--text-muted); cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; }
.add-btn:hover { background: var(--accent); color: #fff; }
.info-panel { flex: 1; overflow-y: auto; background: var(--bg-overlay); }
.empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); font-size: 14px; }
</style>
