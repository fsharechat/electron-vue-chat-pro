<template>
  <div class="saved-group-list">
    <div class="list-header">群聊</div>
    <div v-if="savedGroups.length === 0" class="empty">还没有保存的群聊</div>
    <div
      v-for="group in savedGroups"
      :key="group.id"
      data-testid="saved-group-item"
      class="saved-group-item"
      @click="$emit('select', group.id)"
    >
      <img v-if="group.portrait" :src="group.portrait" class="avatar" />
      <span class="name">{{ group.name }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue'
import { useUserSettingStore } from '@/stores/useUserSettingStore'
import { useGroupStore } from '@/stores/useGroupStore'
import webSocketClient from '@/websocket/websocketcli'
import { selectMissingGroupIds } from './savedGroupList'

defineEmits<{ (e: 'select', groupId: string): void }>()

const settingStore = useUserSettingStore()

const groupStore = useGroupStore()

// 群信息还没拉回来时退化为显示群 id，保证列表不会空着。computed 只做纯粹的 id -> 展示数据映射，
// 不带副作用：把 getGroupInfo 混进 getter 会导致 groupInfoList 因任意群信息到达而变化时，
// 对所有仍缺信息的群重复发起请求（getGroupInfo 自身不去重）。
const savedGroups = computed(() =>
  settingStore.savedGroupIds.map(id => {
    const info = groupStore.groupInfoList.find(g => g.target === id)
    return { id, name: info?.name ?? id, portrait: info?.portrait ?? '' }
  })
)

// 补拉缺失群信息的副作用单独放在 watch 里，配合 selectMissingGroupIds 的去重，
// 保证同一个 groupId 只会被请求一次
const requestedGroupIds = new Set<string>()

watch(
  () => settingStore.savedGroupIds,
  ids => {
    const toFetch = selectMissingGroupIds(ids, groupStore.groupInfoList, requestedGroupIds)
    for (const id of toFetch) webSocketClient.getGroupInfo(id, false)
  },
  { immediate: true }
)
</script>

<style scoped>
/* 版式与「新的朋友」面板（FriendRequest.vue）保持一致：同样的外边距、标题字号与条目分隔线 */
.saved-group-list {
  padding: 20px 24px;
  height: 100%;
}

.list-header {
  font-size: 15px;
  font-weight: 700;
  color: var(--text-primary);
  margin-bottom: 16px;
}

.saved-group-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 0;
  border-bottom: 1px solid var(--border);
  cursor: pointer;
}
.saved-group-item:hover { background: var(--bg-elevated); }

.avatar {
  width: 44px;
  height: 44px;
  border-radius: var(--radius-md);
  flex-shrink: 0;
  object-fit: cover;
}

.name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.empty {
  color: var(--text-muted);
  font-size: 13px;
  text-align: center;
  padding: 24px;
}
</style>
