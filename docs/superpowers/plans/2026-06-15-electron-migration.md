# Electron Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 `vue-chat-pro-claude`（Vue 3 + Vite）包装为现代 Electron 桌面应用，输出到 `electron-vue-chat-pro` 仓库。

**Architecture:** electron-vite 统一构建 main/preload/renderer 三层；contextIsolation + preload/contextBridge 安全 IPC；Vue 3 源码整体迁入 `src/renderer/src/`，仅在少数接入点调用 `window.electronAPI`。

**Tech Stack:** Electron ~35, electron-vite, electron-builder, Vue 3, TypeScript, Pinia, naive-ui, Vitest

---

## 文件地图

| 路径 | 操作 | 说明 |
|---|---|---|
| `package.json` | 创建 | 合并依赖 + electron-builder 配置 |
| `electron.vite.config.ts` | 创建 | main/preload/renderer 三层 Vite 配置 |
| `tsconfig.json` | 创建 | 项目引用根 |
| `tsconfig.node.json` | 创建 | main + preload TypeScript 配置 |
| `tsconfig.web.json` | 创建 | renderer TypeScript 配置 |
| `vitest.config.ts` | 创建 | 测试配置 |
| `.gitignore` | 创建 | 忽略 out/ release/ node_modules/ |
| `src/main/utils/common.ts` | 创建 | 窗口尺寸常量 |
| `src/main/index.ts` | 创建 | 主进程：窗口/IPC/托盘/快捷键/截图 |
| `src/preload/index.ts` | 创建 | contextBridge → window.electronAPI |
| `src/renderer/index.html` | 创建 | 渲染进程入口 HTML（直接拷贝根 index.html） |
| `src/renderer/src/` | 迁移 | 整体拷贝 vue-chat-pro-claude/src/ |
| `src/renderer/public/` | 迁移 | 音频/图片/emoji 等静态资源 |
| `resources/icons/` | 迁移 | 应用图标（icns/ico/png） |
| `resources/tray*.png` | 迁移 | 系统托盘图标 |
| `resources/empty-tray.png` | 迁移 | 托盘闪烁空白帧 |
| `resources/entitlements.mac.plist` | 创建 | macOS 媒体权限声明 |
| `src/renderer/src/types/shims.d.ts` | 修改 | 追加 ElectronAPI 接口 + Window 声明 |
| `src/renderer/src/components/layout/AppLayout.vue` | 修改 | onMounted 加 setLoggedIn(true)；引入 AppTitleBar |
| `src/renderer/src/stores/useAuthStore.ts` | 修改 | loginOut() 加 setLoggedIn(false) |
| `src/renderer/src/stores/useUIStore.ts` | 修改 | playMsgNotify 加 setFlashTray(true)；unreadTotalCount 为 0 时 setFlashTray(false) |
| `src/renderer/src/components/layout/AppTitleBar.vue` | 创建 | 无边框自定义标题栏（拖拽 + 三个窗口控制按钮） |
| `src/renderer/src/components/common/ScreenshotOverlay.vue` | 创建 | 截图裁剪浮层（canvas 拖拽选区 + 确认/取消） |
| `src/renderer/src/App.vue` | 修改 | 注册 onTriggerScreenshot 监听；挂载 ScreenshotOverlay |

---

## Task 1: 项目配置文件

**Files:**
- Create: `package.json`
- Create: `electron.vite.config.ts`
- Create: `tsconfig.json`
- Create: `tsconfig.node.json`
- Create: `tsconfig.web.json`
- Create: `vitest.config.ts`
- Create: `.gitignore`

- [ ] **Step 1: 创建 package.json**

```json
{
  "name": "electron-vue-chat-pro",
  "version": "1.2.6",
  "description": "飞享IM Desktop",
  "private": true,
  "main": "./out/main/index.js",
  "scripts": {
    "dev": "electron-vite dev",
    "build": "electron-vite build",
    "preview": "electron-vite preview",
    "test": "vitest run",
    "dist": "npm run build && electron-builder",
    "dist:dir": "npm run build && electron-builder --dir"
  },
  "build": {
    "productName": "飞享IM",
    "appId": "com.comsince.fshare",
    "directories": { "output": "release" },
    "files": ["out/**/*"],
    "extraResources": [
      { "from": "resources", "to": "." }
    ],
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
  },
  "dependencies": {
    "@amap/amap-jsapi-loader": "^1.0.1",
    "@electron-toolkit/preload": "^3.0.0",
    "@electron-toolkit/utils": "^3.0.0",
    "@wcjiang/notify": "^2.0.12",
    "axios": "^1.6.0",
    "benz-amr-recorder": "^1.1.2",
    "clipboard": "^2.0.11",
    "crypto-js": "^4.2.0",
    "kurento-utils": "^6.15.0",
    "linkify-urls": "^4.0.0",
    "marked": "^9.1.6",
    "naive-ui": "^2.38.0",
    "pinia": "^2.1.7",
    "pinyin-pro": "^3.18.0",
    "qiniu-js": "^3.4.4",
    "streamsaver": "^2.0.6",
    "uuid": "^9.0.1",
    "vue": "^3.4.0",
    "vue-router": "^4.3.0",
    "webrtc-adapter": "^9.0.1"
  },
  "devDependencies": {
    "@types/crypto-js": "^4.2.2",
    "@types/node": "^20.0.0",
    "@types/uuid": "^9.0.7",
    "@vitejs/plugin-vue": "^5.0.0",
    "@vue/test-utils": "^2.4.0",
    "electron": "^35.0.0",
    "electron-builder": "^25.0.0",
    "electron-vite": "^3.0.0",
    "typescript": "^5.3.0",
    "vfonts": "^0.0.3",
    "vite": "^5.0.0",
    "vitest": "^1.0.0",
    "vue-tsc": "^2.0.0"
  }
}
```

