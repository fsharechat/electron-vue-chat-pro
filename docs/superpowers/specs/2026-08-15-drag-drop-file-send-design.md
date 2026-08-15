# 拖拽文件发送 — 设计文档

日期：2026-08-15

## 目标

支持把文件拖拽到聊天区域，在输入框上方以卡片形式预览（文件名 + 图标 + 大小），点击「发送」后作为文件类消息发出。同时把现有「点回形针选文件」从「选完即发」统一改为「先预览再发」。

## 现状

- `src/renderer/src/components/chat/MessageInput.vue` 已有单张图片的待发预览机制（`pendingImage`），用于粘贴图片和截图确认两条路径。
- 回形针选文件（`onFileSelected`）是选完直接上传并发送，没有预览环节，上传逻辑内联在事件处理器里。
- 全项目没有任何拖拽处理代码，也没有文件大小/数量限制。
- `src/main/index.ts` 的 `will-navigate` 拦截在生产环境把 `file://` 判定为应用内导航并放行——文件被拖到窗口任意位置时，Chromium 默认行为会把整个应用页面导航成该文件。这是本需求必须一并兜底的既有缺陷。

## 需求决策

| 决策点 | 结论 |
|---|---|
| 拖拽落区 | 整个聊天区域（消息列表 + 输入框），不只是输入框 |
| 多文件 | 支持，一次最多 9 个，排队预览，各自可单独移除 |
| 图片文件 | 按图片消息发（复用现有 `sendImage`），与粘贴截图行为一致 |
| 回形针入口 | 一并改为先预览再发，与拖拽共用同一条发送路径 |
| 大小限制 | 单文件 500MB，超出直接拒收并提示 |

## 一、数据模型

现有 `pendingImage` 单张状态无法承载「多文件排队 + 图文混合」，替换为统一队列：

```ts
type AttachmentKind = 'image' | 'file'

interface PendingAttachment {
  id: string           // v-for key / 移除定位
  file: File
  kind: AttachmentKind // file.type.startsWith('image/') 判定
  previewUrl: string   // image 走 createObjectURL；file 为 ''
}

const pendingAttachments = ref<PendingAttachment[]>([])
```

**五条入口全部收敛到 `addAttachments(files: File[], folderNames?: string[])`**：拖拽 drop、回形针选文件、图片按钮、粘贴图片、截图确认。不再存在第二套发送逻辑。`folderNames` 仅拖拽路径传入（见下），其余路径省略。

准入判定抽成纯函数，放新建的 `src/renderer/src/utils/attachment.ts`：

```ts
export const MAX_FILE_SIZE = 500 * 1024 * 1024
export const MAX_ATTACHMENT_COUNT = 9

export function classifyFiles(
  files: File[],
  currentCount: number
): {
  accepted: File[]
  oversize: string[]  // > MAX_FILE_SIZE
  overflow: number    // 因超出 MAX_ATTACHMENT_COUNT 被丢弃的数量
}
```

`addAttachments` 拿 `classifyFiles` 的结果建对象入队，并对拒绝项弹提示。

文件大小格式化直接复用已有的 `Utils.formateSize`（`src/renderer/src/websocket/utils/utils.ts`，`MessageBubble.vue` 与 `RelayMessage.vue` 已在用），不新写也不抽取。

### 文件夹判定不在这里做

不能用 `size === 0 && type === ''` 启发式判定文件夹：macOS 上拖入的文件夹在 `DataTransfer.files` 里 `size` 往往是非零的 inode 大小，该判定既漏判文件夹又误伤空文件。

正确做法是在 drop 事件里用 `DataTransfer.items[i].webkitGetAsEntry()?.isDirectory` 精确判定，因此文件夹过滤属于 `useFileDrop` 的职责，不进 `classifyFiles`。回形针路径走 `input[type=file]`（未开 `webkitdirectory`），本就选不到文件夹，无需检测。

## 二、拖拽落区与遮罩

落区挂在 `ChatPage.vue`（整个聊天区域），不在 `MessageInput` 内部。

### 1. 全局兜底防导航

在 `App.vue` 挂载时对 `window` 注册 `dragover` / `drop` 的 `preventDefault`，卸载时移除。这一层与落区无关，只为防止文件掉在落区之外时 Chromium 把应用页面导航掉（见「现状」中的 `will-navigate` 缺陷）。落区自己的 handler 在事件冒泡到 window 前已处理完毕。

### 2. 拖拽状态用 depth 计数

子元素之间移动会连续触发 `dragleave` / `dragenter`，布尔量会让遮罩闪烁。用计数器：`dragenter` +1、`dragleave` -1、归零才隐藏，`drop` 直接清零。

抽成新建的 `src/renderer/src/composables/useFileDrop.ts`：

```ts
export function useFileDrop(
  onDrop: (files: File[], folderNames: string[]) => void
): {
  isDragging: Ref<boolean>      // depth > 0
  dropHandlers: Record<string, (e: DragEvent) => void>  // v-on 展开到落区元素
}
```

仅当 `dataTransfer.types` 含 `'Files'` 时激活——从消息列表拖选中文本不应弹遮罩。

drop 时遍历 `dataTransfer.items`，用 `webkitGetAsEntry()?.isDirectory` 把文件夹分流到 `folderNames`、其余作为 `files` 回调出去。`webkitGetAsEntry` 不可用时（理论上不会发生于 Chromium）降级为全部当文件处理。

### 3. ChatPage → MessageInput 传递

