import { describe, it, expect } from 'vitest'
import type { MenuItemConstructorOptions } from 'electron'
import { buildAppMenuTemplate } from '@main/utils/appMenu'

const submenuOf = (item: MenuItemConstructorOptions) => item.submenu as MenuItemConstructorOptions[]

describe('buildAppMenuTemplate', () => {
  it('top-level menus are in Chinese', () => {
    const labels = buildAppMenuTemplate('飞享IM', false).map((m) => m.label)
    expect(labels).toEqual(['飞享IM', '编辑', '显示', '窗口', '帮助'])
  })

  it('every role item has a Chinese label', () => {
    const walk = (items: MenuItemConstructorOptions[]): void => {
      for (const item of items) {
        if (item.type === 'separator') continue
        expect(item.label).toMatch(/[一-龥]/)
        if (Array.isArray(item.submenu)) walk(item.submenu)
      }
    }
    walk(buildAppMenuTemplate('飞享IM', true))
  })

  it('app menu uses app name for about/hide/quit', () => {
    const app = submenuOf(buildAppMenuTemplate('飞享IM', false)[0])
    expect(app.find((i) => i.role === 'quit')?.label).toBe('退出 飞享IM')
    expect(app.find((i) => i.role === 'about')?.label).toBe('关于 飞享IM')
  })

  it('dev tools only appear in dev mode', () => {
    const roles = (dev: boolean) => submenuOf(buildAppMenuTemplate('飞享IM', dev)[2]).map((i) => i.role)
    expect(roles(true)).toContain('toggleDevTools')
    expect(roles(false)).not.toContain('toggleDevTools')
  })
})
