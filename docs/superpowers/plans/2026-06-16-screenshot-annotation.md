# 截图标注功能 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在聊天工具栏增加带下拉开关的截图按钮，截图后提供矩形/箭头/文字/马赛克标注工具，确认后在输入框展示预览，用户手动点发送。

**Architecture:** 渲染层通过 `start-screenshot { hideWindow }` IPC 触发截图，主进程统一用 `desktopCapturer` 截全桌面（`hideWindow=true` 时先隐藏窗口）。`ScreenshotOverlay` 分两阶段（框选→标注），用 `bgCanvas`（背景截图+遮罩）+ `annotationCanvas`（透明标注层）双 Canvas 架构。标注纯函数抽取到 `annotationTools.ts`，工具栏提取为 `AnnotationToolbar.vue`。确认后截图经 `useUIStore.pendingScreenshotDataUrl` 传给 `MessageInput`，显示为可删除预览缩略图，用户点「发送」才发出。

**Tech Stack:** Electron `desktopCapturer`、Vue 3 `<script setup>`、HTML5 Canvas 2D API、Pinia、Vitest + `@vue/test-utils`

---

## 文件结构

**新建：**
- `src/renderer/src/components/common/annotationTools.ts` — 纯绘图函数（矩形、箭头、马赛克），无 Vue 依赖
- `src/renderer/src/components/common/annotationTools.test.ts` — 对应单元测试
- `src/renderer/src/components/common/AnnotationToolbar.vue` — 标注工具栏 UI 组件
- `src/renderer/src/components/common/AnnotationToolbar.test.ts` — 对应单元测试

**修改：**
- `src/main/index.ts` — 替换 `captureAndShowScreenshot` 为 `captureScreenshot(hideWindow)`；改快捷键为发 `kbd-screenshot` IPC；新增 `start-screenshot` 处理器
- `src/preload/index.ts` — 新增 `startScreenshot`、`onKbdScreenshot`；移除 `getScreenSources`
- `src/renderer/src/types/shims.d.ts` — 同步类型
- `src/renderer/src/App.vue` — 监听 `kbd-screenshot`，读 localStorage，回发 `start-screenshot`
- `src/renderer/src/components/common/ScreenshotOverlay.vue` — 重写为两阶段双 Canvas + 标注
- `src/renderer/src/components/common/ScreenshotOverlay.test.ts` — 更新测试
- `src/renderer/src/components/chat/MessageInput.vue` — 截图按钮 + 下拉开关 + 图片预览区

---

### Task 1: IPC 层重构

**Files:**
- Modify: `src/main/index.ts`
- Modify: `src/preload/index.ts`
- Modify: `src/renderer/src/types/shims.d.ts`

- [ ] **Step 1: 替换 main/index.ts 的截图函数**

找到并**删除** `captureAndShowScreenshot()` 函数（约 274-320 行），替换为：

```typescript
async function captureScreenshot(hideWindow: boolean): Promise<void> {
  if (!mainWindow) return
  const originalBounds = mainWindow.getBounds()

  if (hideWindow) {
    mainWindow.hide()
    await new Promise<void>(r => setTimeout(r, 150))
  }

  let screenshotDataUrl = ''
  try {
    const primaryDisplay = screen.getPrimaryDisplay()
    const { width, height } = primaryDisplay.bounds
    const scaleFactor = primaryDisplay.scaleFactor
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: Math.round(width * scaleFactor),
        height: Math.round(height * scaleFactor)
      }
    })
    if (sources.length > 0) screenshotDataUrl = sources[0].thumbnail.toDataURL()
  } catch (err) {
    console.warn('[screenshot] desktopCapturer failed:', err)
  }

  if (!screenshotDataUrl) {
    if (hideWindow) { mainWindow.show(); mainWindow.focus() }
    return
  }

  const primaryDisplay = screen.getPrimaryDisplay()
  const { x, y, width, height } = primaryDisplay.bounds
  mainWindow.setAlwaysOnTop(true, 'screen-saver')
  mainWindow.setBounds({ x, y, width, height })
  mainWindow.show()
  mainWindow.focus()

  mainWindow.webContents.send('trigger-screenshot', { screenshotDataUrl, originalBounds })
}
```

- [ ] **Step 2: 修改 registerScreenshotShortcut，改为发 kbd-screenshot IPC**

找到并替换 `registerScreenshotShortcut()` 函数：

```typescript
function registerScreenshotShortcut(): void {
  const ok = globalShortcut.register('Ctrl+Alt+Z', () => {
    mainWindow?.webContents.send('kbd-screenshot')
  })
  if (!ok) console.warn('[shortcut] Ctrl+Alt+Z could not be registered')
}
```

- [ ] **Step 3: 在 registerIPC() 中新增 start-screenshot 处理器**

在 `registerIPC()` 函数中，找到 `screenshot-done` 处理器前面，新增：

```typescript
ipcMain.on('start-screenshot', (_, { hideWindow }: { hideWindow: boolean }) => {
  captureScreenshot(hideWindow).catch(err => console.error('[screenshot]', err))
})
```

同时删除已不再使用的 `ipcMain.handle('get-screen-sources', ...)` 整块（约 204-219 行）。

- [ ] **Step 4: 更新 preload/index.ts**

将 `preload/index.ts` 的全部内容替换为：

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  windowControl: (action: 'minimize' | 'maximize' | 'close'): void =>
    ipcRenderer.send('window-control', action),

  setLoggedIn: (isLogged: boolean): void =>
    ipcRenderer.send('hasLogged', isLogged),

  onIsLogged: (cb: (v: boolean) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, v: boolean): void => cb(v)
    ipcRenderer.on('isLogged', handler)
    return () => ipcRenderer.removeListener('isLogged', handler)
  },

  setFlashTray: (flash: boolean): void =>
    ipcRenderer.send('hasFlashTray', flash),

  // 截图：渲染层主动触发，携带 hideWindow 参数
  startScreenshot: (hideWindow: boolean): void =>
    ipcRenderer.send('start-screenshot', { hideWindow }),

  // 键盘快捷键通知（主进程 → 渲染层）
  onKbdScreenshot: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('kbd-screenshot', handler)
    return () => ipcRenderer.removeListener('kbd-screenshot', handler)
  },

  onTriggerScreenshot: (cb: (data: { screenshotDataUrl: string; originalBounds: { x: number; y: number; width: number; height: number } }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { screenshotDataUrl: string; originalBounds: { x: number; y: number; width: number; height: number } }): void => cb(data)
    ipcRenderer.on('trigger-screenshot', handler)
    return () => ipcRenderer.removeListener('trigger-screenshot', handler)
  },

  screenshotDone: (originalBounds: { x: number; y: number; width: number; height: number }): void =>
    ipcRenderer.send('screenshot-done', originalBounds),

  screenshotCancel: (originalBounds: { x: number; y: number; width: number; height: number }): void =>
    ipcRenderer.send('screenshot-cancel', originalBounds),

  writeImageToClipboard: (dataUrl: string): void =>
    ipcRenderer.send('write-clipboard', dataUrl),

  showSaveDialog: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('show-save-dialog', defaultName),

  startFileDownload: (url: string, savePath: string, downloadId: string): void =>
    ipcRenderer.send('start-file-download', { url, savePath, downloadId }),

  onFileDownloadProgress: (cb: (data: { downloadId: string; percent: number }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { downloadId: string; percent: number }): void => cb(data)
    ipcRenderer.on('file-download-progress', handler)
    return () => ipcRenderer.removeListener('file-download-progress', handler)
  },

  onFileDownloadDone: (cb: (data: { downloadId: string; error?: string }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { downloadId: string; error?: string }): void => cb(data)
    ipcRenderer.on('file-download-done', handler)
    return () => ipcRenderer.removeListener('file-download-done', handler)
  },
})
```

- [ ] **Step 5: 更新 shims.d.ts**

将 `src/renderer/src/types/shims.d.ts` 中的 `ElectronAPI` interface 替换为：

```typescript
interface ScreenshotBounds {
  x: number
  y: number
  width: number
  height: number
}

