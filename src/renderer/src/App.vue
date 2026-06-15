<script setup lang="ts">
import { darkTheme } from 'naive-ui'
import { computed, onMounted } from 'vue'
import { useThemeStore } from '@/stores/useThemeStore'

const themeStore = useThemeStore()
const theme = computed(() => themeStore.isDark ? darkTheme : null)

onMounted(() => themeStore.init())
</script>

<template>
  <n-config-provider :theme="theme" :theme-overrides="{ common: { primaryColor: '#5865f2', primaryColorHover: '#4752c4', primaryColorPressed: '#3b44af' } }">
    <n-message-provider>
      <n-dialog-provider>
        <router-view />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
