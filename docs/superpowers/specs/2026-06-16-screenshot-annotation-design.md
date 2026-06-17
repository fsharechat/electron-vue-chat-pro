# 截图标注功能设计文档

**日期：** 2026-06-16  
**状态：** 已确认，待实现

---

## 1. 需求概述

在聊天输入区工具栏增加截图按钮，用户可截取桌面任意区域，在截图上做标注，然后将截图发送到当前会话。快捷键和工具栏按钮行为统一，通过「隐藏当前窗口」开关控制是否在截图中包含飞享应用本身。

---

## 2. 截图触发与模式

### 2.1 工具栏截图按钮

位置：`MessageInput.vue` 工具栏，表情按钮右侧，图片按钮左侧。

样式：✂ 图标 + ▾ 下拉箭头（分体按钮）。

- 点击 ✂：按当前「隐藏当前窗口」设置立即截图
- 点击 ▾：展开下拉菜单，显示「✓ 隐藏当前窗口」开关

### 2.2 键盘快捷键

`Ctrl+Alt+Z`：同样按「隐藏当前窗口」设置截图，与工具栏按钮行为完全一致。触发链路：主进程 globalShortcut 捕获快捷键 → 发 `kbd-screenshot` IPC 给渲染层 → 渲染层读 localStorage 得到 `hideWindow` → 渲染层发 `start-screenshot { hideWindow }` 回主进程 → 主进程执行截图（与工具栏按钮走同一路径）。

### 2.3 「隐藏当前窗口」设置

- 存储：`localStorage('screenshot-hide-window')`
- 默认值：`false`（不隐藏，截图包含飞享应用窗口）
- 全局生效，工具栏按钮和快捷键共用

### 2.4 两种截图模式

两种模式均使用 `desktopCapturer` 截取整个桌面，区别仅在于截图前是否隐藏应用窗口：

| `hideWindow` | 流程 |
|---|---|
| `false`（默认） | 直接 `desktopCapturer` 截全桌面（含飞享窗口）→ 应用窗口扩为全屏覆盖层 → 显示截图 overlay |
| `true` | 先 `mainWindow.hide()` → 等 150ms → `desktopCapturer` 截全桌面 → 窗口扩为全屏覆盖层 → 显示截图 overlay |

截图完成/取消后，主进程通过 `screenshot-done` / `screenshot-cancel` IPC 恢复窗口原始 bounds。

---

## 3. IPC 设计

### 3.1 新增 / 变更的 IPC 通道

| 方向 | 通道 | 参数 | 说明 |
|---|---|---|---|
| 渲染 → 主 | `start-screenshot` | `{ hideWindow: boolean }` | 工具栏按钮触发截图 |
| 主 → 渲染 | `trigger-screenshot` | `{ screenshotDataUrl, originalBounds }` | 主进程截图完成，通知渲染层展示 overlay |
| 渲染 → 主 | `screenshot-done` | `Rectangle` | 用户确认，恢复窗口 |
| 渲染 → 主 | `screenshot-cancel` | `Rectangle` | 用户取消，恢复窗口 |

快捷键由主进程 `globalShortcut` 注册，触发后发 `kbd-screenshot` IPC 给渲染层，渲染层读 localStorage 后再发 `start-screenshot` 回主进程，与工具栏按钮走相同路径。

### 3.2 Preload 暴露

```ts
startScreenshot(hideWindow: boolean): void
onTriggerScreenshot(cb: (data: { screenshotDataUrl: string; originalBounds: Rectangle }) => void): () => void
screenshotDone(bounds: Rectangle): void
screenshotCancel(bounds: Rectangle): void
```

---

## 4. ScreenshotOverlay 组件

### 4.1 两阶段 UX

**Phase 1 · 框选区域**
- 全屏 canvas，背景为截图 + 暗色遮罩
- 鼠标拖拽绘制蓝色选框
- 松开鼠标且选区有效（w > 0 && h > 0）→ 进入 Phase 2

**Phase 2 · 标注编辑**
- 选区内显示清晰截图，选区外保持暗色遮罩
- 底部出现标注工具栏
- ESC 键：若 Phase 2 则退回 Phase 1 重新框选；若 Phase 1 则取消

### 4.2 Canvas 分层

```
┌─────────────────────────────────────┐
│ annotationCanvas（透明，绝对定位）   │ ← 所有用户标注
├─────────────────────────────────────┤
│ bgCanvas（背景）                    │ ← 截图 + 遮罩 + 选框
└─────────────────────────────────────┘
```