interface ElectronAPI {
  windowControl(action: 'minimize' | 'maximize' | 'close'): void
  setLoggedIn(isLogged: boolean): void
  onIsLogged(cb: (v: boolean) => void): () => void
  setFlashTray(flash: boolean): void
  startScreenshot(hideWindow: boolean): void
  onKbdScreenshot(cb: () => void): () => void
  onTriggerScreenshot(cb: (data: { screenshotDataUrl: string; originalBounds: ScreenshotBounds }) => void): () => void
  screenshotDone(originalBounds: ScreenshotBounds): void
  screenshotCancel(originalBounds: ScreenshotBounds): void
  writeImageToClipboard(dataUrl: string): void
  showSaveDialog(defaultName: string): Promise<string | null>
  startFileDownload(url: string, savePath: string, downloadId: string): void
  onFileDownloadProgress(cb: (data: { downloadId: string; percent: number }) => void): () => void
  onFileDownloadDone(cb: (data: { downloadId: string; error?: string }) => void): () => void
}

interface Window {
  electronAPI?: ElectronAPI
}
```

- [ ] **Step 6: 运行测试确认 IPC 层无破坏**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20 && npm test
```

期望：所有现有测试通过（ScreenshotOverlay 相关测试可能 fail，下一步修）。

- [ ] **Step 7: Commit**

```bash
git add src/main/index.ts src/preload/index.ts src/renderer/src/types/shims.d.ts
git commit -m "refactor: unify screenshot IPC — start-screenshot{hideWindow} + kbd-screenshot relay"
```

---

### Task 2: App.vue 处理键盘快捷键

**Files:**
- Modify: `src/renderer/src/App.vue`

- [ ] **Step 1: 更新 App.vue**

将 `src/renderer/src/App.vue` 的 `<script setup>` 完全替换为：

```typescript
<script setup lang="ts">
import { darkTheme } from 'naive-ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useThemeStore } from '@/stores/useThemeStore'
import { useUIStore } from '@/stores/useUIStore'
import { KEY_VUE_USER_ID, KEY_VUE_TOKEN } from '@/constant'
import ScreenshotOverlay from '@/components/common/ScreenshotOverlay.vue'

const themeStore = useThemeStore()
const uiStore = useUIStore()
const theme = computed(() => themeStore.isDark ? darkTheme : null)

const showScreenshot = ref(false)
const screenshotSrc = ref('')
const screenshotOriginalBounds = ref<{ x: number; y: number; width: number; height: number } | null>(null)
let unsubScreenshot: (() => void) | null = null
let unsubKbd: (() => void) | null = null

onMounted(() => {
  themeStore.init()
  const isLoggedIn = !!(localStorage.getItem(KEY_VUE_USER_ID) && localStorage.getItem(KEY_VUE_TOKEN))
  window.electronAPI?.setLoggedIn(isLoggedIn)

  unsubScreenshot = window.electronAPI?.onTriggerScreenshot((data) => {
    screenshotSrc.value = data.screenshotDataUrl
    screenshotOriginalBounds.value = data.originalBounds
    showScreenshot.value = true
  }) ?? null

  // 键盘快捷键：主进程通知渲染层，渲染层读 localStorage 并回发 start-screenshot
  unsubKbd = window.electronAPI?.onKbdScreenshot(() => {
    const hideWindow = localStorage.getItem('screenshot-hide-window') === 'true'
    window.electronAPI?.startScreenshot(hideWindow)
  }) ?? null
})

onUnmounted(() => {
  unsubScreenshot?.()
  unsubKbd?.()
})

function onScreenshotDone(dataUrl: string) {
  showScreenshot.value = false
  const bounds = screenshotOriginalBounds.value
  if (bounds) window.electronAPI?.screenshotDone(bounds)
  if (dataUrl) uiStore.pendingScreenshotDataUrl = dataUrl
  screenshotSrc.value = ''
  screenshotOriginalBounds.value = null
}

function onScreenshotCancel() {
  showScreenshot.value = false
  const bounds = screenshotOriginalBounds.value
  if (bounds) window.electronAPI?.screenshotCancel(bounds)
  screenshotSrc.value = ''
  screenshotOriginalBounds.value = null
}
</script>
```

template 不变，只确认 ScreenshotOverlay 的事件绑定：

```html
<ScreenshotOverlay
  :show="showScreenshot"
  :screenshot-src="screenshotSrc"
  @cancel="onScreenshotCancel"
  @done="onScreenshotDone"
/>
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/App.vue
git commit -m "feat: relay kbd-screenshot from main to renderer, read hideWindow from localStorage"
```

---

### Task 3: annotationTools.ts — 纯绘图函数

**Files:**
- Create: `src/renderer/src/components/common/annotationTools.ts`
- Create: `src/renderer/src/components/common/annotationTools.test.ts`

- [ ] **Step 1: 先写失败测试**

创建 `src/renderer/src/components/common/annotationTools.test.ts`：

