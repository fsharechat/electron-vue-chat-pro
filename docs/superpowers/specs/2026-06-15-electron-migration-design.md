# 飞享IM Electron 迁移设计文档

**日期**: 2026-06-15  
**源项目**: `vue-chat-pro-claude`（Vue 3 + TypeScript + Pinia + Vite 5）  
**参考项目**: `electron-vue-chat`（Vue 2 + Webpack + Electron 6，设计模式参考）  
**目标项目**: `electron-vue-chat-pro`（Electron latest + electron-vite + Vue 3）

---

## 一、技术选型

| 维度 | 选型 | 说明 |
|---|---|---|
| 构建框架 | `electron-vite` | Vite 原生支持 main/preload/renderer 三层，官方维护 |
| Electron 版本 | latest（~35.x） | 替换旧版 6.x |
| 打包工具 | `electron-builder` | 保持与参考项目一致 |
| 安全模型 | contextIsolation: true + preload | 现代最佳实践，替换 nodeIntegration |
| 前端框架 | Vue 3 + TypeScript + Pinia | 直接沿用 vue-chat-pro-claude |
| UI 组件库 | naive-ui | 保持不变 |

---

## 二、项目目录结构

```
electron-vue-chat-pro/
├── electron.vite.config.ts          # electron-vite 统一构建入口
├── package.json                     # 合并依赖，含 electron-builder build 配置
├── tsconfig.json                    # 根 tsconfig（引用三层子配置）
├── tsconfig.node.json               # main/preload 的 tsconfig
│
├── src/
│   ├── main/                        # 主进程 (Node.js + Electron API)
│   │   ├── index.ts                 # 窗口、托盘、快捷键、IPC、权限
│   │   └── utils/
│   │       └── common.ts            # 窗口尺寸常量
│   │
│   ├── preload/                     # 预加载脚本（在沙盒中运行，可访问 ipcRenderer）
│   │   └── index.ts                 # contextBridge 暴露 window.electronAPI
│   │
│   └── renderer/                    # 渲染进程（完整 Vue 3 应用）
│       ├── index.html               # 入口 HTML
│       └── src/                     # 从 vue-chat-pro-claude/src/ 整体拷贝
│           ├── main.ts
│           ├── App.vue
│           ├── assets/
│           ├── components/
│           │   ├── chat/
│           │   ├── common/
│           │   ├── conversation/
│           │   ├── friend/
│           │   ├── group/
│           │   └── layout/
│           │       ├── AppLayout.vue        # 引入 AppTitleBar（新增）
│           │       ├── AppSidebar.vue
│           │       └── AppTitleBar.vue      # 新增：自定义标题栏
│           ├── constant/
│           ├── pages/
│           ├── router/
│           ├── stores/
│           ├── styles/
│           ├── types/
│           │   ├── index.ts
│           │   └── shims.d.ts               # 补充 window.electronAPI 类型声明
│           ├── webrtc/
│           └── websocket/
│
├── resources/                       # 原生资源（随应用打包）
│   ├── icons/
│   │   ├── icon.icns                # macOS 应用图标
│   │   ├── icon.ico                 # Windows 应用图标
│   │   └── 256x256.png             # Linux / 通用
│   ├── tray.png                     # 系统托盘正常图标
│   ├── tray-mac.png                 # macOS 托盘图标
│   └── empty-tray.png              # 托盘闪烁空白帧
│
└── release/                         # electron-builder 打包输出（gitignore）
```

---

## 三、主进程设计（`src/main/index.ts`）

### 3.1 BrowserWindow 配置

```typescript
const WIN_SIZE_LOGIN = { width: 880, height: 520 }
const WIN_SIZE_MAIN  = { width: 1080, height: 720 }

new BrowserWindow({
  ...WIN_SIZE_LOGIN,
  frame: false,          // 无系统边框，由渲染进程自绘标题栏
  transparent: true,     // 透明背景支持圆角
  show: false,           // ready-to-show 后再显示，避免白屏闪烁
  resizable: false,      // 登录态不可拉伸
  autoHideMenuBar: true,
  webPreferences: {
    preload: join(__dirname, '../preload/index.js'),
    contextIsolation: true,     // 安全隔离
    nodeIntegration: false,     // 禁用 Node 直接访问
    webSecurity: false,         // 允许外部 CDN（高德地图等）
  }
})
```

### 3.2 应用生命周期

```
app.ready
  ├─ macOS: systemPreferences.askForMediaAccess('camera' | 'microphone')
  ├─ session.setPermissionRequestHandler → 放行 camera/microphone/notifications
  ├─ createWindow()
  └─ registerScreenshotShortcut()

mainWindow.ready-to-show → show() + focus()

mainWindow.close
  ├─ 已登录且非强制退出 → preventDefault + hide()（最小化到托盘）
  └─ 否则 → 正常退出

app.activate（macOS） → mainWindow 不存在则创建，存在则 show()
app.before-quit → 设置 forceQuit = true（允许关闭窗口）
app.window-all-closed（非 macOS） → app.quit()
```

### 3.3 IPC 事件处理

