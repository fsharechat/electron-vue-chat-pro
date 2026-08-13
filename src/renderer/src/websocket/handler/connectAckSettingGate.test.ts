import { describe, it, expect } from 'vitest'
import { shouldPullUserSettings } from './connectackhandler'

describe('shouldPullUserSettings', () => {
  it('服务端更新则拉取', () => {
    expect(shouldPullUserSettings(200, 100)).toBe(true)
  })

  it('相等不拉取', () => {
    expect(shouldPullUserSettings(100, 100)).toBe(false)
  })

  it('服务端更旧不拉取', () => {
    expect(shouldPullUserSettings(50, 100)).toBe(false)
  })

  it('服务端没有任何设置（0）且本地也是 0，不白拉一次', () => {
    expect(shouldPullUserSettings(0, 0)).toBe(false)
  })

  it('新设备：本地 0、服务端有数据，要全量拉', () => {
    expect(shouldPullUserSettings(1786526758676, 0)).toBe(true)
  })

  it('旧服务端不下发 settingHead（undefined）时不拉取，也不报错', () => {
    expect(shouldPullUserSettings(undefined, 0)).toBe(false)
  })

  it('settingHead 是字符串时按数值比较', () => {
    // 服务端 JSON 里 head 类字段有以字符串下发的先例，容错处理
    expect(shouldPullUserSettings('200', 100)).toBe(true)
    expect(shouldPullUserSettings('50', 100)).toBe(false)
  })
})
