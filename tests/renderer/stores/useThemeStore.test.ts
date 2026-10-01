import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useThemeStore } from '@/stores/useThemeStore'

let systemDark = false
let changeListener: (() => void) | null = null

function mockMatchMedia() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: vi.fn(() => ({
      get matches() { return systemDark },
      addEventListener: (_: string, cb: () => void) => { changeListener = cb }
    }))
  })
}

const dataTheme = () => document.documentElement.getAttribute('data-theme')

describe('useThemeStore', () => {
  beforeEach(() => {
    localStorage.clear()
    systemDark = false
    changeListener = null
    mockMatchMedia()
    setActivePinia(createPinia())
  })

  it('defaults to dark when nothing saved', () => {
    const store = useThemeStore()
    store.init()
    expect(store.mode).toBe('dark')
    expect(store.isDark).toBe(true)
    expect(dataTheme()).toBe('dark')
  })

  it('keeps legacy light preference', () => {
    localStorage.setItem('theme', 'light')
    const store = useThemeStore()
    store.init()
    expect(store.mode).toBe('light')
    expect(dataTheme()).toBe('light')
  })

  it('system mode follows OS appearance and reacts to changes', () => {
    localStorage.setItem('theme', 'system')
    const store = useThemeStore()
    store.init()
    expect(store.isDark).toBe(false)
    expect(dataTheme()).toBe('light')

    systemDark = true
    changeListener!()
    expect(store.isDark).toBe(true)
    expect(dataTheme()).toBe('dark')
  })

  it('ignores OS changes when mode is explicit', () => {
    const store = useThemeStore()
    store.init()
    store.setMode('light')
    systemDark = true
    changeListener!()
    expect(dataTheme()).toBe('light')
  })

  it('toggle cycles dark → light → system → dark and persists', () => {
    const store = useThemeStore()
    store.init()
    store.toggle()
    expect(store.mode).toBe('light')
    store.toggle()
    expect(store.mode).toBe('system')
    expect(localStorage.getItem('theme')).toBe('system')
    store.toggle()
    expect(store.mode).toBe('dark')
  })
})
