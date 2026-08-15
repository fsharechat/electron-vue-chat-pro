import { ref, type Ref } from 'vue'

type DropCallback = (files: File[], folderNames: string[]) => void

export interface FileDropApi {
  /** 是否正有文件悬停在落区上，用于显示遮罩 */
  isDragging: Ref<boolean>
  /** 直接 v-on="dropHandlers" 展开到落区元素 */
  dropHandlers: Record<string, (e: DragEvent) => void>
}

/** 拖拽的是否为文件（而非页面内选中的文本等） */
function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes('Files')
}

/**
 * 聊天区文件拖放。
 *
 * 用 depth 计数而非布尔量：在子元素之间移动会连续触发 dragleave/dragenter，
 * 布尔量会让遮罩疯狂闪烁。
 *
 * 文件夹在 DataTransfer.files 里 size 未必为 0（macOS 上是 inode 大小），
 * 只能靠 items 的 webkitGetAsEntry().isDirectory 精确识别。
 */
export function useFileDrop(onDrop: DropCallback): FileDropApi {
  const depth = ref(0)
  const isDragging = ref(false)

  function onDragEnter(e: DragEvent): void {
    if (!hasFiles(e)) return
    e.preventDefault()
    depth.value++
    isDragging.value = true
  }

  function onDragOver(e: DragEvent): void {
    if (!hasFiles(e)) return
    e.preventDefault() // 若不阻止默认行为，浏览器不会触发 drop
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
  }

  function onDragLeave(e: DragEvent): void {
    if (!hasFiles(e)) return
    e.preventDefault()
    depth.value = Math.max(0, depth.value - 1)
    if (depth.value === 0) isDragging.value = false
  }

  function onDropEvent(e: DragEvent): void {
    if (!hasFiles(e)) return
    e.preventDefault()
    depth.value = 0
    isDragging.value = false

    const dt = e.dataTransfer
    if (!dt) return

    const files: File[] = []
    const folderNames: string[] = []
    const items = dt.items

    if (items && items.length > 0) {
      for (let i = 0; i < items.length; i++) {
        const item = items[i]
        if (item.kind !== 'file') continue
        const entry = (item as any).webkitGetAsEntry?.()
        if (entry?.isDirectory) {
          folderNames.push(entry.name || '文件夹')
          continue
        }
        const file = item.getAsFile()
        if (!file) continue
        files.push(file)
      }
    } else {
      // webkitGetAsEntry 不可用时的降级路径
      files.push(...Array.from(dt.files ?? []))
    }

    if (files.length > 0 || folderNames.length > 0) onDrop(files, folderNames)
  }

  return {
    isDragging,
    dropHandlers: {
      dragenter: onDragEnter,
      dragover: onDragOver,
      dragleave: onDragLeave,
      drop: onDropEvent
    }
  }
}