```typescript
import { describe, it, expect, vi } from 'vitest'
import { drawRect, drawArrow, applyMosaic } from './annotationTools'

function makeCtx() {
  return {
    save: vi.fn(), restore: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    closePath: vi.fn(), stroke: vi.fn(), fill: vi.fn(),
    strokeRect: vi.fn(), drawImage: vi.fn(),
    strokeStyle: '', fillStyle: '', lineWidth: 1,
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D
}

describe('drawRect', () => {
  it('normalises coordinates and calls strokeRect', () => {
    const ctx = makeCtx()
    drawRect(ctx, 50, 80, 10, 20, '#ff0000')
    // x=min(50,10)=10, y=min(80,20)=20, w=|50-10|=40, h=|80-20|=60
    expect(ctx.strokeRect).toHaveBeenCalledWith(10, 20, 40, 60)
  })

  it('sets strokeStyle to the given color', () => {
    const ctx = makeCtx()
    drawRect(ctx, 0, 0, 100, 100, '#123456')
    expect(ctx.strokeStyle).toBe('#123456')
  })
})

describe('drawArrow', () => {
  it('calls stroke for the line and fill for the arrowhead', () => {
    const ctx = makeCtx()
    drawArrow(ctx, 0, 0, 100, 0, '#ff0000')
    expect(ctx.stroke).toHaveBeenCalled()
    expect(ctx.fill).toHaveBeenCalled()
  })

  it('draws from (x1,y1) to (x2,y2)', () => {
    const ctx = makeCtx()
    drawArrow(ctx, 10, 20, 90, 80, '#ff0000')
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 20)
    expect(ctx.lineTo).toHaveBeenCalledWith(90, 80)
  })
})

describe('applyMosaic', () => {
  it('draws into ctx using a small temp canvas', () => {
    const ctx = makeCtx()
    const mockBg = { naturalWidth: 1920, naturalHeight: 1080 } as HTMLImageElement
    // Should not throw and should call drawImage at least twice (shrink + expand)
    applyMosaic(ctx, mockBg, 100, 100, 200, 100, 960, 540)
    expect(ctx.drawImage).toHaveBeenCalled()
  })

  it('does nothing when w or h is 0', () => {
    const ctx = makeCtx()
    const mockBg = { naturalWidth: 1920, naturalHeight: 1080 } as HTMLImageElement
    applyMosaic(ctx, mockBg, 0, 0, 0, 100, 960, 540)
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/renderer/src/components/common/annotationTools.test.ts
```

期望：`Cannot find module './annotationTools'`。

- [ ] **Step 3: 实现 annotationTools.ts**

创建 `src/renderer/src/components/common/annotationTools.ts`：

```typescript
export function drawRect(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, lineWidth = 2
): void {
  const x = Math.min(x1, x2)
  const y = Math.min(y1, y2)
  const w = Math.abs(x2 - x1)
  const h = Math.abs(y2 - y1)
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.strokeRect(x, y, w, h)
  ctx.restore()
}

export function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, lineWidth = 2
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = lineWidth

  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()

  const angle = Math.atan2(y2 - y1, x2 - x1)
  const headLen = Math.max(12, lineWidth * 5)
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6)
  )
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6)
  )
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

export function applyMosaic(
  ctx: CanvasRenderingContext2D,
  bgImage: HTMLImageElement,
  x: number, y: number, w: number, h: number,
  canvasW: number, canvasH: number,
  blockSize = 12
): void {
  if (w <= 0 || h <= 0) return
  const scaleX = bgImage.naturalWidth / canvasW
  const scaleY = bgImage.naturalHeight / canvasH

  const tmp = document.createElement('canvas')
  const scaledW = Math.max(1, Math.round(w / blockSize))
  const scaledH = Math.max(1, Math.round(h / blockSize))
  tmp.width = scaledW
  tmp.height = scaledH
  const tmpCtx = tmp.getContext('2d')!
  tmpCtx.imageSmoothingEnabled = false
  tmpCtx.drawImage(bgImage, x * scaleX, y * scaleY, w * scaleX, h * scaleY, 0, 0, scaledW, scaledH)

  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tmp, 0, 0, scaledW, scaledH, x, y, w, h)
  ctx.imageSmoothingEnabled = true
  ctx.restore()
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/renderer/src/components/common/annotationTools.test.ts
```

期望：5 个测试全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/common/annotationTools.ts src/renderer/src/components/common/annotationTools.test.ts
git commit -m "feat: add pure annotation drawing functions — drawRect, drawArrow, applyMosaic"
```

---

### Task 4: AnnotationToolbar.vue 组件

**Files:**
- Create: `src/renderer/src/components/common/AnnotationToolbar.vue`
- Create: `src/renderer/src/components/common/AnnotationToolbar.test.ts`

- [ ] **Step 1: 先写失败测试**

创建 `src/renderer/src/components/common/AnnotationToolbar.test.ts`：

```typescript
import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AnnotationToolbar from './AnnotationToolbar.vue'

describe('AnnotationToolbar', () => {
  it('highlights the active tool button', () => {
    const wrapper = mount(AnnotationToolbar, {
      props: { activeTool: 'rect', activeColor: '#f5222d', canUndo: false }
    })
    expect(wrapper.find('[data-tool="rect"]').classes()).toContain('active')
    expect(wrapper.find('[data-tool="arrow"]').classes()).not.toContain('active')
  })

  it('emits selectTool when a tool button is clicked', async () => {
    const wrapper = mount(AnnotationToolbar, {
      props: { activeTool: null, activeColor: '#f5222d', canUndo: false }
    })
    await wrapper.find('[data-tool="arrow"]').trigger('click')
    expect(wrapper.emitted('selectTool')?.[0]).toEqual(['arrow'])
  })

  it('emits selectColor when a color dot is clicked', async () => {
    const wrapper = mount(AnnotationToolbar, {
      props: { activeTool: null, activeColor: '#f5222d', canUndo: false }
    })
    await wrapper.find('[data-color="#1890ff"]').trigger('click')
    expect(wrapper.emitted('selectColor')?.[0]).toEqual(['#1890ff'])
  })

  it('undo button is disabled when canUndo is false', () => {
    const wrapper = mount(AnnotationToolbar, {
      props: { activeTool: null, activeColor: '#f5222d', canUndo: false }
    })
    expect(wrapper.find('[data-action="undo"]').attributes('disabled')).toBeDefined()
  })

  it('emits undo when undo button clicked and canUndo is true', async () => {
    const wrapper = mount(AnnotationToolbar, {
      props: { activeTool: null, activeColor: '#f5222d', canUndo: true }
    })
    await wrapper.find('[data-action="undo"]').trigger('click')
    expect(wrapper.emitted('undo')).toBeTruthy()
  })

  it('emits cancel and confirm from action buttons', async () => {
    const wrapper = mount(AnnotationToolbar, {
      props: { activeTool: null, activeColor: '#f5222d', canUndo: false }
    })
    await wrapper.find('[data-action="cancel"]').trigger('click')
    await wrapper.find('[data-action="confirm"]').trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
    expect(wrapper.emitted('confirm')).toBeTruthy()
  })
})
```

- [ ] **Step 2: 运行测试确认失败**

```bash
npm test -- src/renderer/src/components/common/AnnotationToolbar.test.ts
```

期望：`Cannot find module './AnnotationToolbar.vue'`。

- [ ] **Step 3: 实现 AnnotationToolbar.vue**

创建 `src/renderer/src/components/common/AnnotationToolbar.vue`：

```vue
<script setup lang="ts">
export type AnnotationTool = 'rect' | 'arrow' | 'text' | 'mosaic'

