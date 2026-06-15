<script setup lang="ts">
import { ref } from 'vue'
import { storeToRefs } from 'pinia'
import { useFriendStore } from '@/stores/useFriendStore'
import { useUIStore } from '@/stores/useUIStore'
import { useAuthStore } from '@/stores/useAuthStore'
import { useMessage } from 'naive-ui'
import UserAvatar from '@/components/common/UserAvatar.vue'
import webSocketClient from '@/websocket/websocketcli'

const friendStore = useFriendStore()
const uiStore = useUIStore()
const authStore = useAuthStore()
const message = useMessage()
const { searchUsers } = storeToRefs(friendStore)
const { showSearchFriendDialog } = storeToRefs(uiStore)
const { user } = storeToRefs(authStore)

const searchText = ref('')
const searching = ref(false)
const sentSet = ref<Set<string>>(new Set())

// 确认弹窗状态
const pendingUser = ref<any>(null)
const greetingText = ref('')
const sending = ref(false)

async function search() {
  if (!searchText.value.trim()) return
  searching.value = true
  try {
    await (webSocketClient as any)._instance?.searchUser(searchText.value.trim())
  } catch { message.error('搜索失败') } finally {
    searching.value = false
  }
}

// 点击添加图标 → 弹出确认框
function openAddDialog(u: any) {
  pendingUser.value = u
  greetingText.value = '我是' + (user.value?.name || '')
}

function cancelAdd() {
  pendingUser.value = null
  greetingText.value = ''
}

async function confirmAdd() {
  if (!pendingUser.value) return
  sending.value = true
  try {
    await (webSocketClient as any)._instance?.sendFriendAddRequest({
      targetUserId: pendingUser.value.uid,
      reason: greetingText.value.trim() || ('我是' + (user.value?.name || pendingUser.value.uid))
    })
    sentSet.value.add(pendingUser.value.uid)
    message.success('好友请求已发送')
    cancelAdd()
  } catch { message.error('发送失败') } finally {
    sending.value = false
  }
}

function close() {
  showSearchFriendDialog.value = false
  searchText.value = ''
  sentSet.value = new Set()
  searchUsers.value = []
  cancelAdd()
}
</script>

<template>
  <!-- 搜索好友主弹窗 -->
  <div class="overlay" @click.self="close">
    <div class="dialog">
      <!-- 标题栏 -->
      <div class="dialog-header">
        <span class="dialog-title">添加好友</span>
        <button class="close-btn" @click="close">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
            <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>

      <!-- 搜索框 -->
      <div class="search-area">
        <div class="search-box">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16" class="search-icon">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input
            v-model="searchText"
            class="search-input"
            placeholder="输入手机号码，按Enter搜索"
            @keydown.enter="search"
          />
        </div>
      </div>

      <!-- 搜索结果 -->
      <div class="result-area">
        <div v-if="searching" class="empty-tip">搜索中...</div>

        <div v-else-if="searchUsers.length > 0">
          <div v-for="u in searchUsers" :key="u.uid" class="result-card">
            <UserAvatar :src="u.portrait" :name="u.displayName || u.uid" :size="48" />
            <div class="user-info">
              <span class="user-name">{{ u.displayName || u.uid }}</span>
              <span v-if="u.mobile" class="user-sub">{{ u.mobile }}</span>
              <span v-else-if="u.email" class="user-sub">{{ u.email }}</span>
            </div>
            <button
              class="add-btn"
              :class="{ sent: sentSet.has(u.uid) }"
              :disabled="sentSet.has(u.uid)"
              :title="sentSet.has(u.uid) ? '已发送请求' : '添加好友'"
              @click="openAddDialog(u)"
            >
              <svg v-if="!sentSet.has(u.uid)" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <line x1="19" y1="8" x2="19" y2="14"/>
                <line x1="22" y1="11" x2="16" y2="11"/>
              </svg>
              <svg v-else viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="22" height="22">
                <path d="M20 6L9 17l-5-5"/>
              </svg>
            </button>
          </div>
        </div>

        <div v-else-if="searchText" class="empty-tip">暂无搜索结果</div>
      </div>
    </div>

    <!-- 发送好友请求确认弹窗 -->
    <div v-if="pendingUser" class="confirm-overlay" @click.self="cancelAdd">
      <div class="confirm-dialog">
        <div class="confirm-header">
          <span class="confirm-title">添加好友</span>
          <button class="close-btn" @click="cancelAdd">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16">
              <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        <div class="confirm-body">
          <textarea
            v-model="greetingText"
            class="greeting-input"
            rows="4"
            maxlength="100"
            placeholder="请输入验证消息…"
          />
        </div>

        <div class="confirm-actions">
          <button class="action-btn cancel" @click="cancelAdd">取 消</button>
          <button class="action-btn confirm" :disabled="sending" @click="confirmAdd">确 定</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2000;
}

