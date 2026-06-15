<script setup lang="ts">
import { ref, computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useConversationStore } from '@/stores/useConversationStore'
import type { StateConversationInfo } from '@/types'
import SearchBar from '@/components/common/SearchBar.vue'
import ConversationItem from './ConversationItem.vue'

const convStore = useConversationStore()
const { searchedConversationList, selectTarget } = storeToRefs(convStore)

const menuVisible = ref(false)
const menuX = ref(0)
const menuY = ref(0)
const menuConv = ref<StateConversationInfo | null>(null)

const menuOptions = computed(() => {
  if (!menuConv.value) return []
  const isTop = menuConv.value.conversationInfo.isTop
  const isSilent = menuConv.value.conversationInfo.isSilent
  return [
    { label: isTop ? '取消置顶' : '置顶聊天', key: 'top' },
    { label: isSilent ? '取消免打扰' : '消息免打扰', key: 'silent' },
    { label: '删除会话', key: 'delete' },
  ]
})

function onConvContextMenu(e: MouseEvent, conv: StateConversationInfo) {
  menuX.value = e.clientX
  menuY.value = e.clientY
  menuConv.value = conv
  menuVisible.value = true
}

function onMenuSelect(key: string) {
  menuVisible.value = false
  const target = menuConv.value?.conversationInfo.target
  if (!target) return
  if (key === 'top') {
    menuConv.value!.conversationInfo.isTop ? convStore.unTopConversation(target) : convStore.topConversation(target)
  } else if (key === 'silent') {
    menuConv.value!.conversationInfo.isSilent ? convStore.unSilentConversation(target) : convStore.silentConversation(target)
  } else if (key === 'delete') {
    convStore.deleteConversation(target)
  }
}
</script>

<template>
  <div class="conv-list-panel">
    <div class="panel-header">
      <span class="panel-title">消息</span>
    </div>
    <SearchBar />
    <div class="list-scroll">
      <TransitionGroup name="list" tag="div">
        <ConversationItem
          v-for="conv in searchedConversationList"
          :key="conv.conversationInfo.target"
          :conversation="conv"
          :is-active="conv.conversationInfo.target === selectTarget"
          @context-menu="onConvContextMenu"
        />
      </TransitionGroup>

      <n-dropdown
        :show="menuVisible"
        :options="menuOptions"
        :x="menuX" :y="menuY"
        placement="bottom-start"
        @select="onMenuSelect"
        @clickoutside="menuVisible = false"
      />
      <div v-if="searchedConversationList.length === 0" class="empty-state">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted); margin-bottom: 8px">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <p>暂无会话</p>
      </div>
    </div>
  </div>
</template>

<style scoped>
.conv-list-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--bg-overlay);
}
.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 16px 10px;
  flex-shrink: 0;
}
.panel-title {
  font-family: var(--font-display);
  font-size: 16px;
  font-weight: 700;
  color: var(--text-primary);
  letter-spacing: -0.2px;
}
.list-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 4px 0;
}
.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
  color: var(--text-muted);
  font-size: 13px;
}

/* List transition */
.list-enter-active { transition: all 200ms var(--ease-out); }
.list-enter-from { opacity: 0; transform: translateY(-6px); }
</style>