const COLORS = ['#f5222d', '#fa8c16', '#fadb14', '#52c41a', '#1890ff', '#722ed1', '#ffffff', '#000000']

defineProps<{
  activeTool: AnnotationTool | null
  activeColor: string
  canUndo: boolean
}>()

const emit = defineEmits<{
  selectTool: [tool: AnnotationTool]
  selectColor: [color: string]
  undo: []
  save: []
  cancel: []
  confirm: []
}>()
</script>

<template>
  <div class="ann-toolbar" @click.stop>
    <!-- 工具 -->
    <div class="ann-group">
      <button :class="['ann-btn', { active: activeTool === 'rect' }]" data-tool="rect" title="矩形" @click="emit('selectTool', 'rect')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="1"/></svg>
      </button>
      <button :class="['ann-btn', { active: activeTool === 'arrow' }]" data-tool="arrow" title="箭头" @click="emit('selectTool', 'arrow')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="5" y1="19" x2="19" y2="5"/><polyline points="9 5 19 5 19 15"/></svg>
      </button>
      <button :class="['ann-btn', { active: activeTool === 'text' }]" data-tool="text" title="文字" @click="emit('selectTool', 'text')">
        <span style="font-size:14px;font-weight:700">T</span>
      </button>
      <button :class="['ann-btn', { active: activeTool === 'mosaic' }]" data-tool="mosaic" title="马赛克" @click="emit('selectTool', 'mosaic')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="2" width="9" height="9"/><rect x="13" y="2" width="9" height="9"/><rect x="2" y="13" width="9" height="9"/><rect x="13" y="13" width="9" height="9"/></svg>
      </button>
    </div>

    <div class="ann-divider" />

    <!-- 颜色 -->
    <div class="ann-group ann-colors">
      <button
        v-for="c in COLORS"
        :key="c"
        class="color-dot"
        :class="{ selected: activeColor === c }"
        :data-color="c"
        :style="{ background: c, outline: c === '#ffffff' ? '1px solid #aaa' : 'none' }"
        :title="c"
        @click="emit('selectColor', c)"
      />
    </div>

    <div class="ann-divider" />

    <!-- 操作 -->
    <div class="ann-group">
      <button class="ann-btn" data-action="undo" title="撤销" :disabled="!canUndo" @click="emit('undo')">↺</button>
      <button class="ann-btn" data-action="save" title="保存到本地" @click="emit('save')">⬇</button>
      <button class="ann-btn ann-btn--cancel" data-action="cancel" title="取消" @click="emit('cancel')">✕</button>
      <button class="ann-btn ann-btn--confirm" data-action="confirm" title="确认" @click="emit('confirm')">✓</button>
    </div>
  </div>
</template>

<style scoped>
.ann-toolbar {
  position: absolute;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10001;
  display: flex;
  align-items: center;
  gap: 6px;
  background: rgba(30, 30, 40, 0.92);
  border-radius: 8px;
  padding: 8px 12px;
  box-shadow: 0 4px 20px rgba(0,0,0,0.5);
  backdrop-filter: blur(8px);
  user-select: none;
}

.ann-group { display: flex; align-items: center; gap: 4px; }

.ann-divider { width: 1px; height: 20px; background: rgba(255,255,255,0.2); margin: 0 4px; }

