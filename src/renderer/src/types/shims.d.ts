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
  onTriggerScreenshot(cb: () => void): () => void
  getScreenSources(): Promise<Array<{ id: string; name: string; thumbnail: string }>>
  writeImageToClipboard(dataUrl: string): void
}

interface Window {
  electronAPI?: ElectronAPI
}
