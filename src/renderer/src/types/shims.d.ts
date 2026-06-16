declare const __APP_VERSION__: string
declare module 'kurento-utils'
declare module 'benz-amr-recorder'
declare module '@wcjiang/notify'
declare module 'qiniu-js'
declare module 'streamsaver'
declare module 'uuid-js'
declare module 'vue-amap'
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<{}, {}, any>
  export default component
}

interface ScreenshotBounds {
  x: number
  y: number
  width: number
  height: number
}

interface ElectronAPI {
  windowControl(action: 'minimize' | 'maximize' | 'close'): void
  setLoggedIn(isLogged: boolean): void
  onIsLogged(cb: (v: boolean) => void): () => void
  setFlashTray(flash: boolean): void
  startScreenshot(hideWindow: boolean): void
  onKbdScreenshot(cb: () => void): () => void
  onTriggerScreenshot(cb: (data: { screenshotDataUrl: string; originalBounds: ScreenshotBounds }) => void): () => void
  screenshotDone(originalBounds: ScreenshotBounds): void
  screenshotCancel(originalBounds: ScreenshotBounds): void
  writeImageToClipboard(dataUrl: string): void
  showSaveDialog(defaultName: string): Promise<string | null>
  startFileDownload(url: string, savePath: string, downloadId: string): void
  onFileDownloadProgress(cb: (data: { downloadId: string; percent: number }) => void): () => void
  onFileDownloadDone(cb: (data: { downloadId: string; error?: string }) => void): () => void
}

interface Window {
  electronAPI?: ElectronAPI
}
