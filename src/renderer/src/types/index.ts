export interface UserInfo {
  uid: string
  displayName: string
  portrait: string
  mobile: string
  email: string
}

export interface GroupInfo {
  target: string
  name: string
  portrait: string
  memberCount: number
  owner: string
  type: number
}

export interface GroupMember {
  memberId: string
  alias: string
  memberType: number
}

export interface UnreadCount {
  unread: number
}

export interface ProtoMessageContent {
  type: number
  searchableContent: string
  content?: string
  remoteMediaUrl?: string
  binaryContent?: string
  [key: string]: any
}

export interface ProtoMessage {
  messageId: string
  messageUid: string
  from: string
  target: string
  conversationType: number
  direction: number
  content: ProtoMessageContent
  timestamp: number
  status: number
  line: number
  tos: string
  streaming?: boolean
}

export interface ConversationInfo {
  conversationType: number
  target: string
  line: number
  isTop: boolean
  isSilent: boolean
  timestamp: number
  unreadCount: UnreadCount
  lastMessage: ProtoMessage | null
}

export interface StateConversationInfo {
  name: string
  img: string
  conversationInfo: ConversationInfo
}

export interface StateChatMessage {
  target: string
  name: string
  protoMessages: ProtoMessage[]
}

export interface FriendData {
  friendUid: string
  alias: string
}

export interface FriendInfo {
  id: number
  wxid: string
  initial: string
  img: string
  signature: string
  nickname: string
  sex: number
  remark: string
  area: string
  mobile: string
  email?: string
}

export interface FriendRequest {
  from: string
  reason: string
  status: number
  timestamp: number
}

export interface MessageReport {
  target: string
  uid: string
  date: number
  reportType: number
}

export interface StateMessageReport {
  target: string
  messageReports: MessageReport[]
}

export type StoreDispatcher = (action: string, data?: any) => void
export type ErrorHandler = (isError: boolean, message: string) => void
