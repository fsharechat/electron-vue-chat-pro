<script setup lang="ts">
import { darkTheme } from 'naive-ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useThemeStore } from '@/stores/useThemeStore'
import { useUIStore } from '@/stores/useUIStore'
import { KEY_VUE_USER_ID, KEY_VUE_TOKEN } from '@/constant'
import ScreenshotOverlay from '@/components/common/ScreenshotOverlay.vue'

const themeStore = useThemeStore()
const uiStore = useUIStore()
const theme = computed(() => themeStore.isDark ? darkTheme : null)

const showScreenshot = ref(false)
const screenshotSrc = ref('')
const screenshotOriginalBounds = ref<ScreenshotBounds | null>(null)
let unsubScreenshot: (() => void) | null = null
let unsubKbd: (() => void) | null = null

onMounted(() => {
  themeStore.init()
  // 告知主进程当前登录状态，让主进程在显示窗口前设好正确尺寸
  const isLoggedIn = !!(localStorage.getItem(KEY_VUE_USER_ID) && localStorage.getItem(KEY_VUE_TOKEN))
  window.electronAPI?.setLoggedIn(isLoggedIn)

  unsubScreenshot = window.electronAPI?.onTriggerScreenshot((data) => {
    screenshotSrc.value = data.screenshotDataUrl
    screenshotOriginalBounds.value = data.originalBounds
    showScreenshot.value = true
  }) ?? null

  unsubKbd = window.electronAPI?.onKbdScreenshot(() => {
    const hideWindow = localStorage.getItem('screenshot-hide-window') === 'true'
    window.electronAPI?.startScreenshot(hideWindow)
  }) ?? null
})

onUnmounted(() => {
  unsubScreenshot?.()
  unsubKbd?.()
})

function onScreenshotDone(dataUrl: string) {
  showScreenshot.value = false
  const bounds = screenshotOriginalBounds.value
  if (bounds) window.electronAPI?.screenshotDone(bounds)
  if (dataUrl) uiStore.pendingScreenshotDataUrl = dataUrl
  screenshotSrc.value = ''
  screenshotOriginalBounds.value = null
}

function onScreenshotCancel() {
  showScreenshot.value = false
  const bounds = screenshotOriginalBounds.value
  if (bounds) window.electronAPI?.screenshotCancel(bounds)
  screenshotSrc.value = ''
  screenshotOriginalBounds.value = null
}
</script>

<template>
  <n-config-provider :theme="theme" :theme-overrides="{ common: { primaryColor: '#5865f2', primaryColorHover: '#4752c4', primaryColorPressed: '#3b44af' } }">
    <n-message-provider>
      <n-dialog-provider>
        <router-view />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
  <ScreenshotOverlay
    :show="showScreenshot"
    :screenshot-src="screenshotSrc"
    @cancel="onScreenshotCancel"
    @done="onScreenshotDone"
  />
</template>
