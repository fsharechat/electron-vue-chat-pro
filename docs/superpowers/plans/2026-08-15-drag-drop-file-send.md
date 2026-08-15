# 拖拽文件发送 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 支持把文件拖拽到聊天区域，在输入框上方预览（文件名 + 图标 + 大小），点「发送」后作为文件/图片消息发出；回形针选文件一并改为先预览再发。

**Architecture:** 把 `MessageInput.vue` 里的单张 `pendingImage` 状态替换为 `pendingAttachments` 队列，所有入口（拖拽、回形针、图片按钮、粘贴、截图）收敛到一个 `addAttachments()`。准入校验抽成纯函数 `utils/attachment.ts`，拖拽状态机抽成 `composables/useFileDrop.ts`，两者独立可测。落区挂在 `ChatPage.vue` 的整个聊天区，`App.vue` 加 window 级兜底防止文件掉在落区外时把应用页面导航掉。

**Tech Stack:** Vue 3 `<script setup>` + TypeScript、Pinia、naive-ui（`useMessage` 提示）、vitest（jsdom 环境）、axios（上传）。

**Spec:** `docs/superpowers/specs/2026-08-15-drag-drop-file-send-design.md`

## Global Constraints

- Node 20：每个终端会话先跑 `export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20`
- **本计划全程不执行 `git commit`、不执行 `git push`**。用户要求全部任务完成后再统一提交，因此每个任务以「测试通过」收尾，不以提交收尾。
- **所有测试文件放在仓库根的 `tests/` 目录**，镜像 `src/` 结构（`tests/main/**`、`tests/renderer/**`），不与正式代码混放（Task 0 完成迁移）
- 测试内一律用路径别名引用被测代码：渲染层 `@/...`，主进程 `@main/...`，不用 `../../../src/...` 这类相对路径
- `npm run build` 是 `electron-vite build`，**不做类型检查**（无 `vue-tsc` 步骤）；它只验证能否构建通过
- 单文件上限 `500 * 1024 * 1024`（500MB），一次队列上限 9 个，两个值写成常量
- 颜色一律用 `src/renderer/src/styles/variables.css` 的 CSS 变量，禁止硬编码色值
- 文件大小格式化复用已有的 `Utils.formateSize`（`src/renderer/src/websocket/utils/utils.ts`），不新写
- 测试路径别名 `@` → `src/renderer/src`（已在 `vitest.config.ts` 配好）
- 提示文案统一用 naive-ui `message.warning` / `message.error`

## File Structure

| 文件 | 责任 |
|---|---|
| `tests/`（新建目录，Task 0） | 全部测试的新家，镜像 `src/` 结构 |
| `vitest.config.ts`（改，Task 0） | 环境匹配改指 `tests/**`，新增 `@main` 别名 |
| `src/renderer/src/utils/attachment.ts`（新建） | 纯函数：附件准入校验 + 限额常量。不认识 Vue、不认识 DOM |
| `tests/renderer/utils/attachment.test.ts`（新建） | 上者的单测 |
| `src/renderer/src/composables/useFileDrop.ts`（新建） | 拖拽状态机：depth 计数、文件夹分流。不认识附件队列 |
| `tests/renderer/composables/useFileDrop.test.ts`（新建） | 上者的单测 |
| `src/renderer/src/App.vue`（改） | window 级 dragover/drop 兜底 |
| `src/renderer/src/components/chat/MessageInput.vue`（改） | 附件队列状态 + 预览 UI + 发送编排；对外暴露 `addAttachments` |
| `src/renderer/src/pages/ChatPage.vue`（改） | 落区 + 遮罩，把 drop 结果转交 MessageInput |

---

### Task 0: 把测试迁到独立的 tests/ 目录

**Files:**
- Move: 26 个 `*.test.ts`，从 `src/**` 迁到 `tests/**`
- Modify: `vitest.config.ts`、`tsconfig.web.json`、`tsconfig.node.json`、`CLAUDE.md`
- Create（临时）: `scripts/migrate-tests.mjs`，迁移完删除

