<script setup lang="ts">
import { darkTheme } from 'naive-ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useThemeStore } from '@/stores/useThemeStore'
import ScreenshotOverlay from '@/components/common/ScreenshotOverlay.vue'

const themeStore = useThemeStore()
const theme = computed(() => themeStore.isDark ? darkTheme : null)

const showScreenshot = ref(false)
let unsubScreenshot: (() => void) | null = null

onMounted(() => {
  themeStore.init()
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
