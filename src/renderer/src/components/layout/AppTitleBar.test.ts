import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import AppTitleBar from './AppTitleBar.vue'

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

describe('AppTitleBar', () => {
  it('calls windowControl minimize on minimize button click', async () => {
    const wrapper = mount(AppTitleBar)
    await wrapper.find('[data-action="minimize"]').trigger('click')
    expect(mockElectronAPI.windowControl).toHaveBeenCalledWith('minimize')
  })

  it('calls windowControl maximize on maximize button click', async () => {
    const wrapper = mount(AppTitleBar)
    await wrapper.find('[data-action="maximize"]').trigger('click')
    expect(mockElectronAPI.windowControl).toHaveBeenCalledWith('maximize')
  })

  it('calls windowControl close on close button click', async () => {
    const wrapper = mount(AppTitleBar)
    await wrapper.find('[data-action="close"]').trigger('click')
    expect(mockElectronAPI.windowControl).toHaveBeenCalledWith('close')
  })
})