**Interfaces:**
- Consumes: 无
- Produces: 新测试根目录 `tests/`；别名 `@` → `src/renderer/src`（已有）、`@main` → `src/main`（新增）

**为什么先做：** 后续任务要新建两个测试文件，先把目录规范落地，新测试直接落在新位置，避免建完再搬。

**现状盘点：** 26 个测试文件、45 处相对 import、0 处相对路径的 `vi.mock`（全部走包名或别名），因此迁移可机械化。`npm run build` 不含类型检查，tsconfig 改动只影响编辑器体验。

- [ ] **Step 1: 记录迁移前的测试基线**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20
npm test 2>&1 | tail -5
```

记下用例总数和通过数。迁移是纯搬运，**迁移后这个数字必须一模一样**——这就是本任务的验收标准。

- [ ] **Step 2: 写迁移脚本**

创建 `scripts/migrate-tests.mjs`：

```js
// 一次性迁移脚本：把 src/** 下的测试搬到 tests/**，并把相对 import 改写为别名。
// 关键点：相对说明符要按【原路径】解析，再转成别名，否则会指向错误的模块。
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'

const files = execSync('find src -name "*.test.ts"', { encoding: 'utf8' })
  .trim().split('\n').filter(Boolean)

for (const oldPath of files) {
  const isMain = oldPath.startsWith('src/main/')
  // src/main/utils/x.test.ts        → tests/main/utils/x.test.ts
  // src/renderer/src/stores/x.test.ts → tests/renderer/stores/x.test.ts
  const rootPrefix = isMain ? 'src/main/' : 'src/renderer/src/'
  const alias = isMain ? '@main' : '@'
  const sub = oldPath.slice(rootPrefix.length)
  const newPath = join('tests', isMain ? 'main' : 'renderer', sub)

  let src = readFileSync(oldPath, 'utf8')

  // 把 './x' / '../x' 按原目录解析成别名路径
  src = src.replace(/(from\s+|import\s*\()(['"])(\.\.?\/[^'"]+)\2/g, (_m, head, q, spec) => {
    const abs = posix.normalize(posix.join(dirname(oldPath), spec)) // 相对仓库根
    const rel = abs.slice(rootPrefix.length)                        // 相对别名根
    return `${head}${q}${alias}/${rel}${q}`
  })

  mkdirSync(dirname(newPath), { recursive: true })
  writeFileSync(newPath, src)
  rmSync(oldPath) // git 会自动识别为删除，无需 git rm
  console.log(`${oldPath} → ${newPath}`)
}
```

正则同时覆盖 `from '...'` 和动态 `import('...')`。已确认仓库里没有相对路径的 `vi.mock`，故无需处理它。

- [ ] **Step 3: 跑迁移脚本**

```bash
node scripts/migrate-tests.mjs
```

Expected: 打印 26 行 `旧路径 → 新路径`

- [ ] **Step 4: 确认 src 下已无测试、tests 下有 26 个**

```bash
find src -name "*.test.ts" | wc -l   # 期望 0
find tests -name "*.test.ts" | wc -l # 期望 26
grep -rn "from '\.\|from \"\." tests | head  # 期望无输出：不应残留相对 import
```

三条都符合预期才继续。第三条有输出说明脚本正则漏了，手工改掉。

- [ ] **Step 5: 改 vitest 配置**

`vitest.config.ts` 整体替换为：

```ts
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    include: ['tests/**/*.test.ts'],
    environmentMatchGlobs: [
      ['tests/main/**', 'node'],
      ['tests/renderer/**', 'jsdom'],
    ],
  },
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src/renderer/src'),
      '@main': resolve(__dirname, 'src/main'),
    }
  }
})
```

两处改动的原因：`environmentMatchGlobs` 原先按 `src/main/**` / `src/renderer/**` 分环境，测试搬走后不再匹配，主进程测试会错跑在 jsdom 下；`@main` 别名是给主进程测试引用被测代码用的。

- [ ] **Step 6: 跑测试，对齐基线**

```bash
npm test
```

Expected: 用例总数与通过数**与 Step 1 完全一致**。若某个文件报模块找不到，检查它的别名前缀是否用错（主进程测试必须是 `@main`）。

- [ ] **Step 7: 更新 tsconfig（编辑器能正确解析 tests）**

`tsconfig.web.json` 的 `include` 改为：

```json
  "include": ["src/renderer/src/**/*", "tests/renderer/**/*"]
