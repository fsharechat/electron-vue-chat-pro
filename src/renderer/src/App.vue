<script setup lang="ts">
import { darkTheme } from 'naive-ui'
import { computed, nextTick, onMounted, onUnmounted, ref } from 'vue'
import { useThemeStore } from '@/stores/useThemeStore'
import { useUIStore } from '@/stores/useUIStore'
import { KEY_VUE_USER_ID, KEY_VUE_TOKEN } from '@/constant'
import ScreenshotOverlay from '@/components/common/ScreenshotOverlay.vue'

const isOverlay = new URLSearchParams(window.location.search).has('overlay')

// ── Overlay 模式（独立截图窗口） ─────────────────────────────────────
const showScreenshot = ref(false)
const screenshotSrc = ref('')

function onScreenshotDone(dataUrl: string) {
  showScreenshot.value = false
  window.electronAPI?.screenshotDone(dataUrl)
  screenshotSrc.value = ''
}

function onScreenshotCancel() {
  showScreenshot.value = false
  window.electronAPI?.screenshotCancel()
  screenshotSrc.value = ''
}

// ── 主窗口模式 ───────────────────────────────────────────────────────
const themeStore = isOverlay ? null : useThemeStore()
const uiStore = isOverlay ? null : useUIStore()
const theme = isOverlay ? null : computed(() => themeStore!.isDark ? darkTheme : null)

let unsubKbd: (() => void) | null = null
let unsubScreenshotResult: (() => void) | null = null
let unsubTrigger: (() => void) | null = null

// 兜底：文件被拖到落区之外时，阻止 Chromium 把应用页面导航成该文件。
// 主进程 will-navigate 在生产环境放行 file://，拦不住这种导航。
function preventWindowFileDrop(e: DragEvent): void {
  if (!Array.from(e.dataTransfer?.types ?? []).includes('Files')) return
  e.preventDefault()
}

onMounted(() => {
  window.addEventListener('dragover', preventWindowFileDrop)
  window.addEventListener('drop', preventWindowFileDrop)

  if (isOverlay) {
    // overlay 窗口：只监听截图数据
    unsubTrigger = window.electronAPI?.onTriggerScreenshot((data) => {
      showScreenshot.value = false
      nextTick(() => {
        screenshotSrc.value = data.screenshotDataUrl
        showScreenshot.value = true
      })
    }) ?? null
    return
  }

  // 主窗口：初始化主题、监听截图快捷键和截图结果
  themeStore!.init()
  const isLoggedIn = !!(localStorage.getItem(KEY_VUE_USER_ID) && localStorage.getItem(KEY_VUE_TOKEN))
  window.electronAPI?.setLoggedIn(isLoggedIn)

  unsubKbd = window.electronAPI?.onKbdScreenshot(() => {
    const hideWindow = localStorage.getItem('screenshot-hide-window') === 'true'
    window.electronAPI?.startScreenshot(hideWindow)
  }) ?? null

  unsubScreenshotResult = window.electronAPI?.onScreenshotResult((dataUrl) => {
    if (dataUrl) uiStore!.pendingScreenshotDataUrl = dataUrl
  }) ?? null
})

onUnmounted(() => {
  window.removeEventListener('dragover', preventWindowFileDrop)
  window.removeEventListener('drop', preventWindowFileDrop)
  unsubKbd?.()
  unsubScreenshotResult?.()
  unsubTrigger?.()
})
</script>

<template>
  <!-- overlay 窗口模式：只渲染截图组件 -->
  <template v-if="isOverlay">
    <ScreenshotOverlay
      :show="showScreenshot"
      :screenshot-src="screenshotSrc"
      @cancel="onScreenshotCancel"
      @done="onScreenshotDone"
    />
  </template>

  <!-- 主窗口模式：完整应用 -->
  <template v-else>
    <n-config-provider :theme="theme" :theme-overrides="{ common: { primaryColor: '#5865f2', primaryColorHover: '#4752c4', primaryColorPressed: '#3b44af' } }">
      <n-message-provider>
        <n-dialog-provider>
          <router-view />
        </n-dialog-provider>
      </n-message-provider>
    </n-config-provider>
  </template>
</template>
