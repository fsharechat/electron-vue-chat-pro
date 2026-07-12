import { describe, it, expect } from 'vitest'
import { fitImageBox } from './imageBox'

// 图片消息显示框:以缩略图自然尺寸按 200x200 约束算出后锁定,
// 原图加载后只换内容不改变框,避免气泡跳变
describe('fitImageBox', () => {
  it('小图不放大,按自然尺寸显示', () => {
    expect(fitImageBox(120, 90)).toEqual({ w: 120, h: 90 })
  })

  it('横图按宽度 200 等比缩放', () => {
    expect(fitImageBox(400, 300)).toEqual({ w: 200, h: 150 })
  })

  it('竖图按高度 200 等比缩放', () => {
    expect(fitImageBox(300, 600)).toEqual({ w: 100, h: 200 })
  })

  it('极端长条图不出现 0 尺寸', () => {
    const box = fitImageBox(4000, 10)
    expect(box.w).toBe(200)
    expect(box.h).toBeGreaterThanOrEqual(1)
  })
})