```

`tsconfig.node.json` 的 `include` 追加 `tests/main/**/*`，并加 `@main` 路径映射：

```json
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "skipLibCheck": true,
    "types": ["node", "electron-vite/node"],
    "baseUrl": ".",
    "paths": {
      "@main/*": ["./src/main/*"]
    }
  },
  "include": [
    "electron.vite.config.*",
    "vitest.config.*",
    "src/main/**/*",
    "src/preload/**/*",
    "tests/main/**/*"
  ]
```

- [ ] **Step 8: 更新 CLAUDE.md**

「常用命令」里两条单测示例改为新路径：

```bash
# 运行单个测试文件
npm test -- tests/main/utils/common.test.ts
npm test -- tests/renderer/components/layout/AppTitleBar.test.ts
```

「测试说明」小节替换为：

```markdown
## 测试说明

测试统一放在仓库根的 `tests/` 目录，镜像 `src/` 结构，不与正式代码混放：

- `tests/main/**` → 对应 `src/main/**`，`node` 环境
- `tests/renderer/**` → 对应 `src/renderer/src/**`，`jsdom` 环境

测试中通过路径别名引用被测代码：渲染层 `@/...`、主进程 `@main/...`，不要写 `../../../src/...`。

测试 Vue 组件时通过 `Object.defineProperty(window, 'electronAPI', ...)` mock IPC 接口。
```

- [ ] **Step 9: 删除临时脚本，最终校验**

```bash
rm scripts/migrate-tests.mjs
rmdir scripts 2>/dev/null || true   # 目录若因此变空则一并删掉，非空则保留
npm test
```

Expected: 与 Step 1 的基线完全一致

---

### Task 1: 附件准入校验纯函数

**Files:**
- Create: `src/renderer/src/utils/attachment.ts`
- Test: `tests/renderer/utils/attachment.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `MAX_FILE_SIZE: number`、`MAX_ATTACHMENT_COUNT: number`、`classifyFiles(files: File[], currentCount: number): { accepted: File[]; oversize: string[]; overflow: number }`

- [ ] **Step 1: 写失败的测试**

创建 `tests/renderer/utils/attachment.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20
npm test -- tests/renderer/utils/attachment.test.ts
```

Expected: FAIL — 无法解析模块 `@/utils/attachment`

- [ ] **Step 3: 写实现**

创建 `src/renderer/src/utils/attachment.ts`：

```ts
/** 单个附件大小上限：500MB */
export const MAX_FILE_SIZE = 500 * 1024 * 1024

/** 待发队列中的附件数量上限 */
export const MAX_ATTACHMENT_COUNT = 9

export interface ClassifyResult {
  /** 通过校验、可以入队的文件 */
  accepted: File[]
  /** 因超过 MAX_FILE_SIZE 被拒的文件名 */
  oversize: string[]
  /** 因超过 MAX_ATTACHMENT_COUNT 被丢弃的文件数量 */
  overflow: number
}

/**
 * 校验一批待入队的附件。
 * 不做文件夹判定——文件夹只能在 drop 事件里靠 webkitGetAsEntry 精确识别，
 * 由 useFileDrop 负责在调用本函数之前分流掉。
 *
 * @param currentCount 队列中已有的附件数，用于计算剩余额度
 */
export function classifyFiles(files: File[], currentCount: number): ClassifyResult {
  const oversize: string[] = []
  const withinSize: File[] = []

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) oversize.push(file.name)
    else withinSize.push(file)
  }

  const remaining = Math.max(0, MAX_ATTACHMENT_COUNT - currentCount)
  const accepted = withinSize.slice(0, remaining)

  return { accepted, oversize, overflow: withinSize.length - accepted.length }
}
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- tests/renderer/utils/attachment.test.ts
```

