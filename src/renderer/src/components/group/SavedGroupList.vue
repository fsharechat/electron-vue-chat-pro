<template>
  <div class="saved-group-list">
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
import { computed } from 'vue'
import { useUserSettingStore } from '@/stores/useUserSettingStore'
import { useGroupStore } from '@/stores/useGroupStore'
import webSocketClient from '@/websocket/websocketcli'

defineEmits<{ (e: 'select', groupId: string): void }>()

const settingStore = useUserSettingStore()

const groupStore = useGroupStore()

// 群信息还没拉回来时退化为显示群 id，保证列表不会空着；同时补拉一次
const savedGroups = computed(() =>
  settingStore.savedGroupIds.map(id => {
    const info = groupStore.groupInfoList.find(g => g.target === id)
    if (!info) webSocketClient.getGroupInfo(id, false)
    return { id, name: info?.name ?? id, portrait: info?.portrait ?? '' }
  })
)
</script>

<style scoped>
.saved-group-list { display: flex; flex-direction: column; }
.saved-group-item { display: flex; align-items: center; gap: 8px; padding: 8px 12px; cursor: pointer; }
.saved-group-item:hover { background: var(--bg-elevated); }
.avatar { width: 32px; height: 32px; border-radius: 4px; }
.empty { padding: 24px; text-align: center; color: var(--text-muted); }
</style>