两层 canvas 叠放，`bgCanvas` 在下，`annotationCanvas` 在上（`pointer-events` 转发给 annotationCanvas）。

### 4.3 标注工具

工具栏布局（底部居中，圆角浮动卡片）：

```
[ □矩形 | ↗箭头 | T文字 | ⊞马赛克 ]  |  [ ● ● ● ● ● ● ● ● ]  |  [ ↺ | ⬇ | ✕ | ✓ ]
```

**颜色面板**：红、橙、黄、绿、蓝、紫、白、黑（8 种，默认红色）

| 工具 | 交互 | 实现 |
|---|---|---|
| 矩形 | mousedown 起点 → mousemove 预览 → mouseup 提交 | Canvas strokeRect，使用当前颜色 |
| 箭头 | 同矩形，但 mouseup 时在终点绘制箭头头部 | 计算角度后绘制两条斜线 |
| 文字 | click 放置绝对定位 `<input>` → 失焦/Enter 提交 | 提交时 `ctx.fillText` 绘入 annotationCanvas |
| 马赛克 | mousedown+drag 框选区域 → mouseup 提交 | 对背景截图该区域像素化（缩小再放大）后绘入 annotationCanvas |

**撤销（↺）**：每次工具提交前将 annotationCanvas 的 `getImageData()` 压栈，撤销时 `putImageData()` 恢复。

**保存（⬇）**：合并 bgCanvas（选区内无遮罩版本）+ annotationCanvas → 调用 `electronAPI.showSaveDialog` → 保存 PNG 文件。

**取消（✕）**：清空 annotationCanvas，退回 Phase 1 重新框选。

**确认（✓）**：合并两层 canvas，裁剪选区，emit `done(dataUrl)`。

### 4.4 Props / Emits

```ts
props: { show: boolean; screenshotSrc: string }
emits: { cancel: []; done: [dataUrl: string] }
```

---

## 5. MessageInput 变更

### 5.1 工具栏截图按钮

在现有工具栏 `表情 | 图片 | 文件` 之后插入：

```html
<div class="tool-btn-group">
  <button class="tool-btn" @click="triggerScreenshot">✂</button>
  <button class="tool-btn tool-btn-arrow" @click="toggleScreenshotMenu">▾</button>
</div>
```

下拉菜单使用 `n-dropdown` 或自定义浮层，显示「✓ 隐藏当前窗口」选项（n-checkbox 风格）。

### 5.2 图片预览区

位置：toolbar 与 textarea 之间，仅有待发图片时显示。

```
┌──────────────────────────────────────────┐
│  [缩略图 80×60]  [×]                     │
└──────────────────────────────────────────┘
```

- 最多同时显示 **1 张**图片（新图替换旧图，旧图 `URL.revokeObjectURL` 释放）
- 来源：截图确认 / Ctrl+V 粘贴图片（两者均进入预览，不再自动发送）
- 点击缩略图可展示原图弹窗（可选，低优先级）
- 点击 × 移除，对象 URL 即时 revoke

### 5.3 发送逻辑变更

```
sendBtnActive = content.trim().length > 0 || pendingImage !== null

send():
  if pendingImage → sendImage(pendingImage.file)，revoke URL，清空
  if content.trim() → sendTextMessage(content)，清空
```

图片消息和文字消息**分开发送**（两条独立消息），先图后文。

### 5.4 粘贴行为变更

`onPaste` 检测到图片类型 clipboard item → 转为 File → 设为 `pendingImage`（不再自动发送）。

---

## 6. 数据流总览

```
用户触发截图（工具栏/快捷键）
  → 渲染层发 start-screenshot { hideWindow }
  → 主进程：[可选 hide()] → desktopCapturer → setBounds(全屏) → 发 trigger-screenshot
  → App.vue 收到 → showScreenshot=true，screenshotSrc=dataUrl

用户框选 + 标注 + 确认
  → ScreenshotOverlay emit done(croppedDataUrl)
  → App.vue → screenshotDone IPC（恢复窗口）→ uiStore.pendingScreenshotDataUrl = dataUrl

MessageInput 监听 pendingScreenshotDataUrl
  → 转为 File → 设为 pendingImage（展示缩略图）
  → 用户点「发送」→ sendImage(file) + sendText(content)
```

---

## 7. 不在本次范围内

- 多张图片队列
- 标注工具：椭圆、直线、荧光笔
- 截图 OCR
- 图片发送后的编辑/撤回
- 标注画笔粗细调整
