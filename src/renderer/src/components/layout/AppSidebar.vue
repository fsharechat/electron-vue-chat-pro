<script setup lang="ts">
import { computed, ref } from 'vue'
import { useDialog } from 'naive-ui'
import { useRouter, useRoute } from 'vue-router'
import { storeToRefs } from 'pinia'
import { useAuthStore } from '@/stores/useAuthStore'
import { useUIStore } from '@/stores/useUIStore'
import { useThemeStore } from '@/stores/useThemeStore'
import { useConversationStore } from '@/stores/useConversationStore'
import { useFriendStore } from '@/stores/useFriendStore'
import PersonalCard from '@/components/common/PersonalCard.vue'
import AboutDialog from '@/components/common/AboutDialog.vue'
import SettingsDialog from '@/components/common/SettingsDialog.vue'
import AddTip from '@/components/common/AddTip.vue'
import UserAvatar from '@/components/common/UserAvatar.vue'

const router = useRouter()
const route = useRoute()
const authStore = useAuthStore()
const uiStore = useUIStore()
const themeStore = useThemeStore()
const convStore = useConversationStore()
const friendStore = useFriendStore()
const { user, userId } = storeToRefs(authStore)
const { onlineStatus, unreadTotalCount } = storeToRefs(uiStore)
const { newFriendRequestCount } = storeToRefs(friendStore)
const { mode: themeMode } = storeToRefs(themeStore)

const THEME_LABEL = { dark: '深色模式', light: '浅色模式', system: '跟随系统' } as const
const NEXT_THEME = { dark: 'light', light: 'system', system: 'dark' } as const
const themeTitle = computed(() =>
  `主题：${THEME_LABEL[themeMode.value]}（点击切换为${THEME_LABEL[NEXT_THEME[themeMode.value]]}）`)

const dialog = useDialog()
const showPersonalCard = ref(false)
const showAboutDialog = ref(false)
const showSettingsDialog = ref(false)
const showAddTip = ref(false)

const SEEN_VERSION_KEY = 'seen-changelog-version'
const hasNewVersion = ref(localStorage.getItem(SEEN_VERSION_KEY) !== __APP_VERSION__)

function openAbout() {
  showAboutDialog.value = true
  if (hasNewVersion.value) {
    localStorage.setItem(SEEN_VERSION_KEY, __APP_VERSION__)
    hasNewVersion.value = false
  }
}

function goConversation() { convStore.searchText = ''; router.push('/conversation') }
function goFriend() { convStore.searchText = ''; router.push('/friend') }

function loginOut() {
  dialog.warning({
    title: '退出登录',
    content: '确认退出当前账号吗？',
    positiveText: '退出',
    negativeText: '取消',
    onPositiveClick: () => {
      authStore.loginOut()
      router.push('/login')
    }
  })
}
</script>

<template>
  <div class="sidebar">
    <!-- Logo / Avatar -->
    <div class="avatar-wrap" @click="showPersonalCard = !showPersonalCard">
      <UserAvatar :src="user.img" :name="user.name" :size="38" />
      <span class="status-dot" :class="onlineStatus ? 'online' : 'offline'"></span>
    </div>
    <PersonalCard v-if="showPersonalCard" :user-id="userId" @close="showPersonalCard=false" />

    <!-- Divider -->
    <div class="divider"></div>

    <!-- Navigation -->
    <nav class="nav">
      <button
        class="nav-btn"
        :class="{ active: route.path.startsWith('/conversation') }"
        title="消息"
        @click="goConversation"
      >
        <span v-if="unreadTotalCount > 0" class="badge">{{ unreadTotalCount > 99 ? '99+' : unreadTotalCount }}</span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
      </button>

      <button
        class="nav-btn"
        :class="{ active: route.path.startsWith('/friend') }"
        title="好友"
        @click="goFriend"
      >
        <span v-if="newFriendRequestCount > 0" class="dot-badge"></span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
          <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
        </svg>
      </button>

      <div class="nav-add">
        <button class="nav-btn" title="添加" @click="showAddTip = !showAddTip">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
        <AddTip v-if="showAddTip" @close="showAddTip=false" />
      </div>
    </nav>

    <!-- Footer actions -->
    <footer class="footer">
      <button class="footer-btn" :title="themeTitle" @click="themeStore.toggle()">
        <svg v-if="themeMode === 'system'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>
        </svg>
        <svg v-else-if="themeMode === 'light'" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
          <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
        </svg>
        <svg v-else width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
        </svg>
      </button>
      <button class="footer-btn" title="设置" @click="showSettingsDialog = true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
      </button>
      <button class="footer-btn footer-btn--about" title="关于" @click="openAbout">
        <span v-if="hasNewVersion" class="dot-badge"></span>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>
        </svg>
      </button>
      <button class="footer-btn danger-btn" title="退出登录" @click="loginOut">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
          <polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
        </svg>
      </button>
    </footer>

    <AboutDialog v-if="showAboutDialog" @close="showAboutDialog=false" />
    <SettingsDialog v-if="showSettingsDialog" @close="showSettingsDialog=false" />
  </div>
