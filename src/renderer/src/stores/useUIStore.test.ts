import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('benz-amr-recorder', () => ({ default: vi.fn() }))

import { useUIStore } from './useUIStore'

describe('useUIStore isAppVisible', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('is true when document visible and window focused (defaults)', () => {
    const uiStore = useUIStore()
    expect(uiStore.isAppVisible).toBe(true)
  })

  it('is false when document is visible but the window lost OS focus', () => {
    // 模拟窗口未最小化/隐藏（document.visibilityState 仍为 visible），
    // 但被其他应用挡住失去了系统焦点 —— 这正是当前会话收不到通知的场景
    const uiStore = useUIStore()
    uiStore.visibilityChange('visible')
    uiStore.setWindowFocused(false)
    expect(uiStore.isAppVisible).toBe(false)
  })

  it('is false when document visibility is hidden even if focused', () => {
    const uiStore = useUIStore()
    uiStore.setWindowFocused(true)
    uiStore.visibilityChange('hidden')
    expect(uiStore.isAppVisible).toBe(false)
  })

  it('recovers to true once focus returns', () => {
    const uiStore = useUIStore()
    uiStore.setWindowFocused(false)
    expect(uiStore.isAppVisible).toBe(false)
    uiStore.setWindowFocused(true)
    expect(uiStore.isAppVisible).toBe(true)
  })
})
