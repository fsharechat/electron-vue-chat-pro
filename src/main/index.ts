import {
  app, BrowserWindow, ipcMain, Tray, Menu,
  nativeImage, globalShortcut, systemPreferences,
  desktopCapturer, clipboard, dialog, net
} from 'electron'
import { join } from 'path'
import fs from 'fs'
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

  ipcMain.handle('get-screen-sources', async () => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      })
      return sources.map(s => ({
        id: s.id,
        name: s.name,
        thumbnail: s.thumbnail.toDataURL()
      }))
    } catch (err) {
      console.warn('[desktopCapturer] getSources failed:', err)
      return []
    }
  })

  ipcMain.on('write-clipboard', (_, dataUrl: string) => {
    clipboard.writeImage(nativeImage.createFromDataURL(dataUrl))
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
  else showMainWindow()
})

app.on('before-quit', () => {
  forceQuit = true
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})
