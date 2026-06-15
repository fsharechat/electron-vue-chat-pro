<script setup lang="ts">
import { computed } from 'vue'
import { storeToRefs } from 'pinia'
import { useFriendStore } from '@/stores/useFriendStore'
import type { FriendInfo } from '@/types'
import UserAvatar from '@/components/common/UserAvatar.vue'

const friendStore = useFriendStore()
const { searchedFriendlist, selectFriendId, newFriendRequestCount } = storeToRefs(friendStore)

// 构建带分组头的渲染列表
const renderList = computed(() => {
  const items: Array<{ type: 'header'; label: string } | { type: 'friend'; friend: FriendInfo }> = []
  let lastInitial = ''

  for (const friend of searchedFriendlist.value) {
    if (friend.id === 0) {
      // 新的朋友特殊入口
      items.push({ type: 'friend', friend })
      continue
    }
    const initial = friend.initial || '#'
    if (initial !== lastInitial) {
      items.push({ type: 'header', label: initial })
      lastInitial = initial
    }
    items.push({ type: 'friend', friend })
  }
  return items
})

function selectFriend(friend: FriendInfo) {
  friendStore.selectFriendId = friend.id
}
</script>

<template>
  <div class="friend-list">
    <template v-for="(item, idx) in renderList" :key="idx">
      <!-- 字母分组标题 -->
      <div v-if="item.type === 'header'" class="initial-header">
        {{ item.label }}
      </div>

      <!-- 新的朋友 -->
      <div
        v-else-if="item.friend.id === 0"
        class="friend-item new-friend-item"
        :class="{ active: selectFriendId === 0 }"
        @click="friendStore.selectFriendId = 0"
      >
        <div class="new-friend-icon-wrap">
          <div class="new-friend-icon">
            <svg viewBox="0 0 24 24" fill="currentColor" width="22" height="22">
              <path d="M15 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm-9-2V7H4v3H1v2h3v3h2v-3h3v-2H6zm9 4c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
          </div>
          <span v-if="newFriendRequestCount > 0" class="req-dot"></span>
        </div>
        <span class="name">新的朋友</span>
      </div>

      <!-- 普通好友 -->
      <div
        v-else
        class="friend-item"
        :class="{ active: item.friend.id === selectFriendId }"
        @click="selectFriend(item.friend)"
      >
        <UserAvatar
          :src="item.friend.img"
          :name="item.friend.remark || item.friend.nickname"
          :size="38"
        />
        <div class="friend-info">
          <span class="name">{{ item.friend.remark || item.friend.nickname }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.friend-list {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 12px;
}

/* ── 字母分组标题 ─────────────────────────── */
.initial-header {
  padding: 10px 16px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--text-muted);
  letter-spacing: 0.5px;
}

/* ── 好友条目 ─────────────────────────────── */
.friend-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  margin: 1px 8px;
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: background var(--dur-normal);
}
.friend-item:hover { background: var(--bg-elevated); }
.friend-item.active { background: var(--accent-subtle); }

/* ── 新的朋友图标 ─────────────────────────── */
.new-friend-icon-wrap {
  position: relative;
  flex-shrink: 0;
}
.new-friend-icon {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-md);
  background: #f5a623;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
}
.req-dot {
  position: absolute;
  top: -2px;
  right: -2px;
  width: 9px;
  height: 9px;
  background: var(--danger);
  border-radius: 50%;
  border: 1.5px solid var(--bg-overlay);
}

/* ── 文字 ─────────────────────────────────── */
.friend-info {
  flex: 1;
  min-width: 0;
}
.name {
  font-size: 13.5px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
