// @ts-nocheck
import { useUIStore } from '@/stores/useUIStore'
import { useConversationStore } from '@/stores/useConversationStore'

class WebSocketClient {
  constructor() {
    this._instance = null
    this._pendingFetch = new Set()
    this._fetchTimer = null
  }

  setInstance(vueWebSocket) {
    this._instance = vueWebSocket
  }

  // Queue a background fetch for a user whose info is missing
  _scheduleFetch(userId) {
    if (this._pendingFetch.has(userId) || !this._instance) return
    this._pendingFetch.add(userId)
    clearTimeout(this._fetchTimer)
    this._fetchTimer = setTimeout(() => {
      const ids = [...this._pendingFetch]
      this._pendingFetch.clear()
      this._instance?.getUserInfos(ids)
    }, 200)
  }

  getDisplayName(userId) {
    try {
      const uiStore = useUIStore()
      const info = uiStore.userInfoList.find((u: any) => u.uid === userId)
      if (info?.displayName) return info.displayName
      // Fall back to conversation name for single chats
      const convStore = useConversationStore()
      const conv = convStore.conversations.find(
        (c: any) => c.conversationInfo.conversationType === 0 && c.conversationInfo.target === userId
      )
      if (conv?.name) return conv.name
      // User not found — schedule a background fetch so it resolves on next render
      this._scheduleFetch(userId)
    } catch {}
    return userId
  }

  getPortrait(userId) {
    try {
      const uiStore = useUIStore()
      const info = uiStore.userInfoList.find((u: any) => u.uid === userId)
      if (info?.portrait) return info.portrait
    } catch {}
    return 'images/vue.jpg'
  }

  createGroup(groupName, memberIds) {
    return this._instance?.createGroup(groupName, memberIds)
  }

  modifyGroupInfo(info) { return this._instance?.modifyGroupInfo(info) }
  quitGroup(groupId) { return this._instance?.quitGroup(groupId) }
  dismissGroup(groupId) { return this._instance?.dismissGroup(groupId) }
  getGroupMember(groupId) { return this._instance?.getGroupMember(groupId) }
  addMembers(groupId, memberIds) { return this._instance?.addMembers(groupId, memberIds) }
  kickeMembers(groupId, memberIds) { return this._instance?.kickeMembers(groupId, memberIds) }
  recallMessage(messageUid) { return this._instance?.recallMessage(messageUid) }
  getMinioUploadUrl(mediaType, key) { return this._instance?.getMinioUploadUrl(mediaType, key) }
  modifyFriendAlias(targetUid, alias) { return this._instance?.modifyFriendAlias(targetUid, alias) }
  getGroupInfo(groupId, refresh = false) {
    return this._instance?.getGroupInfo(groupId, refresh)
  }

  getUserInfos(userIds) {
    return this._instance?.getUserInfos(userIds)
  }

  getRemoteMessages(conversation, beforeUid, count) {
    return this._instance?.getRemoteMessages(conversation, beforeUid, count)
  }
  uploadDeliveryReport(date, target) {
    return this._instance?.uploadDeliveryReport(date, target)
  }
  uploadReadReport(date, target, conversationType) {
    return this._instance?.uploadReadReport(date, target, conversationType)
  }
}

export default new WebSocketClient()