| 事件名 | 方向 | 主进程动作 |
|---|---|---|
| `hasLogged` | renderer → main | 根据 `isLogged` 切换窗口尺寸/resizable；登录后创建托盘，登出后销毁 |
| `hasFlashTray` | renderer → main | 启动/停止托盘闪烁计时器 |
| `window-control` | renderer → main | `minimize` / `maximize` / `close` 操作窗口 |
| `get-screen-sources` | renderer → main（invoke） | 调用 `desktopCapturer.getSources()` 返回屏幕源列表 |
| `write-clipboard` | renderer → main | 将 base64 dataURL 写入系统剪贴板 |
| `isLogged`（发出） | main → renderer | 告知渲染进程当前登录态（窗口尺寸切换后同步） |
| `trigger-screenshot`（发出） | main → renderer | 通知渲染进程开始截图流程 |

### 3.4 窗口尺寸切换

```typescript
ipcMain.on('hasLogged', (_, isLogged: boolean) => {
  logined = isLogged
  const size = isLogged ? WIN_SIZE_MAIN : WIN_SIZE_LOGIN
  mainWindow.setSize(size.width, size.height)
  mainWindow.center()
  mainWindow.setResizable(isLogged)
  mainWindow.webContents.send('isLogged', isLogged)

  if (isLogged && !tray) createTray()
  if (!isLogged && tray) destroyTray()
})
```

### 3.5 系统托盘

- 登录后创建，登出/退出后销毁
- 图标路径区分平台：macOS 用 `tray-mac.png`，其他用 `tray.png`
- 右键菜单：打开主界面 / 退出
- 单击图标：`restore() + show() + focus()`，同时停止闪烁
- 闪烁动画：`setInterval(700ms)` 交替 `tray.png` ↔ `empty-tray.png`

### 3.6 截图快捷键（自实现）

**注册**：`globalShortcut.register('Ctrl+Alt+Z', handler)`

**流程**：

```
Ctrl+Alt+Z 触发
  ├─ mainWindow.webContents.send('trigger-screenshot')
  │
渲染进程收到通知
  ├─ 调用 electronAPI.getScreenSources()
  │     └─ 主进程: desktopCapturer.getSources({types:['screen'], thumbnailSize:{width,height}})
  │            返回 [{id, name, thumbnail}] 给渲染进程
  ├─ 渲染进程: navigator.mediaDevices.getUserMedia({
  │     video: { mandatory: { chromeMediaSource:'desktop', chromeMediaSourceId: sourceId } }
  │   }) → 获取 MediaStream
  ├─ 渲染进程: 绘制到 canvas，弹出截图裁剪浮层（ScreenshotOverlay.vue）
  └─ 用户点击确认 → electronAPI.writeImageToClipboard(dataUrl)
         └─ 主进程: clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
```

`ScreenshotOverlay.vue` 是新增组件，包含：画布渲染、鼠标拖拽选区、确认/取消按钮。

---

## 四、Preload 脚本（`src/preload/index.ts`）

```typescript
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  // 窗口控制
  windowControl: (action: 'minimize' | 'maximize' | 'close') =>
    ipcRenderer.send('window-control', action),

  // 登录状态同步
  setLoggedIn: (isLogged: boolean) => ipcRenderer.send('hasLogged', isLogged),
  onIsLogged: (cb: (v: boolean) => void) => {
    ipcRenderer.on('isLogged', (_, v) => cb(v))
    return () => ipcRenderer.removeAllListeners('isLogged')
  },

  // 托盘闪烁
  setFlashTray: (flash: boolean) => ipcRenderer.send('hasFlashTray', flash),

  // 截图
  onTriggerScreenshot: (cb: () => void) => {
    ipcRenderer.on('trigger-screenshot', cb)
    return () => ipcRenderer.removeAllListeners('trigger-screenshot')
  },
  getScreenSources: () => ipcRenderer.invoke('get-screen-sources'),
  writeImageToClipboard: (dataUrl: string) =>
    ipcRenderer.send('write-clipboard', dataUrl),
})
```

**类型声明**（补充到 `src/renderer/src/types/shims.d.ts`）：

```typescript
interface ElectronAPI {
  windowControl(action: 'minimize' | 'maximize' | 'close'): void
  setLoggedIn(isLogged: boolean): void
  onIsLogged(cb: (v: boolean) => void): () => void
  setFlashTray(flash: boolean): void
  onTriggerScreenshot(cb: () => void): () => void
  getScreenSources(): Promise<Array<{ id: string; name: string; thumbnail: string }>>
  writeImageToClipboard(dataUrl: string): void
}

declare interface Window {
  electronAPI?: ElectronAPI
}
```

所有调用点用 `window.electronAPI?.xxx`，确保纯 Web 模式正常运行。

---

## 五、渲染进程改动清单

### 5.1 新增文件

| 文件 | 说明 |
|---|---|
| `components/layout/AppTitleBar.vue` | 自定义无边框标题栏，含拖拽区 + 三个窗口控制按钮 |
| `components/common/ScreenshotOverlay.vue` | 截图裁剪浮层，canvas 渲染 + 选区拖拽 |

**AppTitleBar 关键 CSS**：

