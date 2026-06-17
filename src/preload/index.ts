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

  startScreenshot: (hideWindow: boolean): void =>
    ipcRenderer.send('start-screenshot', { hideWindow }),

  onKbdScreenshot: (cb: () => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent): void => cb()
    ipcRenderer.on('kbd-screenshot', handler)
    return () => ipcRenderer.removeListener('kbd-screenshot', handler)
  },

  onTriggerScreenshot: (cb: (data: { screenshotDataUrl: string }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { screenshotDataUrl: string }): void => cb(data)
    ipcRenderer.on('trigger-screenshot', handler)
    return () => ipcRenderer.removeListener('trigger-screenshot', handler)
  },

  screenshotDone: (dataUrl: string): void =>
    ipcRenderer.send('screenshot-done', dataUrl),

  screenshotCancel: (): void =>
    ipcRenderer.send('screenshot-cancel'),

  onScreenshotResult: (cb: (dataUrl: string) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, dataUrl: string): void => cb(dataUrl)
    ipcRenderer.on('screenshot-result', handler)
    return () => ipcRenderer.removeListener('screenshot-result', handler)
  },

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
