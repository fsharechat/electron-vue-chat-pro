import { describe, it, expect } from 'vitest'
import { classifyFiles, MAX_FILE_SIZE, MAX_ATTACHMENT_COUNT } from '@/utils/attachment'

// jsdom 里 new File([...]) 的 size 由内容长度决定，构造大文件不现实，
// 因此用 Object.defineProperty 伪造 size
function makeFile(name: string, size: number, type = 'application/octet-stream'): File {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('classifyFiles', () => {
  it('空输入返回空结果', () => {
    expect(classifyFiles([], 0)).toEqual({ accepted: [], oversize: [], overflow: 0 })
  })

  it('放行正常大小的文件', () => {
    const a = makeFile('a.pdf', 1024)
    const b = makeFile('b.zip', 2048)
    const r = classifyFiles([a, b], 0)
    expect(r.accepted).toEqual([a, b])
    expect(r.oversize).toEqual([])
    expect(r.overflow).toBe(0)
  })

  it('拒绝超过上限的文件并记录文件名', () => {
    const ok = makeFile('ok.pdf', 1024)
    const big = makeFile('big.mov', MAX_FILE_SIZE + 1)
    const r = classifyFiles([ok, big], 0)
    expect(r.accepted).toEqual([ok])
    expect(r.oversize).toEqual(['big.mov'])
  })

  it('正好等于上限的文件放行（边界不算超大）', () => {
    const edge = makeFile('edge.bin', MAX_FILE_SIZE)
    const r = classifyFiles([edge], 0)
    expect(r.accepted).toEqual([edge])
    expect(r.oversize).toEqual([])
  })

  it('按队列剩余额度截断，超出部分计入 overflow', () => {
    const files = Array.from({ length: 4 }, (_, i) => makeFile(`f${i}.txt`, 10))
    const r = classifyFiles(files, 7) // 已有 7 个，只剩 2 个额度
    expect(r.accepted).toHaveLength(2)
    expect(r.overflow).toBe(2)
  })

  it('队列已满时全部计入 overflow', () => {
    const files = [makeFile('a.txt', 10), makeFile('b.txt', 10)]
    const r = classifyFiles(files, MAX_ATTACHMENT_COUNT)
    expect(r.accepted).toEqual([])
    expect(r.overflow).toBe(2)
  })

  it('超大文件不占用数量额度', () => {
    const big = makeFile('big.mov', MAX_FILE_SIZE + 1)
    const ok = makeFile('ok.txt', 10)
    const r = classifyFiles([big, ok], MAX_ATTACHMENT_COUNT - 1)
    expect(r.accepted).toEqual([ok])
    expect(r.overflow).toBe(0)
  })
})