- [ ] **Step 2: 创建 electron.vite.config.ts**

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
      alias: { '@': resolve(__dirname, 'src/renderer/src') }
    },
    server: { port: 9080 },
    define: {
      __APP_VERSION__: JSON.stringify(pkg.version)
    }
  }
})
```

- [ ] **Step 3: 创建 tsconfig 文件**

创建 `tsconfig.json`：
```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.node.json" },
    { "path": "./tsconfig.web.json" }
  ]
}
```

创建 `tsconfig.node.json`：
```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022"],
    "strict": true,
    "skipLibCheck": true,
    "types": ["node", "electron-vite/node"]
  },
  "include": [
    "electron.vite.config.*",
    "src/main/**/*",
    "src/preload/**/*"
  ]
}
```

创建 `tsconfig.web.json`：
```json
{
  "compilerOptions": {
    "composite": true,
    "target": "ES2020",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "strict": true,
    "skipLibCheck": true,
    "jsx": "preserve",
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/renderer/src/*"]
    }
  },
  "include": ["src/renderer/src/**/*"]
}
```

- [ ] **Step 4: 创建 vitest.config.ts**

```typescript
import { defineConfig } from 'vitest/config'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  test: {
    globals: true,
    environmentMatchGlobs: [
      ['src/main/**', 'node'],
      ['src/renderer/**', 'jsdom'],
    ],
  },
  resolve: {
    alias: { '@': resolve(__dirname, 'src/renderer/src') }
  }
})
```

- [ ] **Step 5: 创建 .gitignore**

```
node_modules/
out/
release/
.DS_Store
*.local
dist/
```

- [ ] **Step 6: 安装依赖，验证成功**

```bash
npm install
```

预期：无 npm error，`node_modules/electron-vite` 目录存在。

```bash
ls node_modules | grep electron
```

预期输出包含：`electron`、`electron-builder`、`electron-vite`

- [ ] **Step 7: Commit**

```bash
git add package.json electron.vite.config.ts tsconfig.json tsconfig.node.json tsconfig.web.json vitest.config.ts .gitignore
git commit -m "chore: project bootstrap — electron-vite config and tsconfigs"
```

---

## Task 2: 渲染进程源码迁移

**Files:**
- Create: `src/renderer/index.html`
- Create: `src/renderer/src/` (从 vue-chat-pro-claude 拷贝)
- Create: `src/renderer/public/` (静态资源)

- [ ] **Step 1: 创建目录并拷贝 Vue 源码**

```bash
mkdir -p src/renderer/src src/renderer/public
cp -r /Users/liaojinlong/Share/GitWorkplace/github/fshare/vue-chat-pro-claude/src/* src/renderer/src/
```

预期：`src/renderer/src/main.ts`、`src/renderer/src/App.vue` 等文件存在。

- [ ] **Step 2: 拷贝静态资源到 renderer public**

```bash
cp -r /Users/liaojinlong/Share/GitWorkplace/github/fshare/electron-vue-chat/static/audio src/renderer/public/
cp -r /Users/liaojinlong/Share/GitWorkplace/github/fshare/electron-vue-chat/static/images src/renderer/public/
cp -r /Users/liaojinlong/Share/GitWorkplace/github/fshare/electron-vue-chat/static/emoji src/renderer/public/
cp -r /Users/liaojinlong/Share/GitWorkplace/github/fshare/electron-vue-chat/static/css src/renderer/public/
cp /Users/liaojinlong/Share/GitWorkplace/github/fshare/vue-chat-pro-claude/public/favicon.ico src/renderer/public/
```

- [ ] **Step 3: 创建 src/renderer/index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN" data-theme="dark">
  <head>
    <meta charset="UTF-8" />
    <link rel="shortcut icon" type="image/x-icon" href="/favicon.ico" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob: https: http: ws: wss:; media-src 'self' blob: https: http:;">
    <title>飞享</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

- [ ] **Step 4: Commit**

```bash
git add src/renderer/
git commit -m "feat: migrate Vue 3 renderer source and static assets"
```

---

## Task 3: 应用图标和托盘资源

**Files:**
- Create: `resources/icons/` (应用图标)
- Create: `resources/tray.png`, `resources/tray-mac.png`, `resources/empty-tray.png`
- Create: `resources/entitlements.mac.plist`

- [ ] **Step 1: 拷贝应用图标**

```bash
mkdir -p resources/icons
cp /Users/liaojinlong/Share/GitWorkplace/github/fshare/electron-vue-chat/static/icons/256x256.png resources/icons/
cp /Users/liaojinlong/Share/GitWorkplace/github/fshare/electron-vue-chat/static/icons/icon.icns resources/icons/
cp /Users/liaojinlong/Share/GitWorkplace/github/fshare/electron-vue-chat/static/icons/icon.ico resources/icons/
```

- [ ] **Step 2: 拷贝托盘图标**

```bash
cp /Users/liaojinlong/Share/GitWorkplace/github/fshare/electron-vue-chat/static/tray.png resources/
cp /Users/liaojinlong/Share/GitWorkplace/github/fshare/electron-vue-chat/static/tray-mac.png resources/
cp /Users/liaojinlong/Share/GitWorkplace/github/fshare/electron-vue-chat/static/empty-tray.png resources/
```

- [ ] **Step 3: 创建 macOS 权限声明 resources/entitlements.mac.plist**

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.cs.allow-jit</key>
  <true/>
  <key>com.apple.security.cs.allow-unsigned-executable-memory</key>
  <true/>
  <key>com.apple.security.cs.disable-library-validation</key>
  <true/>
  <key>com.apple.security.device.camera</key>
  <true/>
  <key>com.apple.security.device.microphone</key>
  <true/>
  <key>com.apple.security.network.client</key>
  <true/>
</dict>
</plist>
```

- [ ] **Step 4: 验证文件存在**

```bash
ls resources/ && ls resources/icons/
```

预期输出：
```
entitlements.mac.plist  icons  tray-mac.png  tray.png  empty-tray.png
256x256.png  icon.icns  icon.ico
```

- [ ] **Step 5: Commit**

```bash
git add resources/
git commit -m "chore: add app icons, tray images and macOS entitlements"
```

---

## Task 4: 主进程工具函数（TDD）

**Files:**
- Create: `src/main/utils/common.ts`
- Test: `src/main/utils/common.test.ts`

- [ ] **Step 1: 编写失败测试 src/main/utils/common.test.ts**

```typescript
import { describe, it, expect } from 'vitest'
import { WIN_SIZE_LOGIN, WIN_SIZE_MAIN } from './common'

describe('window size constants', () => {
  it('login window is 880x520', () => {
    expect(WIN_SIZE_LOGIN).toEqual({ width: 880, height: 520 })
  })

  it('main window is 1080x720', () => {
    expect(WIN_SIZE_MAIN).toEqual({ width: 1080, height: 720 })
  })

  it('main window is larger than login window', () => {
    expect(WIN_SIZE_MAIN.width).toBeGreaterThan(WIN_SIZE_LOGIN.width)
    expect(WIN_SIZE_MAIN.height).toBeGreaterThan(WIN_SIZE_LOGIN.height)
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npm test -- src/main/utils/common.test.ts
```

预期：`Cannot find module './common'`

- [ ] **Step 3: 创建 src/main/utils/common.ts**

```typescript
export const WIN_SIZE_LOGIN = { width: 880, height: 520 } as const
export const WIN_SIZE_MAIN  = { width: 1080, height: 720 } as const
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npm test -- src/main/utils/common.test.ts
```

预期：
```
✓ login window is 880x520
✓ main window is 1080x720
✓ main window is larger than login window
Test Files  1 passed (1)
```

- [ ] **Step 5: Commit**

```bash
git add src/main/utils/common.ts src/main/utils/common.test.ts
git commit -m "feat: add main process window size constants"
```

---

## Task 5: Preload 脚本

**Files:**
- Create: `src/preload/index.ts`

- [ ] **Step 1: 创建 src/preload/index.ts**

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

  onTriggerScreenshot: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('trigger-screenshot', handler)
    return () => ipcRenderer.removeListener('trigger-screenshot', handler)
  },

  getScreenSources: (): Promise<Array<{ id: string; name: string; thumbnail: string }>> =>
    ipcRenderer.invoke('get-screen-sources'),

  writeImageToClipboard: (dataUrl: string): void =>
    ipcRenderer.send('write-clipboard', dataUrl),
})
```

- [ ] **Step 2: Commit**

```bash
git add src/preload/index.ts
git commit -m "feat: add preload contextBridge for window.electronAPI"
```

---

## Task 6: 主进程核心

**Files:**
- Create: `src/main/index.ts`

- [ ] **Step 1: 创建 src/main/index.ts**

```typescript
import {
  app, BrowserWindow, ipcMain, Tray, Menu,
  nativeImage, globalShortcut, systemPreferences,
  desktopCapturer, clipboard
} from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { WIN_SIZE_LOGIN, WIN_SIZE_MAIN } from './utils/common'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let logined = false
let forceQuit = false
let flashTrayTimer: ReturnType<typeof setInterval> | null = null

const trayIconName = process.platform === 'darwin' ? 'tray-mac.png' : 'tray.png'

function getResourcePath(...paths: string[]): string {
  return is.dev
    ? join(__dirname, '../../resources', ...paths)
    : join(process.resourcesPath, ...paths)
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    ...WIN_SIZE_LOGIN,
    frame: false,
    transparent: true,
    show: false,
    resizable: false,
    autoHideMenuBar: true,
    icon: getResourcePath('icons', '256x256.png'),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    }
  })

  mainWindow.webContents.session.setPermissionRequestHandler(
    (_, permission, callback) => {
      const allowed = ['camera', 'microphone', 'media', 'audioCapture', 'videoCapture', 'notifications']
      callback(allowed.includes(permission))
    }
  )

  if (is.dev) {
    mainWindow.loadURL('http://localhost:9080')
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    mainWindow!.show()
    mainWindow!.focus()
  })

  mainWindow.on('close', (e) => {
    if (logined && !forceQuit) {
      e.preventDefault()
      mainWindow!.hide()
    } else {
      mainWindow = null
    }
  })
}

function createTray(): void {
  const trayIcon = nativeImage.createFromPath(getResourcePath(trayIconName))
  tray = new Tray(trayIcon)

  const menu = Menu.buildFromTemplate([
    {
      label: '打开主界面',
      click: () => {
        if (mainWindow?.isMinimized()) mainWindow.restore()
        mainWindow?.show()
        mainWindow?.focus()
        flashTray(false)
      }
    },
    {
      label: '退出',
      click: () => {
        forceQuit = true
        app.quit()
      }
    }
  ])

  tray.setContextMenu(menu)
  tray.setToolTip('飞享IM')
  tray.on('click', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore()
    mainWindow?.show()
    mainWindow?.focus()
    flashTray(false)
  })
}

function flashTray(flash: boolean): void {
  if (!tray) return
  const trayIcon = nativeImage.createFromPath(getResourcePath(trayIconName))
  const emptyIcon = nativeImage.createFromPath(getResourcePath('empty-tray.png'))

  if (flash) {
    if (flashTrayTimer) return
    let toggle = false
    flashTrayTimer = setInterval(() => {
      tray!.setImage(toggle ? trayIcon : emptyIcon)
      toggle = !toggle
    }, 700)
  } else {
    if (flashTrayTimer) {
      clearInterval(flashTrayTimer)
      flashTrayTimer = null
    }
    tray!.setImage(trayIcon)
  }
}

function destroyTray(): void {
  flashTray(false)
  tray?.destroy()
  tray = null
}

function registerIPC(): void {
  ipcMain.on('hasLogged', (_, isLogged: boolean) => {
    logined = isLogged
    const size = isLogged ? WIN_SIZE_MAIN : WIN_SIZE_LOGIN
    mainWindow?.setSize(size.width, size.height)
    mainWindow?.center()
    mainWindow?.setResizable(isLogged)
    mainWindow?.webContents.send('isLogged', isLogged)
    if (isLogged && !tray) createTray()
    if (!isLogged && tray) destroyTray()
  })

  ipcMain.on('hasFlashTray', (_, flash: boolean) => {
    flashTray(flash)
  })

  ipcMain.on('window-control', (_, action: 'minimize' | 'maximize' | 'close') => {
    if (!mainWindow) return
    if (action === 'minimize') mainWindow.minimize()
    else if (action === 'maximize') {
      mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
    } else {
      mainWindow.close()
    }
  })

  ipcMain.handle('get-screen-sources', async () => {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 1920, height: 1080 }
    })
    return sources.map(s => ({
      id: s.id,
      name: s.name,
      thumbnail: s.thumbnail.toDataURL()
    }))
  })

  ipcMain.on('write-clipboard', (_, dataUrl: string) => {
    clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
  })
}

function registerScreenshotShortcut(): void {
  const ok = globalShortcut.register('Ctrl+Alt+Z', () => {
    mainWindow?.webContents.send('trigger-screenshot')
  })
  if (!ok) console.warn('[shortcut] Ctrl+Alt+Z could not be registered')
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    systemPreferences.askForMediaAccess('camera')
    systemPreferences.askForMediaAccess('microphone')
  }
  registerIPC()
  createWindow()
  registerScreenshotShortcut()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (!mainWindow) createWindow()
  else mainWindow.show()
})

app.on('before-quit', () => {
  forceQuit = true
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
```

- [ ] **Step 2: 首次启动验证**

```bash
npm run dev
```

预期：Electron 窗口打开，显示飞享登录页面，浏览器地址为 `http://localhost:9080`。DevTools 无 Vue 报错。

若有依赖报错，检查 `node_modules` 是否正常安装。

- [ ] **Step 3: Commit**

```bash
git add src/main/index.ts
git commit -m "feat: add main process — window, IPC, tray, screenshot shortcut"
```

---

## Task 7: ElectronAPI 类型声明

**Files:**
- Modify: `src/renderer/src/types/shims.d.ts`

- [ ] **Step 1: 在 shims.d.ts 末尾追加 ElectronAPI 接口**

在文件末尾（当前最后一行 `}` 之后）追加：

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

interface Window {
  electronAPI?: ElectronAPI
}
```

- [ ] **Step 2: Commit**

```bash
git add src/renderer/src/types/shims.d.ts
git commit -m "feat: add ElectronAPI type declarations to shims.d.ts"
```

---

## Task 8: 登录/登出 IPC 集成

**Files:**
- Modify: `src/renderer/src/components/layout/AppLayout.vue`
- Modify: `src/renderer/src/stores/useAuthStore.ts`

- [ ] **Step 1: 修改 AppLayout.vue — 登录后通知主进程**

在 `onMounted` 中，`authStore.initData(...)` 调用之前，加入 `setLoggedIn(true)`：

将现有代码：
```typescript
onMounted(() => {
  authStore.initData((isError, msg) => {
    if (isError) message.error(msg)
    else message.info(msg)
  })
  document.addEventListener('visibilitychange', onVisibility)
})
```

替换为：
```typescript
onMounted(() => {
  window.electronAPI?.setLoggedIn(true)
  authStore.initData((isError, msg) => {
    if (isError) message.error(msg)
    else message.info(msg)
  })
  document.addEventListener('visibilitychange', onVisibility)
})
```

- [ ] **Step 2: 修改 useAuthStore.ts — 登出时通知主进程**

在 `loginOut()` 函数末尾（`uiStore.reset()` 之后）追加一行：

将现有的 `loginOut` 结尾：
```typescript
    uiStore.reset()
  }
```

替换为：
```typescript
    uiStore.reset()
    window.electronAPI?.setLoggedIn(false)
  }
```

- [ ] **Step 3: 手动验证**

```bash
npm run dev
```

1. 登录账号 → 观察 Electron 窗口是否从 880×520 切换为 1080×720
2. 点击退出登录 → 观察窗口是否缩回 880×520

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/components/layout/AppLayout.vue src/renderer/src/stores/useAuthStore.ts
git commit -m "feat: notify main process on login/logout for window resize and tray"
```

---

## Task 9: 自定义标题栏（TDD）

**Files:**
- Create: `src/renderer/src/components/layout/AppTitleBar.vue`
- Modify: `src/renderer/src/components/layout/AppLayout.vue`
- Test: `src/renderer/src/components/layout/AppTitleBar.test.ts`

- [ ] **Step 1: 编写失败测试 AppTitleBar.test.ts**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import AppTitleBar from './AppTitleBar.vue'

const mockElectronAPI = {
  windowControl: vi.fn(),
  setLoggedIn: vi.fn(),
  onIsLogged: vi.fn(() => vi.fn()),
  setFlashTray: vi.fn(),
  onTriggerScreenshot: vi.fn(() => vi.fn()),
  getScreenSources: vi.fn(),
  writeImageToClipboard: vi.fn(),
}

beforeEach(() => {
  vi.clearAllMocks()
  Object.defineProperty(window, 'electronAPI', {
    value: mockElectronAPI,
    writable: true,
    configurable: true,
  })
})

describe('AppTitleBar', () => {
  it('calls windowControl minimize on minimize button click', async () => {
    const wrapper = mount(AppTitleBar)
    await wrapper.find('[data-action="minimize"]').trigger('click')
    expect(mockElectronAPI.windowControl).toHaveBeenCalledWith('minimize')
  })

  it('calls windowControl maximize on maximize button click', async () => {
    const wrapper = mount(AppTitleBar)
    await wrapper.find('[data-action="maximize"]').trigger('click')
    expect(mockElectronAPI.windowControl).toHaveBeenCalledWith('maximize')
  })

  it('calls windowControl close on close button click', async () => {
    const wrapper = mount(AppTitleBar)
    await wrapper.find('[data-action="close"]').trigger('click')
    expect(mockElectronAPI.windowControl).toHaveBeenCalledWith('close')
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npm test -- src/renderer/src/components/layout/AppTitleBar.test.ts
```

预期：`Cannot find module './AppTitleBar.vue'`

- [ ] **Step 3: 创建 AppTitleBar.vue**

```vue
<script setup lang="ts">
function minimize() { window.electronAPI?.windowControl('minimize') }
function maximize() { window.electronAPI?.windowControl('maximize') }
function close()    { window.electronAPI?.windowControl('close') }
</script>

<template>
  <div class="title-bar">
    <div class="title-bar__drag" />
    <div class="title-bar__controls">
      <button data-action="minimize" class="ctrl-btn" title="最小化" @click="minimize">
        <svg width="10" height="1" viewBox="0 0 10 1"><rect width="10" height="1" fill="currentColor"/></svg>
      </button>
      <button data-action="maximize" class="ctrl-btn" title="最大化" @click="maximize">
        <svg width="10" height="10" viewBox="0 0 10 10"><rect width="10" height="10" fill="none" stroke="currentColor"/></svg>
      </button>
      <button data-action="close" class="ctrl-btn ctrl-btn--close" title="关闭" @click="close">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor"/>
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor"/>
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.title-bar {
  display: flex;
  align-items: center;
  height: 32px;
  background: var(--bg-sidebar, #1e1e2e);
  flex-shrink: 0;
  -webkit-app-region: drag;
  user-select: none;
}

.title-bar__drag {
  flex: 1;
}

.title-bar__controls {
  display: flex;
  -webkit-app-region: no-drag;
}

.ctrl-btn {
  width: 46px;
  height: 32px;
  border: none;
  background: transparent;
  color: var(--text-secondary, #888);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.15s;
  padding: 0;
}

.ctrl-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.ctrl-btn--close:hover {
  background: #e81123;
  color: #fff;
}
</style>
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npm test -- src/renderer/src/components/layout/AppTitleBar.test.ts
```

预期：
```
✓ calls windowControl minimize on minimize button click
✓ calls windowControl maximize on maximize button click
✓ calls windowControl close on close button click
Test Files  1 passed (1)
```

- [ ] **Step 5: 修改 AppLayout.vue — 插入标题栏**

**script 部分**：在已有 import 末尾追加：
```typescript
import AppTitleBar from './AppTitleBar.vue'
```

**template 部分**：将 `<div class="app-layout">` 的内容修改为包含标题栏：

将现有 template：
```html
<template>
  <div class="app-layout">
    <AppSidebar class="sidebar" />
    <div class="main">
      <router-view />
    </div>
    <GroupVideoCallModal v-if="groupCallStore.showGroupCallDialog" />
    <SearchFriendDialog v-if="uiStore.showSearchFriendDialog" />
    <CreateGroup v-if="uiStore.showCreateGroupDialog" />
  </div>
</template>
```

替换为：
```html
<template>
  <div class="app-layout">
    <AppTitleBar class="title-bar-row" />
    <div class="app-content">
      <AppSidebar class="sidebar" />
      <div class="main">
        <router-view />
      </div>
    </div>
    <GroupVideoCallModal v-if="groupCallStore.showGroupCallDialog" />
    <SearchFriendDialog v-if="uiStore.showSearchFriendDialog" />
    <CreateGroup v-if="uiStore.showCreateGroupDialog" />
  </div>
</template>
```

**style 部分**：将现有样式替换为：
```css
<style scoped>
.app-layout {
  display: flex;
  flex-direction: column;
  width: 100vw;
  height: 100vh;
  background: var(--bg-base);
  overflow: hidden;
}

.title-bar-row {
  width: 100%;
}

.app-content {
  display: flex;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.sidebar { flex-shrink: 0; }
.main { flex: 1; min-width: 0; overflow: hidden; }
</style>
```

- [ ] **Step 6: 手动验证**

```bash
npm run dev
```

预期：登录页面顶部出现 32px 高的标题栏，无系统边框；鼠标拖拽标题栏可移动窗口；三个按钮响应点击。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/layout/AppTitleBar.vue src/renderer/src/components/layout/AppTitleBar.test.ts src/renderer/src/components/layout/AppLayout.vue
git commit -m "feat: add custom frameless title bar with window controls"
```

---

## Task 10: 托盘闪烁集成

**Files:**
- Modify: `src/renderer/src/stores/useUIStore.ts`

- [ ] **Step 1: 修改 playMsgNotify — 收到消息时触发托盘闪烁**

将现有 `playMsgNotify` 函数：
```typescript
function playMsgNotify() { try { _notify?.player?.() } catch (e) {} }
```

替换为：
```typescript
function playMsgNotify() {
  try { _notify?.player?.() } catch (e) {}
  window.electronAPI?.setFlashTray(true)
}
```

- [ ] **Step 2: 修改 unreadTotalCount computed — 未读清零时停止闪烁**

将现有 `unreadTotalCount` computed 中 `total === 0` 分支：
```typescript
    if (total === 0) {
      _notify?.faviconClear?.()
      _notify?.setTitle?.()
    } else {
```

替换为：
```typescript
    if (total === 0) {
      _notify?.faviconClear?.()
      _notify?.setTitle?.()
      window.electronAPI?.setFlashTray(false)
    } else {
```

- [ ] **Step 3: 手动验证**

```bash
npm run dev
```

1. 登录后使用另一账号发一条消息
2. 观察 macOS Dock 中托盘图标是否开始闪烁
3. 切换到聊天窗口并阅读消息 → 观察闪烁是否停止

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/stores/useUIStore.ts
git commit -m "feat: tray flash on new message, clear on read"
```

---

## Task 11: 截图功能

**Files:**
- Create: `src/renderer/src/components/common/ScreenshotOverlay.vue`
- Modify: `src/renderer/src/App.vue`
- Test: `src/renderer/src/components/common/ScreenshotOverlay.test.ts`

- [ ] **Step 1: 编写失败测试 ScreenshotOverlay.test.ts**

```typescript
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import ScreenshotOverlay from './ScreenshotOverlay.vue'

const THUMB = 'data:image/png;base64,iVBORw0KGgo='

describe('ScreenshotOverlay', () => {
  it('shows the thumbnail as background', () => {
    const wrapper = mount(ScreenshotOverlay, { props: { thumbnail: THUMB } })
    expect(wrapper.find('.screenshot-overlay').attributes('style')).toContain(THUMB)
  })

  it('emits cancel when cancel button clicked', async () => {
    const wrapper = mount(ScreenshotOverlay, {
      props: { thumbnail: THUMB },
      attachTo: document.body
    })
    // Simulate a drag selection to show toolbar
    const overlay = wrapper.find('.screenshot-overlay')
    await overlay.trigger('mousedown', { clientX: 10, clientY: 10 })
    await overlay.trigger('mousemove', { clientX: 100, clientY: 100 })
    await overlay.trigger('mouseup')

    await wrapper.find('[data-action="cancel"]').trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
  })

  it('emits confirm with dataUrl when confirm button clicked', async () => {
    const wrapper = mount(ScreenshotOverlay, {
      props: { thumbnail: THUMB },
      attachTo: document.body
    })
    const overlay = wrapper.find('.screenshot-overlay')
    await overlay.trigger('mousedown', { clientX: 10, clientY: 10 })
    await overlay.trigger('mousemove', { clientX: 100, clientY: 100 })
    await overlay.trigger('mouseup')

    await wrapper.find('[data-action="confirm"]').trigger('click')
    expect(wrapper.emitted('confirm')).toBeTruthy()
  })
})
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
npm test -- src/renderer/src/components/common/ScreenshotOverlay.test.ts
```

预期：`Cannot find module './ScreenshotOverlay.vue'`

- [ ] **Step 3: 创建 ScreenshotOverlay.vue**

```vue
<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue'

const props = defineProps<{ thumbnail: string }>()
const emit  = defineEmits<{ cancel: []; confirm: [dataUrl: string] }>()

const overlayRef  = ref<HTMLDivElement | null>(null)
const canvasRef   = ref<HTMLCanvasElement | null>(null)

const sel = ref({ x: 0, y: 0, w: 0, h: 0, dragging: false, startX: 0, startY: 0 })

function rect() { return overlayRef.value?.getBoundingClientRect() ?? { left: 0, top: 0 } }

function onMousedown(e: MouseEvent) {
  const r = rect()
  sel.value = { dragging: true, startX: e.clientX - r.left, startY: e.clientY - r.top, x: e.clientX - r.left, y: e.clientY - r.top, w: 0, h: 0 }
}

function onMousemove(e: MouseEvent) {
  if (!sel.value.dragging) return
  const r   = rect()
  const cx  = e.clientX - r.left
  const cy  = e.clientY - r.top
  sel.value.x = Math.min(cx, sel.value.startX)
  sel.value.y = Math.min(cy, sel.value.startY)
  sel.value.w = Math.abs(cx - sel.value.startX)
  sel.value.h = Math.abs(cy - sel.value.startY)
}

function onMouseup() { sel.value.dragging = false }

function confirm() {
  const canvas = canvasRef.value
  if (!canvas) { emit('confirm', props.thumbnail); return }
  const img = new Image()
  img.onload = () => {
    const scaleX = img.width  / (overlayRef.value?.clientWidth  ?? img.width)
    const scaleY = img.height / (overlayRef.value?.clientHeight ?? img.height)
    canvas.width  = sel.value.w * scaleX
    canvas.height = sel.value.h * scaleY
    const ctx = canvas.getContext('2d')!
    ctx.drawImage(img, sel.value.x * scaleX, sel.value.y * scaleY, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height)
    emit('confirm', canvas.toDataURL('image/png'))
  }
  img.src = props.thumbnail
}

function cancel() { emit('cancel') }

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') cancel()
  if (e.key === 'Enter' && sel.value.w > 0) confirm()
}

onMounted(()   => window.addEventListener('keydown', onKeydown))
onUnmounted(() => window.removeEventListener('keydown', onKeydown))
</script>

<template>
  <div
    ref="overlayRef"
    class="screenshot-overlay"
    :style="{ backgroundImage: `url(${thumbnail})` }"
    @mousedown="onMousedown"
    @mousemove="onMousemove"
    @mouseup="onMouseup"
  >
    <div
      v-if="sel.w > 0 && sel.h > 0"
      class="sel-rect"
      :style="{ left: sel.x + 'px', top: sel.y + 'px', width: sel.w + 'px', height: sel.h + 'px' }"
    />
    <div
      v-if="!sel.dragging && sel.w > 4 && sel.h > 4"
      class="toolbar"
      :style="{ left: (sel.x + sel.w) + 'px', top: (sel.y + sel.h + 6) + 'px' }"
    >
      <button data-action="confirm" @click.stop="confirm">确认</button>
      <button data-action="cancel"  @click.stop="cancel">取消</button>
    </div>
    <canvas ref="canvasRef" style="display:none" />
  </div>
</template>

<style scoped>
.screenshot-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  cursor: crosshair;
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
}

.sel-rect {
  position: absolute;
  border: 2px solid #4a9eff;
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.35);
  pointer-events: none;
}

.toolbar {
  position: absolute;
  display: flex;
  gap: 6px;
  pointer-events: all;
}

.toolbar button {
  padding: 5px 14px;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  font-size: 13px;
  font-weight: 500;
}

.toolbar button[data-action="confirm"] { background: #4a9eff; color: #fff; }
.toolbar button[data-action="cancel"]  { background: #fff; color: #333; }
</style>
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
npm test -- src/renderer/src/components/common/ScreenshotOverlay.test.ts
```

预期：
```
✓ shows the thumbnail as background
✓ emits cancel when cancel button clicked
✓ emits confirm with dataUrl when confirm button clicked
Test Files  1 passed (1)
```

- [ ] **Step 5: 修改 App.vue — 注册截图监听并挂载浮层**

将整个 `src/renderer/src/App.vue` 替换为：

```vue
<script setup lang="ts">
import { darkTheme } from 'naive-ui'
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { useThemeStore } from '@/stores/useThemeStore'
import ScreenshotOverlay from '@/components/common/ScreenshotOverlay.vue'

const themeStore = useThemeStore()
const theme = computed(() => themeStore.isDark ? darkTheme : null)

const showScreenshot = ref(false)
const screenshotThumbnail = ref('')
let cleanupScreenshot: (() => void) | null = null

async function startScreenshot() {
  const sources = await window.electronAPI?.getScreenSources()
  if (!sources?.length) return
  screenshotThumbnail.value = sources[0].thumbnail
  showScreenshot.value = true
}

function onConfirm(dataUrl: string) {
  window.electronAPI?.writeImageToClipboard(dataUrl)
  showScreenshot.value = false
}

function onCancel() { showScreenshot.value = false }

onMounted(() => {
  themeStore.init()
  cleanupScreenshot = window.electronAPI?.onTriggerScreenshot(startScreenshot) ?? null
})

onUnmounted(() => { cleanupScreenshot?.() })
</script>

<template>
  <n-config-provider
    :theme="theme"
    :theme-overrides="{ common: { primaryColor: '#5865f2', primaryColorHover: '#4752c4', primaryColorPressed: '#3b44af' } }"
  >
    <n-message-provider>
      <n-dialog-provider>
        <router-view />
        <ScreenshotOverlay
          v-if="showScreenshot"
          :thumbnail="screenshotThumbnail"
          @confirm="onConfirm"
          @cancel="onCancel"
        />
      </n-dialog-provider>
    </n-message-provider>
  </n-config-provider>
</template>
```

- [ ] **Step 6: 手动验证**

```bash
npm run dev
```

1. 登录后按 `Ctrl+Alt+Z` → 全屏截图遮罩出现
2. 拖拽鼠标选取区域 → 蓝色边框选区出现
3. 点击"确认" → 遮罩关闭，打开任意文本编辑器，Cmd+V 粘贴 → 截图内容粘贴成功
4. 再次按 `Ctrl+Alt+Z`，点击"取消"或按 Esc → 遮罩关闭

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/common/ScreenshotOverlay.vue src/renderer/src/components/common/ScreenshotOverlay.test.ts src/renderer/src/App.vue
git commit -m "feat: screenshot with desktopCapturer — Ctrl+Alt+Z triggers crop overlay"
```

---

## Task 12: 全量测试 + 生产打包验证

**Files:** 无新建，验证最终状态

- [ ] **Step 1: 运行全部单元测试**

```bash
npm test
```

预期：
```
Test Files  3 passed (3)
Tests       9 passed (9)
```

（common.test.ts 3 个 + AppTitleBar.test.ts 3 个 + ScreenshotOverlay.test.ts 3 个）

- [ ] **Step 2: 执行生产构建**

```bash
npm run build
```

预期：无 TypeScript 错误，输出 `out/main/index.js`、`out/preload/index.js`、`out/renderer/index.html`。

- [ ] **Step 3: 执行 electron-builder 打包（仅目录，不生成安装包）**

```bash
npm run dist:dir
```

预期：`release/mac/飞享IM.app`（macOS）或对应平台目录出现。

- [ ] **Step 4: 启动打包后的应用进行验收**

macOS:
```bash
open release/mac/飞享IM.app
```

验收清单：
- [ ] 启动显示登录窗口 880×520
- [ ] 登录成功 → 窗口变为 1080×720
- [ ] 自定义标题栏可拖拽移动窗口
- [ ] 最小化/最大化/关闭按钮正常
- [ ] 系统托盘出现图标
- [ ] 收到新消息 → 托盘闪烁
- [ ] Ctrl+Alt+Z → 截图遮罩出现，确认后剪贴板有图像
- [ ] 关闭窗口（已登录）→ 最小化到托盘，不退出进程
- [ ] 托盘右键"退出" → 彻底退出

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore: all tasks complete — verified dev and production builds"
```

---

## 附录：已知限制

| 问题 | 说明 |
|---|---|
| `streamsaver` 文件下载 | Electron 渲染进程对 Service Worker 有限制，文件下载功能可能受影响。如需修复，需通过 IPC 将下载委托给主进程 `fs.createWriteStream + dialog.showSaveDialog`，超出本计划范围。 |
| macOS 屏幕录制权限 | 首次按 Ctrl+Alt+Z 时 macOS 会弹出授权弹窗，用户需手动允许；之后正常工作。 |
| Linux 托盘支持 | 部分 Linux 桌面环境（如 GNOME 默认）不显示系统托盘，需安装 `gnome-shell-extension-appindicator`。 |
