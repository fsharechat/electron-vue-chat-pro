import { describe, it, expect, vi } from 'vitest'
import { useFileDrop } from '@/composables/useFileDrop'

// jsdom 没有可用的 DragEvent 构造器，直接造鸭子类型对象喂给 handler
function dragEvent(opts: {
  types?: string[]
  items?: Array<{ kind: string; file: File | null; isDirectory?: boolean; entryName?: string }>
  files?: File[]
} = {}): any {
  const { types = ['Files'], items, files = [] } = opts
  return {
    preventDefault: vi.fn(),
    dataTransfer: {
      types,
      files,
      items: items?.map(it => ({
        kind: it.kind,
        getAsFile: () => it.file,
        webkitGetAsEntry: () => ({ isDirectory: !!it.isDirectory, name: it.entryName ?? it.file?.name })
      }))
    }
  }
}

const txt = (name: string) => new File(['x'], name, { type: 'text/plain' })

describe('useFileDrop 拖拽状态', () => {
  it('嵌套子元素连续 enter/leave 不会让遮罩闪烁', () => {
    const { isDragging, dropHandlers } = useFileDrop(() => {})
    dropHandlers.dragenter(dragEvent())   // 进入落区
    dropHandlers.dragenter(dragEvent())   // 进入子元素
    expect(isDragging.value).toBe(true)
    dropHandlers.dragleave(dragEvent())   // 离开子元素，仍在落区内
    expect(isDragging.value).toBe(true)
    dropHandlers.dragleave(dragEvent())   // 真正离开落区
    expect(isDragging.value).toBe(false)
  })

  it('计数不会被多余的 leave 压成负数', () => {
    const { isDragging, dropHandlers } = useFileDrop(() => {})
    dropHandlers.dragleave(dragEvent())
    dropHandlers.dragenter(dragEvent())
    expect(isDragging.value).toBe(true)
    dropHandlers.dragleave(dragEvent())
    expect(isDragging.value).toBe(false)
  })

  it('拖拽的不是文件时不激活，也不阻止默认行为', () => {
    const { isDragging, dropHandlers } = useFileDrop(() => {})
    const e = dragEvent({ types: ['text/plain'] })
    dropHandlers.dragenter(e)
    expect(isDragging.value).toBe(false)
    expect(e.preventDefault).not.toHaveBeenCalled()
  })

  it('dragover 阻止默认行为，否则浏览器不会触发 drop', () => {
    const { dropHandlers } = useFileDrop(() => {})
    const e = dragEvent()
    dropHandlers.dragover(e)
    expect(e.preventDefault).toHaveBeenCalled()
  })

  it('drop 后状态归零并回调文件', () => {
    const onDrop = vi.fn()
    const { isDragging, dropHandlers } = useFileDrop(onDrop)
    const f = txt('a.txt')
    dropHandlers.dragenter(dragEvent())
    dropHandlers.drop(dragEvent({ items: [{ kind: 'file', file: f }] }))
    expect(isDragging.value).toBe(false)
    expect(onDrop).toHaveBeenCalledWith([f], [])
  })

  it('把文件夹分流到 folderNames，文件照常回调', () => {
    const onDrop = vi.fn()
    const { dropHandlers } = useFileDrop(onDrop)
    const f = txt('a.txt')
    const dirFile = txt('我的文档')
    dropHandlers.drop(dragEvent({
      items: [
        { kind: 'file', file: f },
        { kind: 'file', file: dirFile, isDirectory: true, entryName: '我的文档' }
      ]
    }))
    expect(onDrop).toHaveBeenCalledWith([f], ['我的文档'])
  })

  it('没有 items 时降级读 dataTransfer.files', () => {
    const onDrop = vi.fn()
    const { dropHandlers } = useFileDrop(onDrop)
    const f = txt('a.txt')
    dropHandlers.drop(dragEvent({ items: undefined, files: [f] }))
    expect(onDrop).toHaveBeenCalledWith([f], [])
  })

  it('drop 里没有任何文件时不触发回调', () => {
    const onDrop = vi.fn()
    const { dropHandlers } = useFileDrop(onDrop)
    dropHandlers.drop(dragEvent({ items: [] }))
    expect(onDrop).not.toHaveBeenCalled()
  })
})
