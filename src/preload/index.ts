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
