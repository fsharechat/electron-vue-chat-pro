import {
  app, BrowserWindow, ipcMain, Tray, Menu,
  nativeImage, globalShortcut, systemPreferences,
  desktopCapturer, clipboard, dialog, net, screen, shell
} from 'electron'
import { join } from 'path'
import { tmpdir } from 'os'
import { execFile } from 'child_process'
import { promisify } from 'util'
import fs from 'fs'
import { is } from '@electron-toolkit/utils'

const execFileAsync = promisify(execFile)
import { WIN_SIZE_LOGIN, WIN_SIZE_MAIN } from './utils/common'

let mainWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
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
      backgroundThrottling: false,
    }
  })

  mainWindow.webContents.session.setPermissionRequestHandler(
    (_, permission, callback) => {
      const allowed = ['camera', 'microphone', 'media', 'audioCapture', 'videoCapture', 'notifications']
      callback(allowed.includes(permission))
    }
  )

  // 拦截外部 URL 导航（如 n-image 下载按钮触发的图片 URL），转为下载行为
  mainWindow.webContents.on('will-navigate', (event, url) => {
    const isApp = is.dev
      ? url.startsWith('http://localhost:')
      : url.startsWith('file://')
    if (!isApp) {
      event.preventDefault()
      mainWindow?.webContents.downloadURL(url)
    }
  })

  // 拦截所有浏览器级下载，弹出另存为对话框
  mainWindow.webContents.session.on('will-download', (_, item) => {
    const filename = item.getFilename()
    const savePath = dialog.showSaveDialogSync(mainWindow!, {
      defaultPath: join(app.getPath('downloads'), filename),
      filters: [{ name: 'All Files', extensions: ['*'] }]
    })
    if (savePath) {
      item.setSavePath(savePath)
    } else {
      item.cancel()
    }
  })

  if (is.dev) {
    mainWindow.loadURL('http://localhost:9080')
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.once('ready-to-show', () => {
    // 等待渲染层上报登录状态后再显示，避免先显示错误尺寸的空白窗口
    // 2s 兜底：渲染层未能发送 hasLogged 时强制显示
    setTimeout(() => {
      if (mainWindow && !mainWindow.isVisible()) {
        mainWindow.show()
        mainWindow.focus()
      }
    }, 2000)
  })

  mainWindow.on('focus', () => mainWindow?.webContents.send('win-focus-change', true))
  mainWindow.on('blur', () => mainWindow?.webContents.send('win-focus-change', false))

  mainWindow.on('close', (e) => {
    if (logined && !forceQuit) {
      e.preventDefault()
      mainWindow!.hide()
    } else {
      mainWindow = null
    }
  })
}

function showMainWindow(): void {
  if (!mainWindow) return
  if (mainWindow.isMinimized()) {
    mainWindow.restore()
  } else if (!mainWindow.isVisible()) {
    // transparent:true 窗口 show() 后 GPU 需要约 1-2 帧重新合成内容
    // 先设 opacity=0 隐藏空帧，内容就绪后再显示，消除闪动
    mainWindow.setOpacity(0)
    mainWindow.show()
    setTimeout(() => { mainWindow?.setOpacity(1) }, 60)
  } else {
    mainWindow.show()
  }
  mainWindow.focus()
  flashTray(false)
}