`MessageInput` 用 `defineExpose({ addAttachments })`，`ChatPage` 持 template ref 调用。不走 uiStore：这是一次性父子调用，放进全局 store 会让「附件队列归谁管」变模糊。

### 4. 遮罩样式

覆盖聊天区，`--accent-subtle` 半透明底 + 2px 虚线 `--accent` 边框 + 居中文案「释放以发送文件」，`pointer-events: none` 以免自身吃掉 drop 事件。颜色一律走 CSS 变量。

## 三、发送流程与预览 UI

### 发送

`send()` 改为快照队列 → 立即清空 UI → 串行处理：

```
// 保留现有空内容拦截
if (!content.value.trim() && pendingAttachments.value.length === 0) {
  message.warning('不能发送空白信息'); return
}

const list = pendingAttachments.value.slice()   // 快照
clearAttachments()                              // 立即清空，不等异步
const textSnapshot = content.value.trim() ? content.value : ''
content.value = ''

for (const att of list) {                       // 串行，避免并发上传打爆带宽
  try {
    att.kind === 'image' ? await sendImage(att.file) : await sendFile(att.file)
  } catch {
    message.error(`${att.file.name} 发送失败`)   // 单个失败不阻断后续
  }
}
if (textSnapshot) buildAndSend(new TextMessageContent(...))  // 文本最后发
```

顺序沿用现有行为（先媒体后文本）。`sendImage` 已存在，直接复用。`sendFile(file)` 需从现在内联在 `onFileSelected` 中的上传逻辑抽成独立函数；抽出后该事件处理器只剩一行 `addAttachments`。

发送按钮激活条件改为：`content.trim() || pendingAttachments.length > 0`。

### 预览 UI

复用现有 `.pending-preview` 容器（横向排列、可换行），卡片分两种：

- **图片卡**：保持现有缩略图样式不变
- **文件卡**：`📄` 图标 + 文件名（单行省略，`max-width` 约 140px）+ `Utils.formateSize(file.size)`；视觉语言对齐 `MessageBubble.vue` 的 `.file-msg`（同样的 `--bg-elevated` 底 + `--border` 描边），让用户一眼认出发出后的样子

两种卡片共用右上角 `×` 移除按钮（现有样式）。

### 清理

切换会话的 `watch` 和 `onUnmounted` 时遍历队列 `revokeObjectURL`（仅 image 卡有 URL）。现有 watch 已存在，扩展为遍历即可。

## 四、错误处理

| 场景 | 处理 |
|---|---|
| 拖入文件夹 | `不支持发送文件夹：xxx`，其余文件正常入队 |
| 单文件 > 500MB | `xxx 超过 500MB，已跳过` |
| 超出 9 个 | `一次最多发送 9 个文件，已忽略 N 个` |
| 上传失败 | 沿用现有机制：`setFileDownloadStatus(-1)` 停止转圈 + `updateMessageStatus(2)` 红点；气泡上已有的「重新选择文件」引导不改动 |

多类同时触发时各弹一条，不合并——用户需要知道具体哪个文件出了什么问题。

未登录/未选会话时聊天区本身不渲染，落区不存在，天然不会触发。

## 五、测试

测试文件统一放在仓库根的 `tests/` 目录（镜像 `src/` 结构），不与正式代码混放。现有 26 个测试文件一并迁移，属于本次工作范围。

- `tests/renderer/utils/attachment.test.ts` — `classifyFiles` 的超大过滤、数量截断（含已有队列时的剩余额度）、混合场景。纯函数，jsdom 环境。
- `tests/renderer/composables/useFileDrop.test.ts` — depth 计数不闪烁（enter/enter/leave 后仍为 true）、非 `Files` 类型不激活、drop 后归零、`webkitGetAsEntry().isDirectory` 的文件夹分流。
- **不新增 `MessageInput` 组件测试**：该组件现仓库中本就无测试，且重度依赖 WebSocket / axios / naive-ui 的 mock，维护成本高于收益。发送编排逻辑靠手工验证（可用 `/verify` 驱动真机）。

## 不做（YAGNI）

- 上传队列并发控制
- 预览卡片拖拽排序
- 秒传 / 断点续传
- 拖入即发（一律先进预览）

## 涉及文件

| 文件 | 变更 |
|---|---|
| `tests/**` | 新建目录 — 26 个既有测试从 `src/**` 迁入，镜像 `src/` 结构 |
| `vitest.config.ts` | 环境匹配改指 `tests/**`；新增 `@main` → `src/main` 别名 |
| `tsconfig.web.json` / `tsconfig.node.json` | include 补 `tests/**`；node 侧加 `@main/*` 路径映射 |
| `CLAUDE.md` | 更新单测命令示例与「测试说明」小节 |
| `src/renderer/src/utils/attachment.ts` | 新建 — `classifyFiles` + 限额常量 |
| `tests/renderer/utils/attachment.test.ts` | 新建 |
| `src/renderer/src/composables/useFileDrop.ts` | 新建 — depth 计数拖拽状态 |
| `tests/renderer/composables/useFileDrop.test.ts` | 新建 |
| `src/renderer/src/components/chat/MessageInput.vue` | `pendingImage` → `pendingAttachments`；新增 `addAttachments` / `sendFile`；`send()` 改串行；预览 UI 扩展；`defineExpose` |
| `src/renderer/src/pages/ChatPage.vue` | 接入 `useFileDrop`、渲染遮罩、持 `MessageInput` ref |
| `src/renderer/src/App.vue` | window 级 dragover/drop `preventDefault` 兜底 |