.ann-btn {
  width: 30px; height: 30px;
  border: none; border-radius: 5px;
  background: transparent;
  color: #e0e0e0;
  cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  font-size: 16px;
  transition: background 120ms;
}
.ann-btn:hover { background: rgba(255,255,255,0.15); }
.ann-btn.active { background: #1890ff; color: #fff; }
.ann-btn:disabled { opacity: 0.35; cursor: default; pointer-events: none; }
.ann-btn--cancel:hover { background: rgba(255,77,79,0.7); }
.ann-btn--confirm { background: #1890ff; color: #fff; }
.ann-btn--confirm:hover { background: #40a9ff; }

.ann-colors { gap: 5px; }
.color-dot {
  width: 18px; height: 18px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 120ms;
}
.color-dot:hover { transform: scale(1.2); }
.color-dot.selected { border-color: #fff; transform: scale(1.15); }
</style>
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/renderer/src/components/common/AnnotationToolbar.test.ts
```

期望：6 个测试全部通过。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/components/common/AnnotationToolbar.vue src/renderer/src/components/common/AnnotationToolbar.test.ts
git commit -m "feat: add AnnotationToolbar component with rect/arrow/text/mosaic tools and color picker"
```

---

### Task 5: ScreenshotOverlay.vue 重写

**Files:**
- Modify: `src/renderer/src/components/common/ScreenshotOverlay.vue`
- Modify: `src/renderer/src/components/common/ScreenshotOverlay.test.ts`

此任务完整重写组件，同步更新测试。

- [ ] **Step 1: 先更新测试（TDD）**

将 `ScreenshotOverlay.test.ts` 全部替换为：

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import ScreenshotOverlay from './ScreenshotOverlay.vue'

const mockElectronAPI = { writeImageToClipboard: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'electronAPI', { value: mockElectronAPI, writable: true, configurable: true })
})

describe('ScreenshotOverlay', () => {
  it('is not visible by default', () => {
    const wrapper = mount(ScreenshotOverlay)
    expect(wrapper.find('.screenshot-overlay').exists()).toBe(false)
  })

  it('becomes visible when show=true', () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: true } })
    expect(wrapper.find('.screenshot-overlay').exists()).toBe(true)
  })

  it('starts in cropping phase — annotation toolbar not visible', () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: true } })
    expect(wrapper.find('.ann-toolbar').exists()).toBe(false)
  })

  it('emits cancel when ESC pressed in cropping phase', async () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: true } })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('does not emit cancel when show=false', async () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: false } })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cancel')).toBeFalsy()
  })

  it('transitions to annotating phase after a valid crop drag', async () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: true, screenshotSrc: 'data:image/png;base64,fake' } })
    await wrapper.vm.$nextTick()
    await wrapper.trigger('mousedown', { clientX: 10, clientY: 10 })
    await wrapper.trigger('mouseup', { clientX: 100, clientY: 100 })
    await wrapper.vm.$nextTick()
    // Annotation toolbar should now be visible
    expect(wrapper.find('.ann-toolbar').exists()).toBe(true)
  })

  it('does not transition to annotating when selection is zero-size', async () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: true } })
    await wrapper.trigger('mousedown', { clientX: 50, clientY: 50 })
    await wrapper.trigger('mouseup', { clientX: 50, clientY: 50 })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.ann-toolbar').exists()).toBe(false)
  })

  it('ESC in annotating phase returns to cropping (not emit cancel)', async () => {
    const wrapper = mount(ScreenshotOverlay, { props: { show: true, screenshotSrc: 'data:image/png;base64,fake' } })
    await wrapper.vm.$nextTick()
    await wrapper.trigger('mousedown', { clientX: 10, clientY: 10 })
    await wrapper.trigger('mouseup', { clientX: 100, clientY: 100 })
    await wrapper.vm.$nextTick()
    // Now in annotating phase
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()
    expect(wrapper.emitted('cancel')).toBeFalsy()
    expect(wrapper.find('.ann-toolbar').exists()).toBe(false)
  })

  it('confirm in annotating phase emits done with a data URL', async () => {
    const OriginalImage = globalThis.Image
    class FakeImage {
      naturalWidth = 1920; naturalHeight = 1080
      onload: (() => void) | null = null
      set src(_: string) { this.onload?.() }
    }
    globalThis.Image = FakeImage as any

    const mockCtx = {
      clearRect: vi.fn(), fillRect: vi.fn(), fillStyle: '',
      strokeStyle: '', lineWidth: 1,
      strokeRect: vi.fn(), drawImage: vi.fn(),
      save: vi.fn(), restore: vi.fn(),
      beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(),
    }
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(mockCtx as any)
    vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockReturnValue('data:image/png;base64,result')

    const wrapper = mount(ScreenshotOverlay, { props: { show: true, screenshotSrc: 'data:image/png;base64,fake' } })
    await wrapper.vm.$nextTick()
    await wrapper.trigger('mousedown', { clientX: 10, clientY: 10 })
    await wrapper.trigger('mouseup', { clientX: 100, clientY: 100 })
    await wrapper.vm.$nextTick()

    await wrapper.find('[data-action="confirm"]').trigger('click')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('done')).toBeTruthy()
    expect((wrapper.emitted('done')![0] as string[])[0]).toMatch(/^data:image\/png/)

    globalThis.Image = OriginalImage
    vi.restoreAllMocks()
  })
})
```

- [ ] **Step 2: 运行测试确认失败（预期）**

```bash
npm test -- src/renderer/src/components/common/ScreenshotOverlay.test.ts
```

期望：多项测试失败（`ann-toolbar` not found，phase 逻辑不存在）。

- [ ] **Step 3: 重写 ScreenshotOverlay.vue**

将 `src/renderer/src/components/common/ScreenshotOverlay.vue` 全部内容替换为：

```vue
<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, nextTick } from 'vue'
import AnnotationToolbar, { type AnnotationTool } from './AnnotationToolbar.vue'
import { drawRect, drawArrow, applyMosaic } from './annotationTools'

const props = withDefaults(
  defineProps<{ show?: boolean; screenshotSrc?: string }>(),
  { show: false, screenshotSrc: '' }
)
const emit = defineEmits<{ cancel: []; done: [dataUrl: string] }>()

// ── Canvas refs ──────────────────────────────────────────────────
const bgCanvasRef = ref<HTMLCanvasElement | null>(null)
const annotationCanvasRef = ref<HTMLCanvasElement | null>(null)
const textInputRef = ref<HTMLInputElement | null>(null)

// ── Phase & background ──────────────────────────────────────────
type Phase = 'cropping' | 'annotating'
const phase = ref<Phase>('cropping')
let bgImage: HTMLImageElement | null = null
let alive = true

// ── Phase 1: crop selection ──────────────────────────────────────
const isDrawing = ref(false)
const startX = ref(0), startY = ref(0), endX = ref(0), endY = ref(0)

// ── Phase 2: annotation ──────────────────────────────────────────
const activeTool = ref<AnnotationTool | null>('rect')
const activeColor = ref('#f5222d')
const undoStack: ImageData[] = []
let toolDrawing = false
let toolStartX = 0, toolStartY = 0
let previewSnapshot: ImageData | null = null

// ── Text tool ────────────────────────────────────────────────────
const isTextEditing = ref(false)
const textPos = ref({ x: 0, y: 0 })
const textValue = ref('')

// ── Drawing: background canvas ───────────────────────────────────
function drawBg(): void {
  const canvas = bgCanvasRef.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return

  ctx.clearRect(0, 0, canvas.width, canvas.height)
  if (bgImage) ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height)

  ctx.fillStyle = 'rgba(0,0,0,0.4)'
  ctx.fillRect(0, 0, canvas.width, canvas.height)

  const x = Math.min(startX.value, endX.value)
  const y = Math.min(startY.value, endY.value)
  const w = Math.abs(endX.value - startX.value)
  const h = Math.abs(endY.value - startY.value)

  if (w > 0 && h > 0) {
    ctx.save()
    ctx.beginPath()
    ctx.rect(x, y, w, h)
    ctx.clip()
    ctx.clearRect(x, y, w, h)
    if (bgImage) ctx.drawImage(bgImage, 0, 0, canvas.width, canvas.height)
    ctx.restore()
    ctx.strokeStyle = '#1890ff'
    ctx.lineWidth = 2
    ctx.strokeRect(x, y, w, h)
  }
}

function resizeCanvases(): void {
  const bg = bgCanvasRef.value
  const ann = annotationCanvasRef.value
  if (bg) { bg.width = window.innerWidth; bg.height = window.innerHeight }
  if (ann) { ann.width = window.innerWidth; ann.height = window.innerHeight }
  drawBg()
}

// ── Phase 1: mouse handlers ───────────────────────────────────────
function onCropMousedown(e: MouseEvent): void {
  isDrawing.value = true
  startX.value = e.clientX; startY.value = e.clientY
  endX.value = e.clientX; endY.value = e.clientY
  drawBg()
}

function onCropMousemove(e: MouseEvent): void {
  if (!isDrawing.value) return
  endX.value = e.clientX; endY.value = e.clientY
  drawBg()
}

function onCropMouseup(e: MouseEvent): void {
  if (!isDrawing.value) return
  isDrawing.value = false
  endX.value = e.clientX; endY.value = e.clientY
  drawBg()
  const w = Math.abs(endX.value - startX.value)
  const h = Math.abs(endY.value - startY.value)
  if (w > 4 && h > 4) {
    phase.value = 'annotating'
    clearAnnotation()
  }
}

