import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ScreenshotOverlay from './ScreenshotOverlay.vue'

const mockElectronAPI = {
  windowControl: vi.fn(),
  setLoggedIn: vi.fn(),
  onIsLogged: vi.fn(() => vi.fn()),
  setFlashTray: vi.fn(),
  onTriggerScreenshot: vi.fn(() => vi.fn()),
  getScreenSources: vi.fn(),
  writeImageToClipboard: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'electronAPI', {
    value: mockElectronAPI,
    writable: true,
    configurable: true,
  })
})

describe('ScreenshotOverlay', () => {
  it('is not visible by default', () => {
    const wrapper = mount(ScreenshotOverlay)
    expect(wrapper.find('.screenshot-overlay').exists()).toBe(false)
  })

  it('becomes visible when show prop is true', async () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: true } })
    expect(wrapper.find('.screenshot-overlay').exists()).toBe(true)
  })

  it('emits cancel when Escape key is pressed', async () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: true } })
    await wrapper.trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('emits cancel when cancel button is clicked', async () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: true } })
    await wrapper.find('[data-action="cancel"]').trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('emits done on confirm click', async () => {
    mockElectronAPI.getScreenSources.mockResolvedValue([])
    const wrapper = mount(ScreenshotOverlay, { props: { show: true } })
    await wrapper.find('[data-action="confirm"]').trigger('click')
    // wait for promise
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.emitted('done')).toBeTruthy()
  })
})
