<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { useAuthStore } from '@/stores/useAuthStore'
import { useUIStore } from '@/stores/useUIStore'
import { useGroupCallStore } from '@/stores/useGroupCallStore'
import { useMessage } from 'naive-ui'
import AppSidebar from './AppSidebar.vue'
import AppTitleBar from './AppTitleBar.vue'
import GroupVideoCallModal from '@/components/group/GroupVideoCall.vue'
import SearchFriendDialog from '@/components/friend/SearchFriendDialog.vue'
import CreateGroup from '@/components/common/CreateGroup.vue'

const authStore = useAuthStore()
const uiStore = useUIStore()
// Initialize early so the GroupCallClient registers its message listener before any calls arrive
const groupCallStore = useGroupCallStore()
const message = useMessage()

function onVisibility() { uiStore.visibilityChange(document.visibilityState) }

let offWindowFocusChange: (() => void) | undefined

onMounted(() => {
  window.electronAPI?.setLoggedIn(true)
  authStore.initData((isError, msg) => {
    if (isError) message.error(msg)
    else message.info(msg)
  })
  document.addEventListener('visibilitychange', onVisibility)
  offWindowFocusChange = window.electronAPI?.onWindowFocusChange(uiStore.setWindowFocused)
})

onUnmounted(() => {
  document.removeEventListener('visibilitychange', onVisibility)
  offWindowFocusChange?.()
})
</script>

<template>
  <div class="app-layout">
    <AppSidebar class="sidebar" />
    <div class="app-content">
      <AppTitleBar class="title-bar-row" />
      <div class="main">
        <router-view />
      </div>
    </div>
    <GroupVideoCallModal v-if="groupCallStore.showGroupCallDialog" />
    <SearchFriendDialog v-if="uiStore.showSearchFriendDialog" />
    <CreateGroup v-if="uiStore.showCreateGroupDialog" />
  </div>
</template>

<style scoped>
/* 侧边栏独占整窗左侧一列，标题栏只覆盖右侧内容区 */
.app-layout {
  display: flex;
  flex-direction: row;
  width: 100vw;
  height: 100vh;
  background: var(--bg-base);
  overflow: hidden;
}

.app-content {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
  overflow: hidden;
}

.title-bar-row { width: 100%; }

.sidebar { flex-shrink: 0; }
.main { flex: 1; min-height: 0; overflow: hidden; }
</style>
