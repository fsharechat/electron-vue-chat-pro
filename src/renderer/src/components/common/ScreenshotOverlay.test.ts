import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ScreenshotOverlay from './ScreenshotOverlay.vue'

const mockElectronAPI = { writeImageToClipboard: vi.fn() }

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

  it('becomes visible when show=true', () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: true } })
    expect(wrapper.find('.screenshot-overlay').exists()).toBe(true)
  })

  it('starts in cropping phase — annotation toolbar not visible', () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: true } })
    expect(wrapper.find('.ann-toolbar').exists()).toBe(false)
  })

  it('emits cancel when ESC pressed in cropping phase', async () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: true } })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('does not emit cancel when show=false', async () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: false } })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cancel')).toBeFalsy()
  })

  it('transitions to annotating phase after a valid crop drag', async () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: true, screenshotSrc: 'data:image/png;base64,fake' } })
    await wrapper.vm.$nextTick()
    await wrapper.trigger('mousedown', { clientX: 10, clientY: 10 })
    await wrapper.trigger('mouseup', { clientX: 100, clientY: 100 })
    await wrapper.vm.$nextTick()
    // Annotation toolbar should now be visible
    expect(wrapper.find('.ann-toolbar').exists()).toBe(true)
  })

  it('does not transition to annotating when selection is zero-size', async () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: true } })
    await wrapper.trigger('mousedown', { clientX: 50, clientY: 50 })
    await wrapper.trigger('mouseup', { clientX: 50, clientY: 50 })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.ann-toolbar').exists()).toBe(false)
  })

  it('ESC in annotating phase returns to cropping (not emit cancel)', async () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: true, screenshotSrc: 'data:image/png;base64,fake' } })
    await wrapper.vm.$nextTick()
    await wrapper.trigger('mousedown', { clientX: 10, clientY: 10 })
    await wrapper.trigger('mouseup', { clientX: 100, clientY: 100 })
    await wrapper.vm.$nextTick()
    // Now in annotating phase
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cancel')).toBeFalsy()
    expect(wrapper.find('.ann-toolbar').exists()).toBe(false)
  })

  it('confirm in annotating phase emits done with a data URL', async () => {
    const OriginalImage = globalThis.Image
    class FakeImage {
      naturalWidth = 1920; naturalHeight = 1080
      onload: (() => void) | null = null
      set src(_: string) { this.onload?.() }
    }
    globalThis.Image = FakeImage as any

    const mockCtx = {
      clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '',
      strokeStyle: '', lineWidth: 1,
      strokeRect: vi.fn(), drawImage: vi.fn(),
      save: vi.fn(), restore: vi.fn(),
      beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as any)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,result')

    const wrapper = mount(ScreenshotOverlay, { props: { show: true, screenshotSrc: 'data:image/png;base64,fake' } })
    await wrapper.vm.$nextTick()
    await wrapper.trigger('mousedown', { clientX: 10, clientY: 10 })
    await wrapper.trigger('mouseup', { clientX: 100, clientY: 100 })
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-action="confirm"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('done')).toBeTruthy()
    expect((wrapper.emitted('done')![0] as string[])[0]).toMatch(/^data:image\/png/)

    globalThis.Image = OriginalImage
    vi.restoreAllMocks()
  })
})
