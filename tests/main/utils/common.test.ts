import { describe, it, expect } from 'vitest'
import { WIN_SIZE_LOGIN, WIN_SIZE_MAIN } from '@main/utils/common'

describe('window size constants', () => {
  it('login window is 360x520', () => {
    expect(WIN_SIZE_LOGIN).toEqual({ width: 360, height: 520 })
  })

  it('main window is 1080x720', () => {
    expect(WIN_SIZE_MAIN).toEqual({ width: 1080, height: 720 })
  })

  it('main window is larger than login window', () => {
    expect(WIN_SIZE_MAIN.width).toBeGreaterThan(WIN_SIZE_LOGIN.width)
    expect(WIN_SIZE_MAIN.height).toBeGreaterThan(WIN_SIZE_LOGIN.height)
  })
})

describe('APP_NAME', () => {
  it('is the Chinese product name', async () => {
    const { APP_NAME } = await import('@main/utils/common')
    expect(APP_NAME).toBe('飞享IM')
  })
})
