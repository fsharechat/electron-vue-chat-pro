import { ref } from 'vue'
import { defineStore } from 'pinia'
import { KEY_VUE_USER_ID, KEY_VUE_TOKEN } from '@/constant'
import type { ErrorHandler, StoreDispatcher } from '@/types'
import { useConversationStore } from './useConversationStore'
import { useMessageStore } from './useMessageStore'
import { useFriendStore } from './useFriendStore'
import { useGroupStore } from './useGroupStore'
import { useUIStore } from './useUIStore'
import { useUserSettingStore } from '@/stores/useUserSettingStore'
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
    const userSettingStore = useUserSettingStore()

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
        applyUserSettings:        () => { userSettingStore.applyEntries(data); conversationStore.projectUserSettings() },
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
    // conversations 缓存与 user_settings 缓存是两份独立的 localStorage 持久化，写入时机互不保证同步
    // （比如上次退出时只有一份 watch 来得及落盘）；重启后二者可能不一致，这里用已经落盘的最新设置表
    // 重新投影一遍会话缓存，纠正这种漂移（不是为了应对「UG 先到、缓存后加载」——vueSocket 在上面才
    // 构造，这里仍是同一段同步代码，不可能被异步到达的 UG 打断）
    if (convs) {
      conversationStore.conversations = convs
      conversationStore.projectUserSettings()
    }
    const msgs = LocalStore.getMessages()
    // 用 hydrateMessages 而不是直接赋值：它会把回灌进来、卡在「通话中」状态的
    // 通话记录归一成「已结束」，详见 useMessageStore.ts 里的说明。
    if (msgs) messageStore.hydrateMessages(msgs)
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
    window.electronAPI?.setLoggedIn(false)
  }

  function modifyMyInfo(value: any) {
    vueSocket?.modifyMyInfo(value)
  }

  return { userId, token, deviceId, user, initData, loginOut, modifyMyInfo }
})
