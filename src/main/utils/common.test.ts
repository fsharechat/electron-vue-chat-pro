import { describe, it, expect } from 'vitest'
import { WIN_SIZE_LOGIN, WIN_SIZE_MAIN } from './common'

describe('window size constants', () => {
  it('login window is 460x580', () => {
    expect(WIN_SIZE_LOGIN).toEqual({ width: 460, height: 580 })
  })

  it('main window is 1080x720', () => {
    expect(WIN_SIZE_MAIN).toEqual({ width: 1080, height: 720 })
  })

  it('main window is larger than login window', () => {
    expect(WIN_SIZE_MAIN.width).toBeGreaterThan(WIN_SIZE_LOGIN.width)
    expect(WIN_SIZE_MAIN.height).toBeGreaterThan(WIN_SIZE_LOGIN.height)
  })
})
