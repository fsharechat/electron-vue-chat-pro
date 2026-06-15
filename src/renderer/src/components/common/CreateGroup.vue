<script setup lang="ts">
import { ref, computed, watch, onMounted } from 'vue'
import { storeToRefs } from 'pinia'
import { useGroupStore } from '@/stores/useGroupStore'
import { useFriendStore } from '@/stores/useFriendStore'
import { useUIStore } from '@/stores/useUIStore'
import { useConversationStore } from '@/stores/useConversationStore'
import { useGroupCallStore } from '@/stores/useGroupCallStore'
import { useMessage } from 'naive-ui'
import webSocketClient from '@/websocket/websocketcli'
import LocalStore from '@/websocket/store/localstore'
import { SUCCESS_CODE } from '@/constant'

const groupStore = useGroupStore()
const friendStore = useFriendStore()
const uiStore = useUIStore()
const convStore = useConversationStore()
const groupCallStore = useGroupCallStore()
const message = useMessage()

const { groupOperateState, groupMemberTracker, groupMemberMap } = storeToRefs(groupStore)
const { showCreateGroupDialog } = storeToRefs(uiStore)
const { selectTarget } = storeToRefs(convStore)

const searchInput = ref('')
const selectedFriends = ref<any[]>([])
const confirmLoading = ref(false)

const title = computed(() => {
  const map: Record<number, string> = { 0: '创建群聊', 1: '添加成员', 2: '移除成员', 3: '加入群聊', 4: '选择群视频成员' }
  return map[groupOperateState.value] ?? '群组操作'
})

const checkFriendTips = computed(() =>
  selectedFriends.value.length === 0 ? '未选择联系人' : `已选择${selectedFriends.value.length}位联系人`
)

// state=4 时直接用群成员列表，排除自己
const groupVideoMemberList = computed(() => {
  void groupMemberTracker.value
  const selfId = LocalStore.getUserId()
  const members = groupMemberMap.value.get(selectTarget.value) ?? []
  return members
    .filter((m: any) => m.memberId !== selfId)
    .map((m: any) => {
      const user = uiStore.userInfoList.find((u: any) => u.uid === m.memberId)
      const name = m.alias || user?.displayName || user?.nickname || m.memberId
      const img = user?.portrait || ''
      const nameStr = name as string
      const initial = nameStr ? nameStr[0].toUpperCase() : '#'
      return { wxid: m.memberId, nickname: name, remark: m.alias || '', img, initial, checked: false, disabled: false }
    })
    .filter((m: any) => {
      if (!searchInput.value) return true
      return (m.remark || m.nickname || '').includes(searchInput.value)
    })
})

// Friends list filtered and annotated for current mode
const waitCheckedFriendList = computed(() => {
  if (groupOperateState.value === 4) return groupVideoMemberList.value

  // Force reactivity on tracker
  void groupMemberTracker.value
  const allFriends = friendStore.searchedFriendlist.slice(1)
  const filtered = searchInput.value
    ? allFriends.filter(f => (f.remark || f.nickname || '').includes(searchInput.value))
    : allFriends

  return filtered.map(friend => {
    let isShow = false
    let isChecked = false
    let isDisabled = false

    const members = groupMemberMap.value.get(selectTarget.value) ?? []

    if (groupOperateState.value === 0) {
      isShow = true
    } else if (groupOperateState.value === 1) {
      isShow = true
      const inGroup = members.find((m: any) => m.memberId === friend.wxid)
      if (inGroup) { isChecked = true; isDisabled = true }
    } else if (groupOperateState.value === 2) {
      const inGroup = members.find((m: any) => m.memberId === friend.wxid)
      if (inGroup) { isShow = true }
    } else if (groupOperateState.value === 3) {
      isShow = true
      if (selectTarget.value === friend.wxid) { isChecked = true; isDisabled = true }
    }

    if (!isShow) return null
    return { ...friend, checked: isChecked, disabled: isDisabled }
  }).filter(Boolean)
})

// state=4 时确保群成员已加载
onMounted(async () => {
  if (groupOperateState.value === 4) {
    const target = selectTarget.value
    if (target && !(groupMemberMap.value.get(target)?.length)) {
      try {
        const data = await (webSocketClient as any)._instance?.getGroupMember(target)
        if (data?.result) {
          groupStore.groupMemberMap.set(target, data.result)
          groupStore.groupMemberTracker++
        }
      } catch (e) {
        console.warn('load group members failed', e)
      }
    }
  }
})