Expected: PASS，7 个用例全绿

---

### Task 2: 拖拽状态 composable

**Files:**
- Create: `src/renderer/src/composables/useFileDrop.ts`
- Test: `tests/renderer/composables/useFileDrop.test.ts`

**Interfaces:**
- Consumes: 无
- Produces: `useFileDrop(onDrop: (files: File[], folderNames: string[]) => void): { isDragging: Ref<boolean>; dropHandlers: Record<string, (e: DragEvent) => void> }`；`dropHandlers` 的键为 `dragenter` / `dragover` / `dragleave` / `drop`，可直接 `v-on="dropHandlers"` 展开

- [ ] **Step 1: 写失败的测试**

创建 `tests/renderer/composables/useFileDrop.test.ts`：

```ts
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
```

- [ ] **Step 2: 运行测试确认失败**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20
npm test -- tests/renderer/composables/useFileDrop.test.ts
```

Expected: FAIL — 无法解析模块 `@/composables/useFileDrop`

- [ ] **Step 3: 写实现**

创建 `src/renderer/src/composables/useFileDrop.ts`：

```ts
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
    e.preventDefault() // 不阻止默认行为，浏览器不会触发 drop
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
        const file = item.getAsFile()
        if (!file) continue
        const entry = (item as any).webkitGetAsEntry?.()
        if (entry?.isDirectory) folderNames.push(entry.name || file.name)
        else files.push(file)
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
```

- [ ] **Step 4: 运行测试确认通过**

```bash
npm test -- tests/renderer/composables/useFileDrop.test.ts
```

Expected: PASS，8 个用例全绿

---

### Task 3: App.vue window 级防导航兜底

**Files:**
- Modify: `src/renderer/src/App.vue`（`onMounted` 约 36 行、`onUnmounted` 约 64 行）

**Interfaces:**
- Consumes: 无
- Produces: 无（纯副作用）

**背景：** `src/main/index.ts:57` 的 `will-navigate` 拦截在生产环境把 `file://` 判定为应用内导航并放行。文件掉在落区之外时，Chromium 默认行为会把整个应用页面导航成那个文件。落区之外的每一寸窗口都需要这层兜底。

- [ ] **Step 1: 加 handler 与注册**

在 `App.vue` 的 `<script setup>` 中，`onMounted` 之前加：

```ts
// 兜底：文件被拖到落区之外时，阻止 Chromium 把应用页面导航成该文件。
// 主进程 will-navigate 在生产环境放行 file://，拦不住这种导航。
function preventWindowFileDrop(e: DragEvent): void {
  e.preventDefault()
}
```

在 `onMounted` 回调的**最开头**（`if (isOverlay)` 提前 return 之前）加：

```ts
  window.addEventListener('dragover', preventWindowFileDrop)
  window.addEventListener('drop', preventWindowFileDrop)
```

必须放在 `isOverlay` 分支之前——截图 overlay 窗口同样需要这层保护。

- [ ] **Step 2: 加注销**

在 `onUnmounted` 回调内追加：

```ts
  window.removeEventListener('dragover', preventWindowFileDrop)
  window.removeEventListener('drop', preventWindowFileDrop)
```

- [ ] **Step 3: 确认没有破坏落区**