// ── Phase 2: annotation helpers ───────────────────────────────────
function getAnnCtx(): CanvasRenderingContext2D | null {
  return annotationCanvasRef.value?.getContext('2d') ?? null
}

function clearAnnotation(): void {
  const ann = annotationCanvasRef.value
  if (!ann) return
  getAnnCtx()?.clearRect(0, 0, ann.width, ann.height)
  undoStack.length = 0
}

function saveUndoSnapshot(): void {
  const ann = annotationCanvasRef.value
  const ctx = getAnnCtx()
  if (!ann || !ctx) return
  previewSnapshot = ctx.getImageData(0, 0, ann.width, ann.height)
}

function pushUndo(): void {
  if (previewSnapshot) undoStack.push(previewSnapshot)
}

function handleUndo(): void {
  const ctx = getAnnCtx()
  const ann = annotationCanvasRef.value
  if (!ctx || !ann || undoStack.length === 0) return
  const snap = undoStack.pop()!
  ctx.putImageData(snap, 0, 0)
  previewSnapshot = null
}

// ── Phase 2: mouse handlers ────────────────────────────────────────
function onAnnMousedown(e: MouseEvent): void {
  if (activeTool.value === 'text') return // handled by click
  toolDrawing = true
  toolStartX = e.clientX; toolStartY = e.clientY
  saveUndoSnapshot()
}

function onAnnMousemove(e: MouseEvent): void {
  if (!toolDrawing) return
  const ctx = getAnnCtx()
  const ann = annotationCanvasRef.value
  if (!ctx || !ann || !previewSnapshot) return
  // Restore to pre-draw state for clean preview
  ctx.putImageData(previewSnapshot, 0, 0)
  const tool = activeTool.value
  if (tool === 'rect') {
    drawRect(ctx, toolStartX, toolStartY, e.clientX, e.clientY, activeColor.value)
  } else if (tool === 'arrow') {
    drawArrow(ctx, toolStartX, toolStartY, e.clientX, e.clientY, activeColor.value)
  } else if (tool === 'mosaic' && bgImage) {
    const x = Math.min(toolStartX, e.clientX)
    const y = Math.min(toolStartY, e.clientY)
    const w = Math.abs(e.clientX - toolStartX)
    const h = Math.abs(e.clientY - toolStartY)
    // Preview: light overlay for mosaic region
    ctx.save(); ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x, y, w, h); ctx.restore()
  }
}

function onAnnMouseup(e: MouseEvent): void {
  if (!toolDrawing) return
  toolDrawing = false
  const ctx = getAnnCtx()
  const ann = annotationCanvasRef.value
  if (!ctx || !ann) return
  if (previewSnapshot) ctx.putImageData(previewSnapshot, 0, 0)
  const tool = activeTool.value
  if (tool === 'rect') {
    pushUndo()
    drawRect(ctx, toolStartX, toolStartY, e.clientX, e.clientY, activeColor.value)
  } else if (tool === 'arrow') {
    pushUndo()
    drawArrow(ctx, toolStartX, toolStartY, e.clientX, e.clientY, activeColor.value)
  } else if (tool === 'mosaic' && bgImage) {
    pushUndo()
    const x = Math.min(toolStartX, e.clientX)
    const y = Math.min(toolStartY, e.clientY)
    const w = Math.abs(e.clientX - toolStartX)
    const h = Math.abs(e.clientY - toolStartY)
    applyMosaic(ctx, bgImage, x, y, w, h, ann.width, ann.height)
  }
  previewSnapshot = null
}

function onOverlayClick(e: MouseEvent): void {
  if (phase.value !== 'annotating' || activeTool.value !== 'text') return
  textPos.value = { x: e.clientX, y: e.clientY }
  textValue.value = ''
  isTextEditing.value = true
  nextTick(() => textInputRef.value?.focus())
}

function commitText(): void {
  if (!textValue.value.trim()) { isTextEditing.value = false; return }
  const ctx = getAnnCtx()
  if (!ctx) { isTextEditing.value = false; return }
  saveUndoSnapshot()
  pushUndo()
  ctx.save()
  ctx.font = '18px sans-serif'
  ctx.fillStyle = activeColor.value
  ctx.fillText(textValue.value, textPos.value.x, textPos.value.y + 18)
  ctx.restore()
  isTextEditing.value = false
  textValue.value = ''
}

// ── Composite output ─────────────────────────────────────────────
function getComposited(): string {
  const bg = bgCanvasRef.value
  const ann = annotationCanvasRef.value
  if (!bg) return ''
  const x = Math.min(startX.value, endX.value)
  const y = Math.min(startY.value, endY.value)
  const w = Math.abs(endX.value - startX.value)
  const h = Math.abs(endY.value - startY.value)
  if (w === 0 || h === 0) return ''

  const dpr = window.devicePixelRatio || 1
  const out = document.createElement('canvas')
  out.width = w * dpr
  out.height = h * dpr
  const ctx = out.getContext('2d')!

  if (bgImage) {
    const sx = bgImage.naturalWidth / bg.width
    const sy = bgImage.naturalHeight / bg.height
    ctx.drawImage(bgImage, x * sx, y * sy, w * sx, h * sy, 0, 0, out.width, out.height)
  }
  if (ann) ctx.drawImage(ann, x, y, w, h, 0, 0, out.width, out.height)

  return out.toDataURL('image/png')
}

// ── Toolbar actions ───────────────────────────────────────────────
function handleConfirm(): void {
  const dataUrl = getComposited()
  if (dataUrl) window.electronAPI?.writeImageToClipboard(dataUrl)
  emit('done', dataUrl)
}

