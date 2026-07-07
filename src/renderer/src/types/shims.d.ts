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

interface ElectronAPI {
  windowControl(action: 'minimize' | 'maximize' | 'close'): void
  setLoggedIn(isLogged: boolean): void
  onIsLogged(cb: (v: boolean) => void): () => void
  setFlashTray(flash: boolean): void
  startScreenshot(hideWindow: boolean): void
  onKbdScreenshot(cb: () => void): () => void
  onTriggerScreenshot(cb: (data: { screenshotDataUrl: string }) => void): () => void
  screenshotDone(dataUrl: string): void
  screenshotCancel(): void
  onScreenshotResult(cb: (dataUrl: string) => void): () => void
  writeImageToClipboard(dataUrl: string): void
  writeTextToClipboard(text: string): void
  showSaveDialog(defaultName: string): Promise<string | null>
  startFileDownload(url: string, savePath: string, downloadId: string): void
  onFileDownloadProgress(cb: (data: { downloadId: string; percent: number }) => void): () => void
  onFileDownloadDone(cb: (data: { downloadId: string; error?: string }) => void): () => void
  onWindowFocusChange(cb: (focused: boolean) => void): () => void
}

interface Window {
  electronAPI?: ElectronAPI
}