这两个监听器挂在 `window` 上、冒泡阶段最后执行，`ChatPage` 的 drop handler 先跑完，因此不会吞掉落区行为。无需写自动化测试（纯 DOM 副作用，成本高于收益），Task 6 手工验证时一并确认。

- [ ] **Step 4: 跑全量测试确认没有回归**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20
npm test
```

Expected: 全部通过

---

### Task 4: MessageInput 附件队列与发送编排

**Files:**
- Modify: `src/renderer/src/components/chat/MessageInput.vue`

**Interfaces:**
- Consumes: `classifyFiles` / `MAX_FILE_SIZE` / `MAX_ATTACHMENT_COUNT`（Task 1）
- Produces: 通过 `defineExpose` 暴露 `addAttachments(files: File[], folderNames?: string[]): void`，供 `ChatPage` 调用

这是核心任务：`pendingImage` 被 `pendingAttachments` 取代，五条入口收敛，发送改为串行编排。

- [ ] **Step 1: 加 import**

在现有 import 区追加：

```ts
import { classifyFiles, MAX_FILE_SIZE, MAX_ATTACHMENT_COUNT } from '@/utils/attachment'
import Utils from '@/websocket/utils/utils'
```

`Utils` 在 `<script setup>` 中 import 后模板即可直接使用。

- [ ] **Step 2: 用队列替换 pendingImage 状态**

删除现有的这段（约 55–69 行）：

```ts
interface PendingImage { file: File; url: string }
const pendingImage = ref<PendingImage | null>(null)
function setPendingImage(file: File): void { ... }
function clearPendingImage(): void { ... }
```

替换为：

```ts
// ── 待发附件队列 ────────────────────────────────────────────────
type AttachmentKind = 'image' | 'file'
interface PendingAttachment {
  id: string
  file: File
  kind: AttachmentKind
  previewUrl: string // image 走 createObjectURL；file 为空串
}

const pendingAttachments = ref<PendingAttachment[]>([])
let attachmentSeq = 0

/** 所有入口（拖拽 / 回形针 / 图片按钮 / 粘贴 / 截图）唯一的入队通道 */
function addAttachments(files: File[], folderNames: string[] = []): void {
  for (const name of folderNames) message.warning(`不支持发送文件夹：${name}`)

  const { accepted, oversize, overflow } = classifyFiles(files, pendingAttachments.value.length)

  for (const name of oversize) {
    message.warning(`${name} 超过 ${MAX_FILE_SIZE / 1024 / 1024}MB，已跳过`)
  }
  if (overflow > 0) {
    message.warning(`一次最多发送 ${MAX_ATTACHMENT_COUNT} 个文件，已忽略 ${overflow} 个`)
  }

  for (const file of accepted) {
    const kind: AttachmentKind = file.type.startsWith('image/') ? 'image' : 'file'
    pendingAttachments.value.push({
      id: `att-${Date.now()}-${attachmentSeq++}`,
      file,
      kind,
      previewUrl: kind === 'image' ? URL.createObjectURL(file) : ''
    })
  }
}

function removeAttachment(id: string): void {
  const i = pendingAttachments.value.findIndex(a => a.id === id)
  if (i === -1) return
  const [removed] = pendingAttachments.value.splice(i, 1)
  if (removed.previewUrl) URL.revokeObjectURL(removed.previewUrl)
}

function clearAttachments(): void {
  for (const a of pendingAttachments.value) {
    if (a.previewUrl) URL.revokeObjectURL(a.previewUrl)
  }
  pendingAttachments.value = []
}

defineExpose({ addAttachments })
```

- [ ] **Step 3: 把四条旧入口改到 addAttachments**

**截图 watch**（约 72–80 行）末行 `setPendingImage(file)` 改为：

```ts
  addAttachments([file])
```

**切会话 watch**（约 83–85 行）改为：

```ts
watch(() => convStore.selectTarget, () => {
  clearAttachments()
})
```

**onUnmounted**（约 91–94 行）里的 `if (pendingImage.value) URL.revokeObjectURL(pendingImage.value.url)` 改为：

```ts
  clearAttachments()
