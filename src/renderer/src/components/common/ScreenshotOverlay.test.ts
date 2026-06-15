import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ScreenshotOverlay from './ScreenshotOverlay.vue'

const mockElectronAPI = {
  getScreenSources: vi.fn(),
  writeImageToClipboard: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  mockElectronAPI.getScreenSources.mockResolvedValue([])
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

  it('emits cancel when Escape key is pressed on window', async () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: true } })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('does not emit cancel on Escape when show is false', async () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: false } })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cancel')).toBeFalsy()
  })

  it('emits cancel when cancel button is clicked', async () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: true } })
    await wrapper.find('[data-action="cancel"]').trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('emits done on confirm click (no crop selected — early exit)', async () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: true } })
    await wrapper.find('[data-action="confirm"]').trigger('click')
    await new Promise(r => setTimeout(r, 0))
    expect(wrapper.emitted('done')).toBeTruthy()
    expect(mockElectronAPI.writeImageToClipboard).not.toHaveBeenCalled()
  })

  it('calls writeImageToClipboard and emits done when crop region and screen source exist', async () => {
    // Stub canvas getContext globally since jsdom does not implement it
    const mockDrawImage = vi.fn()
    const mockCtx = {
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      strokeRect: vi.fn(),
      drawImage: mockDrawImage,
    }
    const mockToDataURL = vi.fn(() => 'data:image/png;base64,fake')
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as any)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation(mockToDataURL)

    // Stub Image so onload fires synchronously after src is set
    const OriginalImage = globalThis.Image
    class FakeImage {
      onload: (() => void) | null = null
      set src(_: string) { this.onload?.() }
    }
    globalThis.Image = FakeImage as any

    const fakeThumbnail = 'data:image/png;base64,fake'
    mockElectronAPI.getScreenSources.mockResolvedValue([
      { id: 'screen:1', name: 'Screen 1', thumbnail: fakeThumbnail },
    ])

    const wrapper = mount(ScreenshotOverlay, { props: { show: true } })

    // Simulate a drag selection so hasCrop becomes true and w/h > 0
    await wrapper.trigger('mousedown', { clientX: 10, clientY: 10 })
    await wrapper.trigger('mouseup', { clientX: 100, clientY: 100 })

    await wrapper.find('[data-action="confirm"]').trigger('click')

    // Wait for getScreenSources promise to resolve
    await new Promise(r => setTimeout(r, 0))

    expect(mockElectronAPI.writeImageToClipboard).toHaveBeenCalled()
    expect(wrapper.emitted('done')).toBeTruthy()

    // Restore
    globalThis.Image = OriginalImage
    vi.restoreAllMocks()
  })
})