function createTray(): void {
  const trayIcon = nativeImage.createFromPath(getResourcePath(trayIconName))
  tray = new Tray(trayIcon)

  const menu = Menu.buildFromTemplate([
    {
      label: '打开主界面',
      click: () => showMainWindow()
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
  tray.on('click', () => showMainWindow())
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
    // 尺寸有变化时才 resize + center，避免重复 IPC 调用导致窗口抖动
    const [currentW, currentH] = mainWindow?.getSize() ?? [0, 0]
    if (currentW !== size.width || currentH !== size.height) {
      mainWindow?.setSize(size.width, size.height)
      mainWindow?.center()
    }
    mainWindow?.setResizable(isLogged)
    mainWindow?.webContents.send('isLogged', isLogged)
    if (isLogged && !tray) createTray()
    if (!isLogged && tray) destroyTray()
    // 首次加载时窗口尚未显示，收到正确尺寸后再显示
    if (mainWindow && !mainWindow.isVisible()) {
      mainWindow.show()
      mainWindow.focus()
    }
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

  ipcMain.on('write-clipboard', (_, dataUrl: string) => {
    clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
  })

  ipcMain.on('write-text-clipboard', (_, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.on('start-screenshot', (_, { hideWindow }: { hideWindow: boolean }) => {
    captureScreenshot(hideWindow).catch(err => console.error('[screenshot]', err))
  })

  ipcMain.on('screenshot-done', (event, dataUrl: string) => {
    if (event.sender !== overlayWindow?.webContents) return
    overlayWindow.hide()
    if (dataUrl) mainWindow?.webContents.send('screenshot-result', dataUrl)
  })

  ipcMain.on('screenshot-cancel', (event) => {
    if (event.sender !== overlayWindow?.webContents) return
    overlayWindow.hide()
  })

  ipcMain.handle('show-save-dialog', async (_, defaultName: string) => {
    const { filePath } = await dialog.showSaveDialog({
      defaultPath: join(app.getPath('downloads'), defaultName),
      filters: [{ name: 'All Files', extensions: ['*'] }]
    })
    return filePath ?? null
  })

  ipcMain.on('start-file-download', async (event, { url, savePath, downloadId }: { url: string; savePath: string; downloadId: string }) => {
    try {
      const res = await net.fetch(url)
      const total = parseInt(res.headers.get('content-length') ?? '0', 10)
      const reader = res.body!.getReader()
      const fileStream = fs.createWriteStream(savePath)
      let loaded = 0
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        loaded += value.length
        fileStream.write(Buffer.from(value))
        if (total > 0) {
          const percent = Math.min(99, Math.floor(loaded / total * 100))
          event.sender.send('file-download-progress', { downloadId, percent })
        }
      }
      await new Promise<void>((resolve, reject) => {
        fileStream.end((err?: Error | null) => err ? reject(err) : resolve())
      })
      event.sender.send('file-download-done', { downloadId })
    } catch (err: any) {
      event.sender.send('file-download-done', { downloadId, error: String(err?.message ?? err) })
    }
  })
}

async function captureScreenshot(hideWindow: boolean): Promise<void> {
  if (!mainWindow) return

  if (hideWindow) {
    mainWindow.hide()
    await new Promise<void>(r => setTimeout(r, 150))
  }

  const primaryDisplay = screen.getPrimaryDisplay()
  const { x, y, width, height } = primaryDisplay.bounds
  const scaleFactor = primaryDisplay.scaleFactor

  let screenshotDataUrl = ''
  let permissionDenied = false

  if (process.platform === 'darwin') {
    // macOS: 用系统 screencapture 命令获取原始 Retina 分辨率截图
    // 注意：不依赖 getMediaAccessStatus('screen')，该 API 对屏幕录制不实时，
    // 权限状态要等 screencapture 实际执行后才可靠。
    const tmpPath = join(tmpdir(), `fshare-ss-${Date.now()}.png`)
    try {
      await execFileAsync('screencapture', ['-x', tmpPath])
      const buf = fs.readFileSync(tmpPath)
      // screencapture 权限被拒时会生成 < 1 KB 的空白文件
      if (buf.length > 1024) {
        screenshotDataUrl = `data:image/png;base64,${buf.toString('base64')}`
      } else {
        permissionDenied = true
      }
    } catch (err) {
      console.warn('[screenshot] screencapture failed:', err)
      permissionDenied = true
    } finally {
      try { fs.unlinkSync(tmpPath) } catch {}
    }
  }

  if (!screenshotDataUrl) {
    // 非 macOS 或 screencapture 失败时，回退到 desktopCapturer
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: {
          width: Math.round(width * scaleFactor),
          height: Math.round(height * scaleFactor)
        }
      })
      if (sources.length > 0) {
        const thumb = sources[0].thumbnail
        // 权限被拒时 thumbnail 为 1x1 空图
        if (thumb.getSize().width > 1) {
          screenshotDataUrl = thumb.toDataURL()
          permissionDenied = false
        }
      }
    } catch (err) {
      console.warn('[screenshot] desktopCapturer failed:', err)
    }
  }

  if (!screenshotDataUrl) {
    if (hideWindow) { mainWindow.show(); mainWindow.focus() }
    if (permissionDenied && process.platform === 'darwin') {
      const { response } = await dialog.showMessageBox(mainWindow!, {
        type: 'warning',
        title: '需要屏幕录制权限',
        message: '飞享IM 需要屏幕录制权限才能截图。',
        detail: '请前往「系统设置 → 隐私与安全性 → 屏幕录制」，打开飞享IM 的权限开关，然后重启应用。',
        buttons: ['打开系统设置', '取消'],
        defaultId: 0,
        cancelId: 1
      })
      if (response === 0) {
        shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
      }
    }
    return
  }

  // hideWindow=true 时窗口被隐藏用于截图，现在恢复显示
  if (hideWindow) { mainWindow.show(); mainWindow.focus() }

  // 主窗口完全不动，截图 overlay 在独立窗口中显示
  if (!overlayWindow || overlayWindow.isDestroyed()) createOverlayWindow()
  if (overlayWindow!.webContents.isLoading()) {
    await new Promise<void>(r => overlayWindow!.webContents.once('did-finish-load', r))
  }

  const { x: dx, y: dy, width: dw, height: dh } = screen.getPrimaryDisplay().bounds
  overlayWindow!.setBounds({ x: dx, y: dy, width: dw, height: dh })
  overlayWindow!.webContents.send('trigger-screenshot', { screenshotDataUrl })
  overlayWindow!.show()
  overlayWindow!.focus()
}

function createOverlayWindow(): void {
  const { x, y, width, height } = screen.getPrimaryDisplay().bounds
  overlayWindow = new BrowserWindow({
    x, y, width, height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    }
  })

  if (is.dev) {
    overlayWindow.loadURL('http://localhost:9080?overlay=1')
  } else {
    overlayWindow.loadFile(join(__dirname, '../renderer/index.html'), { query: { overlay: '1' } })
  }

  overlayWindow.on('closed', () => { overlayWindow = null })
}

function registerScreenshotShortcut(): void {
  const ok = globalShortcut.register('Ctrl+Alt+Z', () => {
    mainWindow?.webContents.send('kbd-screenshot')
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
  else showMainWindow()
})

app.on('before-quit', () => {
  forceQuit = true
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