function handleSave(): void {
  const dataUrl = getComposited()
  if (!dataUrl) return
  const [header, b64] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/png'
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const blob = new Blob([bytes], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = `screenshot-${Date.now()}.png`
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function handleCancel(): void {
  // Return to cropping phase for re-selection
  phase.value = 'cropping'
  clearAnnotation()
  drawBg()
}

// ── Keyboard ──────────────────────────────────────────────────────
function onWindowKeydown(e: KeyboardEvent): void {
  if (!props.show) return
  if (e.key === 'Escape') {
    if (isTextEditing.value) { isTextEditing.value = false; return }
    if (phase.value === 'annotating') { handleCancel(); return }
    emit('cancel')
  }
}

// ── Watchers ──────────────────────────────────────────────────────
watch(() => props.show, (v) => {
  if (v) {
    phase.value = 'cropping'
    isDrawing.value = false
    clearAnnotation()
    nextTick(resizeCanvases)
  } else {
    bgImage = null
  }
})

watch(() => props.screenshotSrc, (src) => {
  if (!src) { bgImage = null; return }
  const img = new Image()
  img.onload = () => { if (!alive) return; bgImage = img; drawBg() }
  img.src = src
}, { immediate: true })

// ── Lifecycle ─────────────────────────────────────────────────────
onMounted(() => {
  window.addEventListener('keydown', onWindowKeydown)
  window.addEventListener('resize', resizeCanvases)
})
onUnmounted(() => {
  alive = false
  window.removeEventListener('keydown', onWindowKeydown)
  window.removeEventListener('resize', resizeCanvases)
})

// ── Mouse event router ────────────────────────────────────────────
function onMousedown(e: MouseEvent): void {
  if (phase.value === 'cropping') onCropMousedown(e)
  else onAnnMousedown(e)
}
function onMousemove(e: MouseEvent): void {
  if (phase.value === 'cropping') onCropMousemove(e)
  else onAnnMousemove(e)
}
function onMouseup(e: MouseEvent): void {
  if (phase.value === 'cropping') onCropMouseup(e)
  else onAnnMouseup(e)
}
</script>

<template>
  <div
    v-if="show"
    class="screenshot-overlay"
    @mousedown.prevent="onMousedown"
    @mousemove="onMousemove"
    @mouseup="onMouseup"
    @click="onOverlayClick"
  >
    <canvas ref="bgCanvasRef" class="ss-canvas" />
    <canvas ref="annotationCanvasRef" class="ss-canvas" />

    <!-- 文字工具输入框 -->
    <input
      v-if="isTextEditing"
      ref="textInputRef"
      v-model="textValue"
      class="text-tool-input"
      :style="{ left: textPos.x + 'px', top: textPos.y + 'px', color: activeColor }"
      @blur="commitText"
      @keydown.enter.prevent="commitText"
      @click.stop
    />

    <AnnotationToolbar
      v-if="phase === 'annotating'"
      :active-tool="activeTool"
      :active-color="activeColor"
      :can-undo="undoStack.length > 0"
      @select-tool="t => activeTool = t"
      @select-color="c => activeColor = c"
      @undo="handleUndo"
      @save="handleSave"
      @cancel="handleCancel"
      @confirm="handleConfirm"
    />
  </div>
</template>

<style scoped>
.screenshot-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  cursor: crosshair;
}

.ss-canvas {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
}

.text-tool-input {
  position: absolute;
  background: transparent;
  border: 1px dashed rgba(255,255,255,0.6);
  font-size: 18px;
  font-family: sans-serif;
  min-width: 80px;
  outline: none;
  padding: 2px 4px;
  z-index: 10001;
  caret-color: currentColor;
}
</style>
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- src/renderer/src/components/common/ScreenshotOverlay.test.ts
```

期望：9 个测试全部通过。

- [ ] **Step 5: 运行全部测试**

```bash
npm test
```

期望：全部通过。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/src/components/common/ScreenshotOverlay.vue src/renderer/src/components/common/ScreenshotOverlay.test.ts
git commit -m "feat: rewrite ScreenshotOverlay with two-phase cropping→annotation and dual canvas"
```

---

### Task 6: MessageInput.vue — 截图按钮 + 图片预览

**Files:**
- Modify: `src/renderer/src/components/chat/MessageInput.vue`

- [ ] **Step 1: 更新 imports，添加 onUnmounted**

将文件第一行替换为：

```typescript
import { ref, computed, nextTick, watch, onUnmounted } from 'vue'
```

- [ ] **Step 2: 添加截图相关 state 和函数**

在 `const { emojis, userInfoList, pendingScreenshotDataUrl } = storeToRefs(uiStore)` 这行后面，将**现有的 `pendingScreenshotDataUrl` watcher 整块删除**，替换为以下全部新增代码：

```typescript
// ── 截图按钮下拉 ────────────────────────────────────────────────
const hideWindow = ref(localStorage.getItem('screenshot-hide-window') === 'true')
const showScreenshotMenu = ref(false)

function triggerScreenshot(): void {
  showScreenshotMenu.value = false
  window.electronAPI?.startScreenshot(hideWindow.value)
}

function toggleHideWindow(): void {
  hideWindow.value = !hideWindow.value
  localStorage.setItem('screenshot-hide-window', String(hideWindow.value))
  showScreenshotMenu.value = false
}

function closeScreenshotMenu(e: MouseEvent): void {
  if (!(e.target as HTMLElement).closest?.('.screenshot-btn-group')) {
    showScreenshotMenu.value = false
  }
}

onMounted(() => document.addEventListener('click', closeScreenshotMenu))
onUnmounted(() => document.removeEventListener('click', closeScreenshotMenu))

// ── 图片预览 ────────────────────────────────────────────────────
interface PendingImage { file: File; url: string }
const pendingImage = ref<PendingImage | null>(null)

function setPendingImage(file: File): void {
  if (pendingImage.value) URL.revokeObjectURL(pendingImage.value.url)
  pendingImage.value = { file, url: URL.createObjectURL(file) }
}

function clearPendingImage(): void {
  if (pendingImage.value) {
    URL.revokeObjectURL(pendingImage.value.url)
    pendingImage.value = null
  }
}

onUnmounted(() => { if (pendingImage.value) URL.revokeObjectURL(pendingImage.value.url) })

// 截图确认后 → 进入预览（不自动发送）
watch(pendingScreenshotDataUrl, (dataUrl) => {
  if (!dataUrl) return
  uiStore.pendingScreenshotDataUrl = ''
  const [header, b64] = dataUrl.split(',')
  const mime = header.match(/:(.*?);/)?.[1] ?? 'image/png'
  const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
  const file = new File([bytes], `screenshot-${Date.now()}.png`, { type: mime })
  setPendingImage(file)
})
```

注意：上面使用了 `onMounted`，确认文件顶部 import 里已有 `onMounted`（MessageInput.vue 已有）。如果没有，在 vue import 行补上。

- [ ] **Step 3: 更新 onPaste — 粘贴图片进预览**

找到现有 `onPaste` 函数，替换为：

```typescript
function onPaste(e: ClipboardEvent) {
  const items = e.clipboardData?.items
  if (!items) return
  for (const item of Array.from(items)) {
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const blob = item.getAsFile()
      if (blob && blob.size > 0) {
        const file = new File([blob], `paste-${Date.now()}.png`, { type: blob.type })
        setPendingImage(file)
        break
      }
    }
  }
}
```

- [ ] **Step 4: 更新 send() — 先发图片再发文字**

找到现有 `send()` 函数，替换为：

```typescript
async function send() {
  const hasText = !!content.value.trim()
  const hasImage = !!pendingImage.value
  if (!hasText && !hasImage) { message.warning('不能发送空白信息'); return }
  try {
    if (hasImage) {
      const file = pendingImage.value!.file
      clearPendingImage()
      await sendImage(file)
    }
    if (hasText) {
      const { mentionedType, mentionedTargets } = extractMentions()
      const mc = new TextMessageContent(content.value, mentionedType, mentionedTargets)
      buildAndSend(mc)
      content.value = ''
    }
    showAtMenu.value = false
    textareaRef.value?.focus()
  } catch (e) { console.error('Send failed', e) }
}
```

- [ ] **Step 5: 更新 sendBtnActive**

找到：
```typescript
const sendBtnActive = computed(() => content.value.trim().length > 0)
```

替换为：
```typescript
const sendBtnActive = computed(() => content.value.trim().length > 0 || !!pendingImage.value)
```

- [ ] **Step 6: 更新 template — 工具栏 + 预览区**

在 `<template>` 的工具栏区域，找到表情按钮 `<n-popover>` 块结束后（`</n-popover>` 之后），现有图片按钮 `<label class="tool-btn" title="发送图片">` 之前，插入截图按钮组：

```html
<!-- 截图按钮 -->
<div class="screenshot-btn-group tool-btn-group">
  <button class="tool-btn" title="截图" @click.stop="triggerScreenshot">
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/>
      <line x1="20" y1="4" x2="8.12" y2="15.88"/>
      <line x1="14.47" y1="14.48" x2="20" y2="20"/>
      <line x1="8.12" y1="8.12" x2="12" y2="12"/>
    </svg>
  </button>
  <button class="tool-btn tool-btn-chevron" title="截图选项" @click.stop="showScreenshotMenu = !showScreenshotMenu">
    <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg>
  </button>
  <div v-if="showScreenshotMenu" class="screenshot-menu">
    <div class="screenshot-menu-item" @click.stop="toggleHideWindow">
      <span class="screenshot-menu-check">{{ hideWindow ? '✓' : '' }}</span>
      隐藏当前窗口
    </div>
  </div>
</div>
```

然后在 `<!-- Text area -->` 注释上方（textarea 之前），插入预览区：

```html
<!-- 图片预览 -->
<div v-if="pendingImage" class="pending-preview">
  <div class="pending-item">
    <img :src="pendingImage.url" class="pending-thumb" alt="待发图片" />
    <button class="pending-remove" title="移除" @click="clearPendingImage">×</button>
  </div>
</div>
```

- [ ] **Step 7: 在 <style scoped> 末尾追加 CSS**

```css
/* 截图按钮组 */
.tool-btn-group {
  position: relative;
  display: flex;
  align-items: center;
}
.tool-btn-chevron {
  width: 14px !important;
  padding: 0 !important;
  color: var(--text-muted);
}
.screenshot-menu {
  position: absolute;
  bottom: calc(100% + 6px);
  left: 0;
  background: var(--bg-float, #2a2a3a);
  border: 1px solid var(--border);
  border-radius: var(--radius-md);
  box-shadow: 0 4px 16px var(--shadow);
  min-width: 140px;
  z-index: 500;
  padding: 4px 0;
}
.screenshot-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 14px;
  font-size: 13px;
  color: var(--text-primary);
  cursor: pointer;
}
.screenshot-menu-item:hover { background: var(--bg-elevated); }
.screenshot-menu-check {
  width: 14px;
  color: var(--accent);
  font-weight: 700;
}

/* 图片预览区 */
.pending-preview {
  padding: 8px 16px 4px;
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.pending-item {
  position: relative;
  display: inline-flex;
}
.pending-thumb {
  height: 64px;
  max-width: 120px;
  object-fit: cover;
  border-radius: var(--radius-sm);
  border: 1px solid var(--border);
  display: block;
}
.pending-remove {
  position: absolute;
  top: -6px;
  right: -6px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: rgba(0,0,0,0.6);
  color: #fff;
  border: none;
  cursor: pointer;
  font-size: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}
.pending-remove:hover { background: #f5222d; }
```

- [ ] **Step 8: 运行全部测试**

```bash
npm test
```

期望：全部通过（MessageInput 的改动不会影响现有测试，因为 ScreenshotOverlay 测试已更新）。

- [ ] **Step 9: Commit**

```bash
git add src/renderer/src/components/chat/MessageInput.vue
git commit -m "feat: add screenshot toolbar button with hide-window toggle and image preview area"
```

---

### Task 7: 冒烟验证

**Files:** 无修改，仅验证

- [ ] **Step 1: 启动应用**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20 && npm run dev
```

- [ ] **Step 2: 验证工具栏截图按钮**

1. 打开聊天页面，在输入框工具栏找到剪刀图标（表情按钮右侧）
2. 点击 ▾ 下拉，确认显示「隐藏当前窗口」选项（默认未勾选）
3. 点击剪刀图标，确认截图 overlay 展开（覆盖全屏，显示桌面截图）
4. 拖拽框选一个区域，确认选区高亮
5. 松开鼠标后，确认底部出现标注工具栏
6. 点击矩形工具，在选区内拖拽，确认绘制红色矩形
7. 点击箭头工具，在选区内拖拽，确认绘制箭头
8. 点击 T 工具，点击选区，输入文字后回车，确认文字绘制到截图上
9. 点击撤销（↺），确认上一步操作被撤销
10. 点击 ✓ 确认，确认输入框上方出现图片预览缩略图
11. 点击发送，确认图片作为消息发出，预览清除

- [ ] **Step 3: 验证快捷键**

1. 在聊天页面按 Ctrl+Alt+Z
2. 确认截图 overlay 展开（默认不隐藏当前窗口，飞享界面可见）
3. 框选标注后确认，流程同上

- [ ] **Step 4: 验证隐藏窗口模式**

1. 点击 ▾，勾选「隐藏当前窗口」
2. 再次点击截图按钮
3. 确认飞享窗口消失后截图展开（截图中不含飞享窗口）
4. 确认/取消后窗口恢复

- [ ] **Step 5: 验证粘贴图片**

1. 复制任意图片到剪贴板（Cmd+C 截图 or 从浏览器复制）
2. 在输入框按 Ctrl+V
3. 确认预览缩略图出现（不自动发送）
4. 点击发送，确认图片消息发出

- [ ] **Step 6: 最终 commit**

```bash
git add docs/superpowers/specs/2026-06-16-screenshot-annotation-design.md docs/superpowers/plans/2026-06-16-screenshot-annotation.md
git commit -m "docs: add screenshot annotation design spec and implementation plan"
```
