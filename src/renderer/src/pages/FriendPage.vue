<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useFriendStore } from '@/stores/useFriendStore'
import { useConversationStore } from '@/stores/useConversationStore'
import { useUIStore } from '@/stores/useUIStore'
import { useRouter } from 'vue-router'
import SearchBar from '@/components/common/SearchBar.vue'
import FriendList from '@/components/friend/FriendList.vue'
import FriendInfo from '@/components/friend/FriendInfo.vue'
import FriendRequestPanel from '@/components/friend/FriendRequest.vue'
import ProtoConversationInfo from '@/websocket/model/protoConversationInfo'
import UnreadCount from '@/websocket/model/unReadCount'

const friendStore = useFriendStore()
const convStore = useConversationStore()
const uiStore = useUIStore()
const router = useRouter()
const { selectFriendId, selectedFriend } = storeToRefs(friendStore)
const { showSearchFriendDialog } = storeToRefs(uiStore)

const showRequests = computed(() => selectFriendId.value === 0)

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
  }
  convStore.selectTarget = target
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
      <FriendInfo v-else-if="selectedFriend" :friend="selectedFriend" @send-message="sendMessage" />
      <div v-else class="empty">选择一个好友查看详情</div>
    </main>
  </div>
</template>

<style scoped>
.friend-page { display: flex; height: 100%; }
.friend-panel { width: 260px; flex-shrink: 0; border-right: 1px solid var(--border); display: flex; flex-direction: column; background: var(--bg-tertiary); }
.panel-header { padding: 16px 12px 8px; display: flex; align-items: center; justify-content: space-between; }
.panel-title { font-size: 16px; font-weight: 700; color: var(--text-primary); }
.add-btn { width: 28px; height: 28px; border-radius: 6px; border: none; background: var(--bg-secondary); color: var(--text-muted); cursor: pointer; font-size: 18px; display: flex; align-items: center; justify-content: center; }
.add-btn:hover { background: var(--accent); color: #fff; }
.info-panel { flex: 1; overflow-y: auto; background: var(--bg-primary); }
.empty { display: flex; align-items: center; justify-content: center; height: 100%; color: var(--text-muted); font-size: 14px; }
</style>
