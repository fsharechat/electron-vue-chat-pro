<script setup lang="ts">
import { darkTheme } from 'naive-ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useThemeStore } from '@/stores/useThemeStore'
import { KEY_VUE_USER_ID, KEY_VUE_TOKEN } from '@/constant'
import ScreenshotOverlay from '@/components/common/ScreenshotOverlay.vue'

const themeStore = useThemeStore()
const theme = computed(() => themeStore.isDark ? darkTheme : null)

const showScreenshot = ref(false)
let unsubScreenshot: (() => void) | null = null

onMounted(() => {
  themeStore.init()
  // 告知主进程当前登录状态，让主进程在显示窗口前设好正确尺寸
  const isLoggedIn = !!(localStorage.getItem(KEY_VUE_USER_ID) && localStorage.getItem(KEY_VUE_TOKEN))
  window.electronAPI?.setLoggedIn(isLoggedIn)
  unsubScreenshot = window.electronAPI?.onTriggerScreenshot(() => {
    showScreenshot.value = true
  }) ?? null
})

onUnmounted(() => {
  unsubScreenshot?.()
})
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
    @cancel="showScreenshot = false"
    @done="showScreenshot = false"
  />
</template>
