import { ref } from 'vue'
import { defineStore } from 'pinia'

export type ThemeMode = 'system' | 'light' | 'dark'

const THEME_KEY = 'theme'
// 侧边栏按钮按此顺序循环切换
const MODE_CYCLE: ThemeMode[] = ['dark', 'light', 'system']

function readMode(): ThemeMode {
  const saved = localStorage.getItem(THEME_KEY)
  return saved === 'light' || saved === 'system' ? saved : 'dark'
}

export const useThemeStore = defineStore('theme', () => {
  const mode = ref<ThemeMode>(readMode())
  const isDark = ref(true)

  // Electron 渲染进程的 prefers-color-scheme 跟随 nativeTheme，默认即操作系统外观
  const media = typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)')
    : null

  function apply() {
    isDark.value = mode.value === 'system' ? (media?.matches ?? true) : mode.value === 'dark'
    document.documentElement.setAttribute('data-theme', isDark.value ? 'dark' : 'light')
  }

  function setMode(next: ThemeMode) {
    mode.value = next
    localStorage.setItem(THEME_KEY, next)
    apply()
  }

  function toggle() {
    const idx = MODE_CYCLE.indexOf(mode.value)
    setMode(MODE_CYCLE[(idx + 1) % MODE_CYCLE.length])
  }

  let listening = false
  function init() {
    mode.value = readMode()
    apply()
    if (media && !listening) {
      media.addEventListener('change', () => { if (mode.value === 'system') apply() })
      listening = true
    }
  }

  return { mode, isDark, setMode, toggle, init }
})