// 构建带分组头的渲染列表，只在字母变化时插入分组标题
const groupedFriendList = computed(() => {
  const items: Array<{ type: 'header'; label: string } | { type: 'friend'; friend: any }> = []
  let lastInitial = ''
  for (const friend of waitCheckedFriendList.value) {
    const initial = friend?.initial || '#'
    if (initial !== lastInitial) {
      items.push({ type: 'header', label: initial })
      lastInitial = initial
    }
    items.push({ type: 'friend', friend })
  }
  return items
})

const confirmDisabled = computed(() => {
  if (selectedFriends.value.length === 0) return true
  if (groupOperateState.value === 0 && selectedFriends.value.length < 2) return true
  return false
})

function toggleFriend(friend: any) {
  if (friend.disabled) return
  const idx = selectedFriends.value.findIndex(f => f.wxid === friend.wxid)
  if (idx !== -1) {
    selectedFriends.value.splice(idx, 1)
    // uncheck in list
    friend.checked = false
  } else {
    friend.checked = true
    selectedFriends.value.push(friend)
  }
}

function removeFriend(wxid: string) {
  const idx = selectedFriends.value.findIndex(f => f.wxid === wxid)
  if (idx !== -1) selectedFriends.value.splice(idx, 1)
  // uncheck in list
  const f = waitCheckedFriendList.value.find((f: any) => f.wxid === wxid)
  if (f) f.checked = false
}

function isSelected(wxid: string) {
  return selectedFriends.value.some(f => f.wxid === wxid)
}

async function confirm() {
  if (confirmDisabled.value) return
  confirmLoading.value = true
  try {
    const memberIds = selectedFriends.value.map(f => f.wxid)
    const state = groupOperateState.value

    if (state === 0) {
      const selfId = LocalStore.getUserId()
      if (selfId) memberIds.push(selfId)
      const groupName = selectedFriends.value.slice(0, 2).map(f => f.remark || f.nickname).join('、')
      const data = await webSocketClient.createGroup(groupName, memberIds)
      if (data?.code === SUCCESS_CODE) { message.success('创建群组成功'); exit() }
      else message.error('创建群组失败，请重试')
    } else if (state === 1) {
      const data = await webSocketClient.addMembers(selectTarget.value, memberIds)
      if (data?.code === SUCCESS_CODE) exit()
    } else if (state === 2) {
      const data = await webSocketClient.kickeMembers(selectTarget.value, memberIds)
      if (data?.code === SUCCESS_CODE) exit()
    } else if (state === 3) {
      const selfId = LocalStore.getUserId()
      if (selfId) memberIds.push(selfId)
      memberIds.push(selectTarget.value)
      const groupName = selectedFriends.value.slice(0, 2).map(f => f.remark || f.nickname).join('、')
      const data = await webSocketClient.createGroup(groupName, memberIds)
      if (data?.code === SUCCESS_CODE) exit()
    } else if (state === 4) {
      groupCallStore.startGroupCall(selectTarget.value, memberIds, uiStore.userInfoList)
      exit()
    }
  } catch { message.error('操作失败') } finally {
    confirmLoading.value = false
  }
}

function exit() {
  showCreateGroupDialog.value = false
  selectedFriends.value = []
  searchInput.value = ''
}
</script>

