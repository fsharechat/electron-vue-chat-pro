export const WS_PROTOCOL = 'wss'
export const HTTP_PROTOCOL = 'https'
export const WS_IP = 'backend-websocket.fsharechat.cn/ws'
export const HTTP_IP = 'backend-http.fsharechat.cn'
export const WS_PORT = 9326
export const HEART_BEAT_INTERVAL = 25 * 1000
export const RECONNECT_INTERVAL = 1 * 1000
export const BINTRAY_TYPE = 'blob'

export const CONNECT = 'CONNECT'
export const DISCONNECT = 'DISCONNECT'
export const CONNECT_ACK = 'CONNECT_ACK'
export const PUBLISH = 'PUBLISH'
export const PUB_ACK = 'PUB_ACK'

export const FRP = 'FRP'; export const FP = 'FP'; export const FALS = 'FALS'
export const UPUI = 'UPUI'; export const GPGI = 'GPGI'; export const GPGM = 'GPGM'
export const GAM = 'GAM'; export const GC = 'GC'; export const GMI = 'GMI'
export const GKM = 'GKM'; export const GQ = 'GQ'; export const GD = 'GD'
export const MP = 'MP'; export const MS = 'MS'; export const MN = 'MN'
export const MR = 'MR'; export const RMN = 'RMN'; export const GQNUT = 'GQNUT'
export const GMURL = 'GMURL'; export const US = 'US'; export const FAR = 'FAR'
export const FRN = 'FRN'; export const FHR = 'FHR'; export const FN = 'FN'
export const MMI = 'MMI'; export const LRM = 'LRM'; export const MDR = 'MDR'
export const MRP = 'MRP'; export const MRN = 'MRN'; export const MRR = 'MRR'
export const SAI = 'SAI'

// 用户设置同步：UG 拉取、UP 上报、UN 服务端通知。
// WebSocket 侧按 topic 字符串路由，不依赖 android/iOS 那边的 SubSignal ordinal
export const UG = 'UG'; export const UP = 'UP'; export const UN = 'UN'

/** 与服务端 UserSettingScope 对齐 */
export const USER_SETTING_SCOPE = {
  conversationSilent: 1,
  globalSilent: 2,
  conversationTop: 3,
  favoriteGroup: 6
} as const

/**
 * 会话类 setting 的 key：type-line-target（连字符）。
 * 必须与服务端 MemoryMessagesStore.getUserConversationSlient() 的拼法完全一致，
 * 否则上传的设置服务端读不到。
 */
export function conversationSettingKey(conversationType: number, line: number, target: string): string {
  return `${conversationType}-${line}-${target}`
}

export const HTTP_HOST = HTTP_PROTOCOL + '://' + HTTP_IP + '/'
export const LOGIN_API = HTTP_HOST + 'login'
export const SNED_VERIFY_CODE_API = HTTP_HOST + 'send_code'

export const KEY_VUE_DEVICE_ID = 'vue-device-id'
export const KEY_VUE_USER_ID = 'vue-user-id'
export const KEY_VUE_TOKEN = 'vue-token'

export const UPLOAD_BY_QINIU = false
export const ERROR_CODE = 400
export const SUCCESS_CODE = 200
export const CONVERSATION_MAX_MESSAGE_SIZE = 50