.dialog {
  background: var(--bg-surface);
  border-radius: 12px;
  width: 440px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  overflow: hidden;
}

/* ── 标题栏 ──────────────────────────────── */
.dialog-header {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 20px 0;
  position: relative;
}
.dialog-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}
.close-btn {
  position: absolute;
  right: 16px;
  top: 50%;
  transform: translateY(-50%);
  width: 28px;
  height: 28px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--dur-normal), color var(--dur-normal);
}
.close-btn:hover { background: var(--bg-elevated); color: var(--text-primary); }

/* ── 搜索框 ──────────────────────────────── */
.search-area { padding: 20px 20px 12px; }
.search-box {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 14px;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  transition: border-color var(--dur-normal);
}
.search-box:focus-within { border-color: var(--accent); }
.search-icon { color: var(--text-muted); flex-shrink: 0; }
.search-input {
  flex: 1;
  border: none;
  background: transparent;
  color: var(--text-primary);
  font-size: 14px;
  outline: none;
}
.search-input::placeholder { color: var(--text-muted); }

/* ── 结果区域 ────────────────────────────── */
.result-area {
  padding: 0 12px 16px;
  min-height: 80px;
  max-height: 360px;
  overflow-y: auto;
}
.empty-tip {
  text-align: center;
  padding: 24px 0;
  font-size: 13px;
  color: var(--text-muted);
}

/* ── 结果卡片 ────────────────────────────── */
.result-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 14px 8px;
  border-radius: 8px;
  background: var(--bg-elevated);
  margin-bottom: 6px;
}
.user-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.user-name {
  font-size: 15px;
  font-weight: 500;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.user-sub { font-size: 13px; color: var(--text-muted); }

/* ── 添加按钮 ────────────────────────────── */
.add-btn {
  width: 40px;
  height: 40px;
  border: none;
  background: transparent;
  cursor: pointer;
  border-radius: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  color: #07c160;
  transition: background var(--dur-normal);
}
.add-btn:hover:not(:disabled) { background: rgba(7, 193, 96, 0.1); }
.add-btn.sent { color: var(--text-muted); cursor: default; }

/* ── 确认弹窗 ────────────────────────────── */
.confirm-overlay {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
  border-radius: 12px;
}

.confirm-dialog {
  background: var(--bg-surface);
  border-radius: 12px;
  width: 380px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4);
  overflow: hidden;
}

.confirm-header {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px 20px 16px;
  position: relative;
}
.confirm-title {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
}

.confirm-body {
  padding: 0 20px 20px;
}
.greeting-input {
  width: 100%;
  box-sizing: border-box;
  padding: 12px;
  border: 1.5px solid var(--border);
  border-radius: 8px;
  background: var(--bg-elevated);
  color: var(--text-primary);
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  outline: none;
  font-family: inherit;
  transition: border-color var(--dur-normal);
}
.greeting-input:focus { border-color: var(--accent); }
.greeting-input::placeholder { color: var(--text-muted); }

.confirm-actions {
  display: flex;
  justify-content: center;
  gap: 16px;
  padding: 0 20px 24px;
}
.action-btn {
  padding: 9px 36px;
  border-radius: 24px;
  font-size: 14px;
  font-weight: 500;
  cursor: pointer;
  border: none;
  transition: all var(--dur-normal);
}
.action-btn.cancel {
  background: var(--bg-elevated);
  color: var(--text-secondary);
  border: 1px solid var(--border);
}
.action-btn.cancel:hover { background: var(--bg-overlay); }
.action-btn.confirm {
  background: rgba(7, 193, 96, 0.15);
  color: #07c160;
  border: 1px solid rgba(7, 193, 96, 0.3);
}
.action-btn.confirm:hover:not(:disabled) {
  background: rgba(7, 193, 96, 0.25);
}
.action-btn.confirm:disabled { opacity: 0.5; cursor: default; }
</style>
