import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { CONVERSATION_MAX_MESSAGE_SIZE } from '@/constant'
import type { StateChatMessage, ProtoMessage } from '@/types'
import { useConversationStore } from './useConversationStore'
import { useUIStore } from './useUIStore'
import LocalStore from '@/websocket/store/localstore'
import MessageStatus from '@/websocket/message/messageStatus'
import ProtoConversationInfo from '@/websocket/model/protoConversationInfo'
import UnreadCount from '@/websocket/model/unReadCount'
import MessageConfig from '@/websocket/message/messageConfig'
import RecallMessageNotification from '@/websocket/message/notification/recallMessageNotification'
import MessageContentType from '@/websocket/message/messageContentType'
import webSocketClient from '@/websocket/websocketcli'

export const useMessageStore = defineStore('message', () => {
  const messages = ref<StateChatMessage[]>([])
  const fileDownloadStatus = ref<any[]>([])
  const streamingMap = ref<Record<string, { target: string; virtualId: string }>>({})
  const streamingTokenCount = ref(0)
  const pendingReplacementTargets = ref<string[]>([])
  const scrollBottomTrigger = ref(0)
  function triggerScrollBottom() { scrollBottomTrigger.value++ }

  const incomingMsgTrigger = ref(0)
  function triggerIncoming() { incomingMsgTrigger.value++ }

  const selectedChat = computed(() => {
    const convStore = useConversationStore()
    const chat = messages.value.find(m => m.target === convStore.selectTarget)
    return chat ?? { name: '', target: convStore.selectTarget, protoMessages: [] }
  })

  const currentMessages = computed(() => selectedChat.value.protoMessages ?? [])

  function addProtoMessage(protoMessage: ProtoMessage) {
    const convStore = useConversationStore()

    // Remove stream placeholder if pending
    const pidx = pendingReplacementTargets.value.indexOf(protoMessage.target)
    if (pidx !== -1) {
      pendingReplacementTargets.value.splice(pidx, 1)
      const chat = messages.value.find(m => m.target === protoMessage.target)
      if (chat) {
        chat.protoMessages = chat.protoMessages.filter(
          (m: any) => !(typeof m.messageId === 'string' && m.messageId.startsWith('stream_'))
        )
      }
      for (const sid of Object.keys(streamingMap.value)) {
        if (streamingMap.value[sid].target === protoMessage.target) {
          delete streamingMap.value[sid]
        }
      }
    }

    let added = false
    let isExist = false
    for (const chat of messages.value) {
      if (chat.target === protoMessage.target) {
        added = true
        const existing = chat.protoMessages.find((m: any) => m.messageId === protoMessage.messageId)
        if (!existing) {
          if (chat.protoMessages.length > CONVERSATION_MAX_MESSAGE_SIZE) {
            chat.protoMessages.splice(0, chat.protoMessages.length - CONVERSATION_MAX_MESSAGE_SIZE)
            convStore.isLoadRemoteMessage = false
          }
          chat.protoMessages.push(protoMessage)
          // 收到新消息（direction=1）且是当前会话，通知 MessageList 更新徽标
          if (protoMessage.direction === 1 && protoMessage.target === convStore.selectTarget) {
            triggerIncoming()
          }
        } else {
          if (existing.messageUid === '0') {
            existing.messageUid = protoMessage.messageUid
            existing.status = MessageStatus.Sent
          }
          isExist = true
        }
      }
    }

    if (!added) {
      messages.value.push({ target: protoMessage.target, name: '', protoMessages: [protoMessage] })
    }

    if (!isExist) {
      const pci = new ProtoConversationInfo()
      pci.conversationType = protoMessage.conversationType
      pci.target = protoMessage.target
      pci.line = 0
      pci.timestamp = protoMessage.timestamp
      pci.lastMessage = protoMessage
      pci.unreadCount = new UnreadCount()
      convStore.updateConversationInfo(pci)

      // 只有初始拉取完成后（firstLogin=false）才累加未读数，避免历史消息全部计入未读
      const uiStore = useUIStore()
      if (!uiStore.firstLogin && protoMessage.direction === 1) {
        const isCurrentConv = protoMessage.target === convStore.selectTarget
        const isTabVisible = uiStore.visibilityState === 'visible'
        // 非当前会话，或当前会话但 tab 已切走时，均累加未读
        if (!isCurrentConv || !isTabVisible) {
          const sc = convStore.conversations.find(c => c.conversationInfo.target === protoMessage.target)
          const isSilent = sc?.conversationInfo.isSilent ?? false
          // 免打扰时不播放提示音
          if (!isSilent) {
            uiStore.playMsgNotify()
          }
          if (sc) {
            if (!sc.conversationInfo.unreadCount) sc.conversationInfo.unreadCount = new UnreadCount()
            sc.conversationInfo.unreadCount.unread++
          }
        }
      }
    }

    // Auto-delete conversation when group is dismissed
    if (protoMessage.content?.type === MessageContentType.DismissGroup_Notification) {
      setTimeout(() => convStore.deleteConversation(protoMessage.target), 500)
    }

    // Re-fetch group info when name changes so conversation list + chat title sync
    if (protoMessage.content?.type === MessageContentType.ChangeGroupName_Notification) {
      webSocketClient.getGroupInfo(protoMessage.target, false)
    }
  }

  function preAddProtoMessage(protoMessage: ProtoMessage) {
    const convStore = useConversationStore()
    if (!MessageConfig.isDisplayableMessage(protoMessage)) return

    const scIdx = convStore.conversations.findIndex((c: any) => c.conversationInfo.target === protoMessage.target)
    if (scIdx !== -1) {
      const sc = convStore.conversations[scIdx]
      sc.conversationInfo.lastMessage = protoMessage
      sc.conversationInfo.timestamp = protoMessage.timestamp
      convStore.conversations.splice(scIdx, 1)
      convStore.conversations.unshift(sc)
      convStore.updateConverstationOrder()
    }

    let chat = messages.value.find(m => m.target === protoMessage.target)
    if (!chat) {
      chat = { target: protoMessage.target, name: '', protoMessages: [] }
      messages.value.push(chat)
    } else if (chat.protoMessages.length > CONVERSATION_MAX_MESSAGE_SIZE) {
      chat.protoMessages.splice(0, chat.protoMessages.length - CONVERSATION_MAX_MESSAGE_SIZE)
      // Reset so MessageList's length watcher won't try to restore historical scroll position
      useConversationStore().isLoadRemoteMessage = false
    }
    // If a streaming virtual message is already in the list, insert the new outgoing
    // message before it so the streaming bubble stays at the bottom and remains visible.
    const streamingIdx = chat.protoMessages.findIndex(
      (m: any) => typeof m.messageId === 'string' && m.messageId.startsWith('stream_')
    )
    if (streamingIdx !== -1) {
      chat.protoMessages.splice(streamingIdx, 0, protoMessage)
    } else {
      chat.protoMessages.push(protoMessage)
    }
  }

  function addOldMessage(protoMessage: ProtoMessage) {
    const chat = messages.value.find(m => m.target === protoMessage.target)
    if (chat) {
      const exists = chat.protoMessages.find((m: any) => m.messageId === protoMessage.messageId)
      if (!exists) chat.protoMessages.unshift(protoMessage)
    }
  }

  function deleteMessage(messageId: string) {
    const convStore = useConversationStore()
    const chat = messages.value.find(m => m.target === convStore.selectTarget)
    if (!chat) return
    const idx = chat.protoMessages.findIndex((m: any) => m.messageId === messageId)
    if (idx !== -1) chat.protoMessages.splice(idx, 1)
  }

  function updateMessageContent(notifyMsg: any) {
    for (const chat of messages.value) {
      for (const msg of chat.protoMessages as any[]) {
        if (msg.messageUid === notifyMsg.messageUid) {
          const recall = new RecallMessageNotification(notifyMsg.fromUser, notifyMsg.messageUid)
          msg.content = recall.encode()
          return
        }
      }
    }
  }

  function updateProtoMessageUid(update: { messageId: string; messageUid: string }) {
    for (const chat of messages.value) {
      for (const msg of chat.protoMessages as any[]) {
        if (msg.messageId === update.messageId) {
          msg.messageUid = update.messageUid
          return
        }
      }
    }
  }

  function updateMessageStatus(update: { messageId: string; status: number }) {
    for (const chat of messages.value) {
      for (const msg of chat.protoMessages as any[]) {
        if (msg.messageId === update.messageId) {
          msg.status = update.status
          return
        }
      }
    }
  }

  function appendStreamingContent(payload: { streamId: string; delta: string; isDone: boolean; target: string }) {
    const { streamId, delta, isDone, target } = payload
    if (!streamingMap.value[streamId]) {
      const virtualId = 'stream_' + streamId
      const virtualMsg: any = {
        messageId: virtualId, from: target, target, conversationType: 0,
        direction: 1, content: { type: 1, searchableContent: '' },
        streaming: true, timestamp: Date.now(), status: 1, messageUid: '0', line: 0, tos: ''
      }
      let chat = messages.value.find(m => m.target === target)
      if (!chat) {
        chat = { target, name: target, protoMessages: [] }
        messages.value.push(chat)
      }
      chat.protoMessages.push(virtualMsg)
      streamingMap.value[streamId] = { target, virtualId }
      triggerScrollBottom()
    }

    const entry = streamingMap.value[streamId]
    if (!entry) return
    const chat = messages.value.find(m => m.target === entry.target)
    if (chat) {
      const msg = chat.protoMessages.find((m: any) => m.messageId === entry.virtualId) as any
      if (msg && delta) { msg.content.searchableContent += delta; streamingTokenCount.value++ }
      if (isDone && msg) {
        msg.streaming = false
        if (!pendingReplacementTargets.value.includes(entry.target)) {
          pendingReplacementTargets.value.push(entry.target)
        }
        delete streamingMap.value[streamId]
      }
    }
  }

  function setFileDownloadStatus(status: any) {
    const existing = fileDownloadStatus.value.find((f: any) => f.messageId === status.messageId)
    if (existing) { existing.downloadStatus = status.downloadStatus; existing.downloadPercent = status.downloadPercent }
    else fileDownloadStatus.value.push(status)
  }

  function updateSendMessage(update: { messageId: string; messageContent: any }) {
    for (const chat of messages.value) {
      for (const msg of chat.protoMessages as any[]) {
        if (msg.messageId === update.messageId) {
          msg.content = update.messageContent.encode ? update.messageContent.encode() : update.messageContent
          return
        }
      }
    }
  }

  function reset() {
    messages.value = []
    fileDownloadStatus.value = []
    streamingMap.value = {}
    streamingTokenCount.value = 0
    pendingReplacementTargets.value = []
  }

  watch(messages, val => LocalStore.saveMessages(val), { deep: true })

  return {
    messages, fileDownloadStatus, streamingMap, streamingTokenCount, pendingReplacementTargets,
    selectedChat, currentMessages,
    addProtoMessage, preAddProtoMessage, addOldMessage, deleteMessage,
    updateMessageContent, updateProtoMessageUid, updateMessageStatus,
    appendStreamingContent, setFileDownloadStatus, updateSendMessage,
    scrollBottomTrigger, triggerScrollBottom,
    incomingMsgTrigger, triggerIncoming,
    reset,
  }
})
