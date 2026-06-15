<script setup lang="ts">
import { useUIStore } from '@/stores/useUIStore'
import { useGroupStore } from '@/stores/useGroupStore'
const emit = defineEmits<{ (e: 'close'): void }>()
const uiStore = useUIStore()
const groupStore = useGroupStore()
function openSearch() { uiStore.showSearchFriendDialog = true; emit('close') }
function openCreate() { groupStore.groupOperateState = 0; uiStore.showCreateGroupDialog = true; emit('close') }
</script>
<template>
  <div class="add-tip">
    <div class="add-item" @click="openSearch">添加好友</div>
    <div class="add-item" @click="openCreate">创建群组</div>
  </div>
</template>
<style scoped>
.add-tip {
  position: absolute; left: 50px; top: 0; z-index: 200;
  background: var(--bg-secondary); border: 1px solid var(--border);
  border-radius: 8px; width: 130px; box-shadow: 0 4px 16px var(--shadow); overflow: hidden;
}
.add-item { padding: 10px 16px; cursor: pointer; font-size: 13px; color: var(--text-primary); }
.add-item:hover { background: var(--bg-tertiary); }
</style>
