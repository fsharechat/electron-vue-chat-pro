import { ref } from 'vue'
import { defineStore } from 'pinia'
import { KEY_VUE_USER_ID, KEY_VUE_TOKEN } from '@/constant'
import type { ErrorHandler, StoreDispatcher } from '@/types'
import { useConversationStore } from './useConversationStore'
import { useMessageStore } from './useMessageStore'
import { useFriendStore } from './useFriendStore'
import { useGroupStore } from './useGroupStore'
import { useUIStore } from './useUIStore'
import VueWebSocket from '@/websocket/index'
import webSocketClient from '@/websocket/websocketcli'
import LocalStore from '@/websocket/store/localstore'

export const useAuthStore = defineStore('auth', () => {
  const userId = ref(localStorage.getItem(KEY_VUE_USER_ID) ?? '')
  const token = ref(localStorage.getItem(KEY_VUE_TOKEN) ?? '')
  const deviceId = ref('')
  const user = ref({ name: 'ratel', img: 'images/vue.jpg' })
  let vueSocket: any = null

  function initData(errorHandler: ErrorHandler) {
    userId.value = localStorage.getItem(KEY_VUE_USER_ID) ?? ''
    token.value = localStorage.getItem(KEY_VUE_TOKEN) ?? ''

    const conversationStore = useConversationStore()
    const messageStore = useMessageStore()
    const friendStore = useFriendStore()
    const groupStore = useGroupStore()
    const uiStore = useUIStore()

    const dispatcher: StoreDispatcher = (action, data) => {
      const map: Record<string, () => void> = {
        setOnlineStatus:          () => uiStore.setOnlineStatus(data),
        changetFirstLogin:        () => uiStore.setFirstLogin(data),
        changeEmptyMessageState:  () => { uiStore.emptyMessage = data },
        updateFriendList:         () => friendStore.updateFriendList(data),
        updateFriendIds:          () => friendStore.updateFriendIds(data),
        updateFriendRequest:      () => friendStore.updateFriendRequest(data),
        updateSearchUser:         () => friendStore.updateSearchUser(data),
        updateUserInfos:          () => uiStore.updateUserInfos(data),
        updateGroupInfos:         () => groupStore.updateGroupInfos(data),
        updateTempGroupMember:    () => groupStore.updateTempGroupMember(data),
        addProtoMessage:          () => messageStore.addProtoMessage(data),
        updateConversationInfo:   () => conversationStore.updateConversationInfo(data),
        updateProtoMessageUid:    () => messageStore.updateProtoMessageUid(data),
        updateMessageStatus:      () => messageStore.updateMessageStatus(data),
        updateMessageContent:     () => messageStore.updateMessageContent(data),
        addMessageReport:         () => uiStore.addMessageReport(data),
        addGroupSendUser:         () => groupStore.addGroupSendUser(data),
        uploadReport:             () => uiStore.uploadReport(data, vueSocket),
        appendStreamingContent:   () => messageStore.appendStreamingContent(data),
        syncGroupInfos:           () => conversationStore.syncGroupInfos(),
        syncUserInfos:            () => conversationStore.syncUserInfos(),
      }
      const handler = map[action]
      if (handler) handler()
      else console.warn('[StoreDispatcher] unhandled action:', action)
    }

    vueSocket = new VueWebSocket(errorHandler, dispatcher)
    webSocketClient.setInstance(vueSocket)

    uiStore.setFirstLogin(true)
    uiStore.initNotify()

    const convs = LocalStore.getConversations()
    if (convs) conversationStore.conversations = convs
    const msgs = LocalStore.getMessages()
    if (msgs) messageStore.messages = msgs
    const target = LocalStore.getSelectTarget()
    if (target) conversationStore.selectTarget = target
    const userInfos = LocalStore.getUserInfoList()
    if (userInfos) uiStore.userInfoList = userInfos
    const reports = LocalStore.getMessageReports()
    if (reports) uiStore.stateMessageReports = reports
    const groupInfos = LocalStore.getGroupInfos()
    if (groupInfos) groupStore.updateGroupInfos(groupInfos)

    uiStore.setVueSocket(vueSocket)
  }

  function loginOut() {
    user.value = { name: 'unknown', img: 'images/vue.jpg' }
    userId.value = ''
    token.value = ''
    localStorage.setItem(KEY_VUE_USER_ID, '')
    localStorage.setItem(KEY_VUE_TOKEN, '')
    vueSocket?.sendDisConnectMessage()
    vueSocket = null
    webSocketClient.setInstance(null)
    LocalStore.clearLocalStore()

    // 清除所有 store 的内存状态，避免切换账号时残留上一个用户的数据
    const conversationStore = useConversationStore()
    const messageStore = useMessageStore()
    const friendStore = useFriendStore()
    const groupStore = useGroupStore()
    const uiStore = useUIStore()
    conversationStore.reset()
    messageStore.reset()
    friendStore.reset()
    groupStore.reset()
    uiStore.reset()
  }

  function modifyMyInfo(value: any) {
    vueSocket?.modifyMyInfo(value)
  }

  return { userId, token, deviceId, user, initData, loginOut, modifyMyInfo }
})
