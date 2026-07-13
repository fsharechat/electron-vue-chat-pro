import { describe, it, expect } from 'vitest'
import { buildOffsets, findIndexAt, visibleRange } from './virtualCore'

const keys10 = Array.from({ length: 10 }, (_, i) => `m${i}`)

describe('buildOffsets', () => {
  it('全部未测量时按估值累加', () => {
    const o = buildOffsets(keys10, new Map(), 100)
    expect(o).toHaveLength(11)
    expect(o[0]).toBe(0)
    expect(o[10]).toBe(1000)
  })
  it('已测量项用真实高度', () => {
    const heights = new Map([['m0', 40], ['m2', 300]])
    const o = buildOffsets(keys10, heights, 100)
    expect(o[1]).toBe(40)     // m0
    expect(o[2]).toBe(140)    // m0+m1(估值)
    expect(o[3]).toBe(440)    // +m2
  })
})

describe('findIndexAt', () => {
  const o = buildOffsets(keys10, new Map(), 100) // 每项 100
  it('边界与中间定位', () => {
    expect(findIndexAt(o, 0)).toBe(0)
    expect(findIndexAt(o, 99)).toBe(0)
    expect(findIndexAt(o, 100)).toBe(1)
    expect(findIndexAt(o, 999)).toBe(9)
  })
  it('越界钳制到最后一项', () => {
    expect(findIndexAt(o, 99999)).toBe(9)
  })
})

describe('visibleRange', () => {
  const o = buildOffsets(keys10, new Map(), 100)
  it('窗口含 overscan', () => {
    const r = visibleRange(o, 300, 200, 100) // 视口覆盖 300~500,overscan 后 200~600
    expect(r.start).toBe(2)
    expect(r.end).toBe(5)
    expect(r.top).toBe(200)
  })
  it('顶部不越界', () => {
    const r = visibleRange(o, 0, 200, 500)
    expect(r.start).toBe(0)
  })
  it('空列表', () => {
    expect(visibleRange([0], 0, 500, 100)).toEqual({ start: 0, end: -1, top: 0 })
  })
})