```css
.title-bar {
  -webkit-app-region: drag;   /* 可拖拽区域 */
  height: 32px;
}
.title-bar button {
  -webkit-app-region: no-drag; /* 按钮不参与拖拽 */
}
```

### 5.2 修改文件

**`src/stores/useAuthStore.ts`**：
- 登录成功回调处：`window.electronAPI?.setLoggedIn(true)`
- 登出处：`window.electronAPI?.setLoggedIn(false)`

**`src/components/layout/AppLayout.vue`**：
- 顶部引入 `<AppTitleBar />`
- 窗口 focus 事件处：`window.electronAPI?.setFlashTray(false)`

**`src/stores/useUIStore.ts`** 或消息通知处：
- 收到新消息弹通知时：`window.electronAPI?.setFlashTray(true)`

**`src/App.vue`**：
- mounted 时注册 `electronAPI.onTriggerScreenshot` 监听，触发 `ScreenshotOverlay` 显示

**`src/types/shims.d.ts`**：
- 追加 `ElectronAPI` 接口和 `Window.electronAPI` 声明（见第四节）

---

## 六、`electron.vite.config.ts`

```typescript
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { readFileSync } from 'fs'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()]
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    root: 'src/renderer',
    plugins: [vue()],
    resolve: {
      alias: { '@': resolve('src/renderer/src') }
    },
    server: { port: 9080 },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    }
  }
})
```

---

## 七、`package.json` 关键配置

```json
{
  "name": "electron-vue-chat-pro",
  "version": "1.2.6",
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "dist": "npm run build && electron-builder",
    "dist:dir": "npm run build && electron-builder --dir"
  },
  "build": {
    "productName": "飞享IM",
    "appId": "com.comsince.fshare",
    "directories": { "output": "release" },
    "files": ["out/**/*", "resources/**/*"],
    "mac": {
      "icon": "resources/icons/icon.icns",
      "entitlements": "resources/entitlements.mac.plist",
      "entitlementsInherit": "resources/entitlements.mac.plist"
    },
    "win": {
      "icon": "resources/icons/icon.ico",
      "target": [{ "target": "nsis", "arch": ["x64", "ia32"] }]
    },
    "linux": {
      "icon": "resources/icons",
      "target": ["AppImage", "deb"],
      "category": "Network"
    },
    "nsis": {
      "oneClick": false,
      "allowToChangeInstallationDirectory": true
    }
  }
}
```

---

## 八、依赖变化

### 新增依赖

| 包 | 分类 | 用途 |
|---|---|---|
| `electron` (~35.x) | devDependencies | 主运行时 |
| `electron-vite` | devDependencies | 构建框架 |
| `electron-builder` | devDependencies | 打包发布 |
| `@electron-toolkit/preload` | dependencies | contextBridge 类型辅助 |
| `@electron-toolkit/utils` | dependencies | `is.dev`、`optimizer` 等工具 |

### 移除依赖（对比旧版参考项目，无需引入）

- webpack 全家桶（由 Vite 替代）
- `electron-screenshots`（改为 desktopCapturer 自实现）
- `vue-electron`（Vue 2 绑定，已废弃）
- `element-ui`（Vue 3 已用 naive-ui）
- `vuex`（已用 Pinia）

---

## 九、兼容性注意事项

| 问题 | 说明 | 解决方案 |
|---|---|---|
| `streamsaver` 依赖 Service Worker | Electron 渲染进程对 SW 有限制 | 文件下载改用主进程 `fs.createWriteStream` + `dialog.showSaveDialog`，通过 IPC 委托 |
| `@amap/amap-jsapi-loader` 外部请求 | 需加载高德 CDN JS | `webSecurity: false` 已覆盖 |
| macOS 无边框透明窗口 | 需 CSS 配合圆角 | `border-radius` + 必要时启用 `vibrancy` |
| `desktopCapturer` 权限（macOS） | 屏幕录制权限需用户授权 | `systemPreferences.getMediaAccessStatus('screen')` 检测；Electron 35 在使用时系统会自动弹出授权弹窗 |
| `globalShortcut` 与其他应用冲突 | `Ctrl+Alt+Z` 可能被占用 | `register` 返回 false 时打日志提示，不中断启动流程 |

---

## 十、实现阶段划分

| 阶段 | 内容 |
|---|---|
| P1 基础骨架 | 初始化 electron-vite 项目，配置 `electron.vite.config.ts`，确认 `npm run dev` 能启动空窗口 |
| P2 源码迁移 | 将 vue-chat-pro-claude/src/ 拷贝到 renderer/src/，修复路径，确认 Vue 应用渲染正常 |
| P3 IPC 接入 | 实现 preload，在 useAuthStore 接入 setLoggedIn，验证窗口尺寸切换 |
| P4 系统托盘 | 实现托盘创建/销毁/闪烁，联动消息通知 |
| P5 标题栏 | 实现 AppTitleBar.vue，验证拖拽和窗口控制按钮 |
| P6 截图 | 实现 ScreenshotOverlay.vue + desktopCapturer 流程，验证 Ctrl+Alt+Z |
| P7 打包 | electron-builder 打包 macOS/Windows，验证资源路径 |
