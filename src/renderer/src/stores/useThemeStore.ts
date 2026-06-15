import { ref } from 'vue'
import { defineStore } from 'pinia'

export const useThemeStore = defineStore('theme', () => {
  const isDark = ref(localStorage.getItem('theme') !== 'light')

  function toggle() {
    isDark.value = !isDark.value
    const theme = isDark.value ? 'dark' : 'light'
    localStorage.setItem('theme', theme)
    document.documentElement.setAttribute('data-theme', theme)
  }

  function init() {
    const saved = localStorage.getItem('theme') ?? 'dark'
    isDark.value = saved !== 'light'
    document.documentElement.setAttribute('data-theme', saved)
  }

  return { isDark, toggle, init }
})
