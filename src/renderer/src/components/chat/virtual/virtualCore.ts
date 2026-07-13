// 虚拟列表核心:前缀和 + 二分。全部纯函数,无 DOM 依赖。

/** offsets[i] = 前 i 项总高度;未测量的项按 estimate 估算 */
export function buildOffsets(keys: string[], heights: Map<string, number>, estimate: number): number[] {
  const offsets = new Array<number>(keys.length + 1)
  offsets[0] = 0
  for (let i = 0; i < keys.length; i++) {
    offsets[i + 1] = offsets[i] + (heights.get(keys[i]) ?? estimate)
  }
  return offsets
}

/** 二分:返回覆盖纵坐标 y 的项索引(最大的 i 使 offsets[i] <= y),钳制在 0..len-1 */
export function findIndexAt(offsets: number[], y: number): number {
  let lo = 0
  let hi = offsets.length - 1
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1
    if (offsets[mid] <= y) lo = mid
    else hi = mid - 1
  }
  return Math.min(lo, offsets.length - 2)
}

/** 可视窗口(含上下 overscan 像素);top 为渲染窗口在总内容中的绝对偏移 */
export function visibleRange(
  offsets: number[],
  scrollTop: number,
  viewport: number,
  overscan: number
): { start: number; end: number; top: number } {
  if (offsets.length <= 1) return { start: 0, end: -1, top: 0 }
  const start = findIndexAt(offsets, Math.max(0, scrollTop - overscan))
  const end = findIndexAt(offsets, scrollTop + viewport + overscan - 1)
  return { start, end, top: offsets[start] }
}