</template>

<style scoped>
.sidebar {
  display: flex;
  flex-direction: column;
  align-items: center;
  width: 64px;
  height: 100%;
  background: var(--bg-sidebar);
  border-right: 1px solid var(--border);
  padding: 14px 0 12px;
  position: relative;
  flex-shrink: 0;
  /* 整条侧边栏充当窗口拖拽区 */
  -webkit-app-region: drag;
}

/* 拖拽区会吞掉鼠标事件，所有可交互元素必须显式排除；
   .nav-add / .personal-card 是弹层容器，子元素继承 no-drag */
.avatar-wrap,
.nav-btn,
.nav-add,
.footer-btn,
.sidebar :deep(.personal-card) {
  -webkit-app-region: no-drag;
}

/* ── Avatar ──────────────────────────────── */
.avatar-wrap {
  position: relative;
  cursor: pointer;
  border-radius: var(--radius-md);
  transition: transform var(--dur-normal) var(--ease-out);
}
.avatar-wrap:hover { transform: scale(1.05); }
.avatar {
  width: 38px;
  height: 38px;
  border-radius: var(--radius-md);
  object-fit: cover;
  border: 2px solid var(--border);
}
.status-dot {
  position: absolute;
  bottom: -3px;
  right: -3px;
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid var(--bg-sidebar);
}
/* 伪元素做涟漪，主元素保持静止；transform/opacity 仅走合成层，不触发 repaint */
.status-dot::after {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: 50%;
}
.online  { background: var(--color-online); }
.online::after  { background: var(--color-online); animation: pulse-online  2.5s ease-out infinite; }
.offline { background: var(--danger); }
.offline::after { background: var(--danger); animation: pulse-offline 2.5s ease-out infinite; }

/* ── Divider ─────────────────────────────── */
.divider {
  width: 32px;
  height: 1px;
  background: var(--border);
  margin: 14px 0;
  flex-shrink: 0;
}

/* ── Nav ─────────────────────────────────── */
.nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
}
.nav-add {
  position: relative;
}
.nav-btn {
  position: relative;
  width: 44px;
  height: 44px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-md);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--dur-normal), color var(--dur-normal);
}
.nav-btn::before {
  content: '';
  position: absolute;
  left: -10px;
  top: 50%;
  transform: translateY(-50%) scaleY(0);
  width: 3px;
  height: 20px;
  background: var(--accent);
  border-radius: 0 2px 2px 0;
  transition: transform var(--dur-normal) var(--ease-out);
}
.nav-btn:hover {
  background: var(--accent-subtle);
  color: var(--text-primary);
}
.nav-btn.active {
  background: var(--accent-subtle);
  color: var(--accent);
}
.nav-btn.active::before {
  transform: translateY(-50%) scaleY(1);
}
.dot-badge {
  position: absolute;
  top: 6px;
  right: 5px;
  width: 8px;
  height: 8px;
  background: var(--danger);
  border-radius: 50%;
  border: 1.5px solid var(--bg-sidebar);
}

.badge {
  position: absolute;
  top: 6px;
  right: 5px;
  min-width: 15px;
  height: 15px;
  padding: 0 3px;
  background: var(--danger);
  color: #fff;
  border-radius: var(--radius-pill);
  font-size: 9px;
  font-weight: 600;
  line-height: 15px;
  text-align: center;
  font-family: var(--font-mono);
}

/* ── Footer ──────────────────────────────── */
.footer {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding-top: 8px;
  border-top: 1px solid var(--border);
  width: 100%;
}
.footer-btn {
  width: 36px;
  height: 36px;
  border: none;
  background: transparent;
  color: var(--text-muted);
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background var(--dur-normal), color var(--dur-normal);
}
.footer-btn--about { position: relative; }
/* 亮色下 --bg-overlay 比侧边栏底色更浅，hover 会失效，统一用 accent-subtle */
.footer-btn:hover {
  background: var(--accent-subtle);
  color: var(--text-secondary);
}
.danger-btn:hover {
  background: rgba(248, 113, 113, 0.10);
  color: var(--danger);
}
</style>