```

**onPaste**（约 369–382 行）里的 `setPendingImage(file)` 改为：

```ts
        addAttachments([file])
```

- [ ] **Step 4: 把两个文件选择入口改成入队而非直发**

`onImageSelected` 整体替换为：

```ts
function onImageSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (files.length > 0) addAttachments(files)
  input.value = ''
}
```

`onFileSelected` 整体替换为：

```ts
function onFileSelected(e: Event) {
  const input = e.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  if (files.length > 0) addAttachments(files)
  input.value = ''
}
```

同时给两个 `<input type="file">` 加 `multiple` 属性（Step 7 的模板改动里一并做）。

- [ ] **Step 5: 把上传逻辑抽成 sendFile**

在 `sendImage` 之后新增（原本内联在 `onFileSelected` 里的逻辑，改为失败时抛出、由调用方提示）：

```ts
async function sendFile(file: File) {
  const key = `${MessageContentMediaType.File}-${LocalStore.getUserId()}-${Date.now()}-${file.name}`
  const data = await webSocketClient.getMinioUploadUrl(MessageContentMediaType.File, key)
  if (data?.code !== SUCCESS_CODE) throw new Error('获取上传地址失败')

  const { protoMsg, m } = buildLocal(new FileMessageContent(file, ''))
  try {
    await axios.request({
      method: 'PUT', url: data.result.url, data: file,
      onUploadProgress: (p: any) => msgStore.setFileDownloadStatus({
        messageId: protoMsg.messageId,
        downloadStatus: 1,
        downloadPercent: Math.floor(p.loaded / p.total * 100)
      })
    })
    msgStore.setFileDownloadStatus({ messageId: protoMsg.messageId, downloadStatus: 2, downloadPercent: 100 })
    const finalMc = new FileMessageContent(file, `${data.result.domain}/${key}`)
    m.content = finalMc
    sendToServer(m)
    msgStore.updateSendMessage({ messageId: protoMsg.messageId, messageContent: finalMc })
  } catch (e) {
    // downloadStatus -1：停止转圈；status 2：气泡显示红点，点击可走「重新选择文件」引导
    msgStore.setFileDownloadStatus({ messageId: protoMsg.messageId, downloadStatus: -1, downloadPercent: 0 })
    msgStore.updateMessageStatus({ messageId: protoMsg.messageId, status: 2 })
    throw e
  }
}
```

- [ ] **Step 6: 改发送编排与按钮激活条件**

`sendBtnActive` 改为：

```ts
const sendBtnActive = computed(() => content.value.trim().length > 0 || pendingAttachments.value.length > 0)
```

`send()` 整体替换为：

```ts
async function send() {
  const hasText = !!content.value.trim()
  if (!hasText && pendingAttachments.value.length === 0) {
    message.warning('不能发送空白信息')
    return
  }

  // 先快照再清空：清空 UI 不依赖异步结果，也防止上传期间重复点发送
  const list = pendingAttachments.value.slice()
  const textSnapshot = hasText ? content.value : ''
  const mentionData = hasText ? extractMentions() : null

  clearAttachments()
  if (hasText) content.value = ''
  showAtMenu.value = false
  textareaRef.value?.focus()

  // 串行上传，避免并发打爆带宽；单个失败不阻断其余
  for (const att of list) {
    try {
      if (att.kind === 'image') await sendImage(att.file)
      else await sendFile(att.file)
    } catch (e) {
      console.error('Attachment send failed', e)
      message.error(`${att.file.name} 发送失败`)
    }
  }

  if (textSnapshot && mentionData) {
    const mc = new TextMessageContent(textSnapshot, mentionData.mentionedType, mentionData.mentionedTargets)
    buildAndSend(mc)
  }
}
```

注意 `sendImage` 内部现有的 `catch { ...; throw e }` 保持不变，由 `send()` 统一提示。

- [ ] **Step 7: 改预览区模板**

把现有的图片预览块（约 447–453 行）整体替换为：

```html
    <!-- 待发附件预览 -->
    <div v-if="pendingAttachments.length > 0" class="pending-preview">
      <div v-for="att in pendingAttachments" :key="att.id" class="pending-item">
        <img
          v-if="att.kind === 'image'"
          :src="att.previewUrl"
          class="pending-thumb"
          :alt="att.file.name"
        />
        <div v-else class="pending-file" :title="att.file.name">
          <div class="pending-file-icon"></div>
          <div class="pending-file-info">
            <p class="pending-file-name">{{ att.file.name }}</p>
            <p class="pending-file-size">{{ Utils.formateSize(att.file.size) }}</p>
          </div>
        </div>
        <button class="pending-remove" title="移除" @click="removeAttachment(att.id)">×</button>
      </div>
    </div>