<template>
  <div class="create-group-overlay" @click.self="exit">
    <div class="create-group-dialog">
      <div class="content">
        <!-- Left: friend list -->
        <div class="friendlist-area">
          <div class="search-wrap">
            <input v-model="searchInput" class="search-input" placeholder="搜索" />
          </div>
          <div class="friendlist">
            <template v-for="(item, idx) in groupedFriendList" :key="idx">
              <div v-if="item.type === 'header'" class="list-title">{{ item.label }}</div>
              <div
                v-else
                class="friend-row"
                :class="{ disabled: item.friend.disabled }"
                @click="toggleFriend(item.friend)"
              >
                <img :src="item.friend.img" class="avatar" onerror="this.src='/images/vue.jpg'" />
                <span class="remark">{{ item.friend.remark || item.friend.nickname }}</span>
                <div class="checkbox" :class="{ checked: isSelected(item.friend.wxid) || (item.friend.disabled && item.friend.checked) }">
                  <svg v-if="isSelected(item.friend.wxid) || (item.friend.disabled && item.friend.checked)" width="10" height="10" viewBox="0 0 12 12" fill="white">
                    <path d="M2 6l3 3 5-5" stroke="white" stroke-width="1.5" fill="none" stroke-linecap="round"/>
                  </svg>
                </div>
              </div>
            </template>
          </div>
        </div>

        <!-- Right: selected panel -->
        <div class="selected-area">
          <div class="selected-header">
            <span class="dialog-title">{{ title }}</span>
            <span class="tips">{{ checkFriendTips }}</span>
          </div>
          <div class="selected-list">
            <div v-for="f in selectedFriends" :key="f.wxid" class="selected-row">
              <img :src="f.img" class="avatar" onerror="this.src='/images/vue.jpg'" />
              <span class="remark">{{ f.remark || f.nickname }}</span>
              <span class="del-btn" @click="removeFriend(f.wxid)">✕</span>
            </div>
          </div>
          <div class="action-btns">
            <button class="btn cancel-btn" @click="exit">取 消</button>
            <button class="btn confirm-btn" :class="{ disabled: confirmDisabled }" :disabled="confirmDisabled" @click="confirm">确 定</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.create-group-overlay {
  position: fixed; inset: 0;
  background: rgba(0,0,0,0.4);
  display: flex; align-items: center; justify-content: center;
  z-index: 1000;
}
.create-group-dialog {
  background: var(--bg-surface);
  border-radius: 8px;
  width: 560px;
  height: 560px;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0,0,0,0.3);
}
.content {
  display: flex;
  width: 100%;
  height: 100%;
}

/* Left panel */
.friendlist-area {
  width: 50%;
  border-right: 1px solid var(--border);
  display: flex;
  flex-direction: column;
  background: var(--bg-surface);
}
.search-wrap {
  padding: 12px;
  flex-shrink: 0;
}
.search-input {
  width: 100%;
  padding: 7px 12px;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 13px;
  outline: none;
  box-sizing: border-box;
}
.search-input::placeholder { color: var(--text-muted); }
.friendlist {
  flex: 1;
  overflow-y: auto;
}
.list-title {
  padding: 10px 12px 3px;
  font-size: 11px;
  color: var(--text-muted);
}
.friend-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 7px 12px;
  cursor: pointer;
  border-top: 1px solid var(--border);
  transition: background 120ms;
}
.friend-row:hover { background: var(--bg-elevated); }
.friend-row.disabled { opacity: 0.5; cursor: default; }
.avatar { width: 36px; height: 36px; border-radius: 4px; flex-shrink: 0; object-fit: cover; }
.remark { flex: 1; font-size: 13px; color: var(--text-primary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.checkbox {
  width: 18px; height: 18px;
  border: 1.5px solid var(--border-strong);
  border-radius: 3px;
  flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: var(--bg-surface);
}
.checkbox.checked { background: var(--accent); border-color: var(--accent); }

/* Right panel */
.selected-area {
  width: 50%;
  display: flex;
  flex-direction: column;
  padding: 12px;
  background: var(--bg-surface);
}
.selected-header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  margin-bottom: 12px;
  flex-shrink: 0;
}
.dialog-title { font-size: 14px; font-weight: 600; color: var(--text-primary); }
.tips { font-size: 11px; color: var(--text-muted); }
.selected-list {
  flex: 1;
  overflow-y: auto;
}
.selected-row {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 6px 4px;
}
.del-btn {
  margin-left: auto;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 12px;
  padding: 2px 6px;
  border-radius: 4px;
}
.del-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }
.action-btns {
  display: flex;
  gap: 10px;
  justify-content: flex-end;
  flex-shrink: 0;
  padding-top: 10px;
}
.btn {
  padding: 7px 22px;
  border-radius: 20px;
  border: 1px solid var(--border);
  background: var(--bg-elevated);
  color: var(--text-secondary);
  font-size: 13px;
  cursor: pointer;
  transition: all 120ms;
}
.cancel-btn:hover { background: var(--bg-float); }
.confirm-btn {
  background: transparent;
  color: var(--accent);
  border-color: var(--accent);
}
.confirm-btn:hover:not(.disabled) { background: var(--accent-subtle); }
.confirm-btn.disabled { opacity: 0.4; cursor: default; color: var(--text-muted); border-color: var(--border); }
</style>
