import { describe, it, expect } from 'vitest'
import { classifyFiles, resolveAttachmentKind, MAX_FILE_SIZE, MAX_ATTACHMENT_COUNT } from '@/utils/attachment'

// jsdom 里 new File([...]) 的 size 由内容长度决定，构造大文件不现实，
// 因此用 Object.defineProperty 伪造 size
function makeFile(name: string, size: number, type = 'application/octet-stream'): File {
  const f = new File(['x'], name, { type })
  Object.defineProperty(f, 'size', { value: size })
  return f
}

describe('resolveAttachmentKind', () => {
  it('浏览器能解码的图片格式判为 image', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/bmp', 'image/avif']) {
      expect(resolveAttachmentKind(makeFile('a', 10, type))).toBe('image')
    }
  })

  it('HEIC 降级为 file —— iPhone 默认拍照格式，Chromium 无内置解码器', () => {
    expect(resolveAttachmentKind(makeFile('IMG_0001.heic', 10, 'image/heic'))).toBe('file')
    expect(resolveAttachmentKind(makeFile('IMG_0002.heif', 10, 'image/heif'))).toBe('file')
  })

  it('TIFF 等其他不可解码的 image/* 同样降级为 file', () => {
    expect(resolveAttachmentKind(makeFile('scan.tif', 10, 'image/tiff'))).toBe('file')
  })

  it('MIME 大小写不影响判定', () => {
    expect(resolveAttachmentKind(makeFile('a.JPG', 10, 'IMAGE/JPEG'))).toBe('image')
  })

  it('普通文件与空 type 判为 file', () => {
    expect(resolveAttachmentKind(makeFile('a.pdf', 10, 'application/pdf'))).toBe('file')
    expect(resolveAttachmentKind(makeFile('noext', 10, ''))).toBe('file')
  })
})

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
