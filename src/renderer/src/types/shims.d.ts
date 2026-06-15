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