```

同时给两个文件 input 加 `multiple`：

```html
        <input ref="uploadImgRef" type="file" accept="image/*" multiple class="hidden-input" @change="onImageSelected" />
```

```html
        <input ref="uploadFileRef" type="file" multiple class="hidden-input" @change="onFileSelected" />
```

- [ ] **Step 8: 加文件卡片样式**

在 `<style scoped>` 末尾（`.pending-remove:hover` 之后）追加：

```css
/* 待发文件卡片 —— 视觉对齐 MessageBubble 的 .file-msg */
.pending-file {
  display: flex;
  align-items: center;
  gap: 8px;
  height: 64px;
  box-sizing: border-box;
  padding: 0 12px;
  background: var(--bg-elevated);
  border: 1px solid var(--border);
  border-radius: var(--radius-sm);
}
.pending-file-icon {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
}
.pending-file-icon::after { content: '📄'; font-size: 18px; }
.pending-file-info { min-width: 0; }
.pending-file-name {
  margin: 0;
  max-width: 140px;
  font-size: 12.5px;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.pending-file-size {
  margin: 2px 0 0;
  font-size: 11px;
  color: var(--text-muted);
}
```

- [ ] **Step 9: 确认没有 pendingImage 残留**

```bash
grep -n "pendingImage\|setPendingImage\|clearPendingImage" src/renderer/src/components/chat/MessageInput.vue
```

Expected: 无输出。有输出说明 Step 2/3 漏改，回去补。

- [ ] **Step 10: 构建 + 全量测试**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20
npm run build
npm test
```

Expected: 构建成功、测试全绿

---

### Task 5: ChatPage 落区与遮罩

**Files:**
- Modify: `src/renderer/src/pages/ChatPage.vue`（import 约 10–11 行、template 约 183–191 行、style 约 236 行）

**Interfaces:**
- Consumes: `useFileDrop`（Task 2）、`MessageInput` 暴露的 `addAttachments`（Task 4）
- Produces: 无

- [ ] **Step 1: 接入 composable**

在 `<script setup>` 的 import 区追加：

```ts
import { useFileDrop } from '@/composables/useFileDrop'
```

确认 `ref` 已从 `vue` 引入（未引入则补上），然后在脚本中加：

```ts
const messageInputRef = ref<InstanceType<typeof MessageInput> | null>(null)

const { isDragging, dropHandlers } = useFileDrop((files, folderNames) => {
  messageInputRef.value?.addAttachments(files, folderNames)
})
```

- [ ] **Step 2: 落区挂到 chat-area，加遮罩**

把 template 中的 `<main class="chat-area" ...>` 块（约 183–191 行）替换为：

```html
    <main class="chat-area" v-if="convStore.selectTarget" v-on="dropHandlers">
      <div class="message-area">
        <MessageList @context-menu="onContextMenu" />
      </div>
      <div class="h-resizer" @mousedown.prevent="onHResizerMousedown"></div>
      <div class="input-area" :style="{ height: inputHeight + 'px' }">
        <MessageInput ref="messageInputRef" />
      </div>

      <!-- 拖拽遮罩：pointer-events none，避免自己吃掉 drop 事件 -->
      <div v-if="isDragging" class="drop-overlay">
        <div class="drop-overlay-inner">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          <p>释放以发送文件</p>
        </div>
      </div>
    </main>
```

未选中会话时 `chat-area` 不渲染，落区天然不存在，无需额外守卫。

- [ ] **Step 3: 加遮罩样式**

`.chat-area` 目前没有 `position`，遮罩需要定位上下文。把第 236 行改为：

```css
.chat-area { flex: 1; display: flex; flex-direction: column; min-width: 0; background: var(--bg-chat); position: relative; }
```

在 `<style scoped>` 末尾追加：

```css
/* 拖拽遮罩 */
.drop-overlay {
  position: absolute;
  inset: 8px;
  z-index: 400;
  pointer-events: none;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--accent-subtle);
  border: 2px dashed var(--accent);
  border-radius: var(--radius-md);
  backdrop-filter: blur(1px);
}
.drop-overlay-inner {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
  color: var(--accent);
}
.drop-overlay-inner p {
  margin: 0;
  font-size: 14px;
  font-weight: 500;
}
```

- [ ] **Step 4: 构建 + 全量测试**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20
npm run build
npm test
```

Expected: 构建成功、测试全绿

---

### Task 6: 端到端手工验证

**Files:** 无改动

**Interfaces:**
- Consumes: Task 1–5 的全部成果
- Produces: 无

自动化测试只覆盖了两个纯逻辑单元，发送编排与拖拽交互必须真机验证。

- [ ] **Step 1: 启动应用**

```bash
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20
npm run dev
```

登录并打开一个单聊会话。（也可用 `/verify` skill 通过 CDP 驱动。）

- [ ] **Step 2: 逐项走查**

- [ ] 拖单个 PDF 到**消息列表区域** → 出现虚线遮罩「释放以发送文件」，松手后输入框上方出现文件卡片（📄 + 文件名 + 大小）
- [ ] 拖单个文件到**输入框区域** → 同样生效（落区是整个聊天区）
- [ ] 拖一张 PNG → 预览显示的是**缩略图**而非文件卡片
- [ ] 一次拖 3 个文件 → 三张卡片并排，各自的 `×` 只移除自己
- [ ] 卡片存在时输入文字 → 发送按钮高亮；点发送后附件先按顺序发出、文本最后发出
- [ ] 拖一个文件夹 → 提示「不支持发送文件夹：xxx」，且不产生卡片
- [ ] 拖一个 > 500MB 的文件 → 提示「超过 500MB，已跳过」
- [ ] 一次拖 12 个文件 → 只入队 9 个，提示「已忽略 3 个」
- [ ] 拖拽经过消息气泡等子元素时，遮罩**不闪烁**
- [ ] 拖文件到**左侧会话列表**（落区之外）后松手 → 应用页面**没有被导航**成该文件（验证 Task 3 的兜底）
- [ ] 有待发卡片时切换会话 → 卡片被清空，不会误发到新会话
- [ ] 点回形针选文件 → 进入预览而非直接发送；选图片按钮同理
- [ ] 粘贴截图、快捷键截图 → 仍进入预览，行为未回归
- [ ] 断网后发送文件 → 气泡停止转圈并显示红点，提示「xxx 发送失败」，其余附件继续发送

- [ ] **Step 3: 汇总结果**

把不通过的项记录下来修复后重跑。全部通过即实现完成。

---

## 完成后

全部任务完成、`npm test` 与 `npm run build` 均通过、Task 6 走查无遗留问题后，向用户汇报并询问是否统一提交（按 Global Constraints，过程中不提交）。
