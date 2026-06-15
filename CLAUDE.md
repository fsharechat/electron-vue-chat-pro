# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> 此后所有回答请用中文。

## 常用命令

```bash
# 切换到 Node 20（必须）
export NVM_DIR="$HOME/.nvm" && source "$NVM_DIR/nvm.sh" && nvm use 20

# 开发（同时启动 Electron + Vite HMR）
npm run dev

# 运行全部测试
npm test

# 运行单个测试文件
npm test -- src/main/utils/common.test.ts
npm test -- src/renderer/src/components/layout/AppTitleBar.test.ts

# 生产构建（输出到 out/）
npm run build

# 打包安装包（输出到 release/）
npm run dist          # 当前平台
npm run dist:dir      # 仅构建目录，不打包，用于快速验证
npx electron-builder --mac --linux   # 指定平台
```

## 三层进程架构

electron-vite 将代码分为三层，各自独立构建：

```
src/
  main/          → Node.js 主进程（Electron API 全量可用）
    index.ts     ← 窗口、IPC、托盘、全局快捷键
    utils/common.ts ← WIN_SIZE_LOGIN / WIN_SIZE_MAIN 常量
  preload/
    index.ts     ← contextBridge 桥接层，唯一允许使用 ipcRenderer 的地方
  renderer/
    src/         ← Vue 3 渲染进程，不可直接使用 Node/Electron API
```

**IPC 约定**：渲染进程只能通过 `window.electronAPI` 调用主进程功能（`src/types/shims.d.ts` 有完整类型声明）。新增主进程能力时需同时修改 preload/index.ts 和 shims.d.ts。

## 渲染进程架构

```
src/renderer/src/
  App.vue              ← 顶层：n-config-provider 主题、截图 overlay
  main.ts              ← Vue 挂载、router、pinia 初始化
  changelog.ts         ← 「关于」对话框的版本历史数据（新版本在此追加）
  constant/index.ts    ← 后端地址、WebSocket 命令字、localStorage key
  router/index.ts      ← /login → LoginPage；/ → AppLayout（含路由守卫）
  stores/              ← Pinia stores（见下）
  pages/               ← LoginPage、ChatPage、FriendPage
  components/layout/   ← AppLayout（主壳）、AppSidebar（64px 图标列）、AppTitleBar（无边框标题栏）
  websocket/           ← WebSocket 客户端、心跳、重连
  webrtc/              ← 音视频通话
  styles/variables.css ← 全部 CSS 变量，[data-theme="dark"] / [data-theme="light"] 双主题
```

### Pinia Stores

| Store | 职责 |
|---|---|
| useAuthStore | 登录态、token、initData() 初始化全量数据 |
| useConversationStore | 会话列表、未读角标 |
| useMessageStore | 消息列表、发送、撤回 |
| useFriendStore | 好友列表、好友请求 |
| useGroupStore | 群组信息 |
| useUIStore | 全局 UI 状态（消息提醒、截图、右键菜单）；`playMsgNotify()` 触发提示音 + 托盘闪烁 |
| useThemeStore | `isDark` / `toggle()` / `init()`，切换时写 `data-theme` 属性到 `<html>` |
| useCallStore / useGroupCallStore | 音视频通话状态 |

## CSS 主题系统

- 所有颜色使用 `src/renderer/src/styles/variables.css` 中的 CSS 变量（`--bg-*`、`--text-*`、`--accent` 等）
- **禁止在组件中硬编码颜色**，否则切换主题时失效
- `--bg-surface`：主要背景（暗色 `#11111e`，亮色 `#ffffff`）
- `--bg-overlay`：次级背景（标题栏、弹层）
- `--bg-elevated`：悬浮/hover 状态背景

## 资源路径

`src/main/index.ts` 中的 `getResourcePath()` 统一处理开发与生产路径差异：
- 开发：`__dirname/../../resources/...`
- 生产：`process.resourcesPath/...`

托盘图标、应用图标等静态资源放在 `resources/` 目录，通过 electron-builder `extraResources` 复制到打包产物。

## 测试说明

vitest 使用 `environmentMatchGlobs` 双环境：
- `src/main/**` → `node` 环境
- `src/renderer/**` → `jsdom` 环境

测试 Vue 组件时通过 `Object.defineProperty(window, 'electronAPI', ...)` mock IPC 接口。

## 打包配置

- `dependencies` 只保留 `@electron-toolkit/preload` 和 `@electron-toolkit/utils`，所有渲染层包放 `devDependencies`（electron-builder 不会将已 bundle 的包打入安装包）
- 输出目录：`out/`（构建产物）、`release/`（安装包）
- Node ≥ 20 required（项目根有 `.nvmrc`）
