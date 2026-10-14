import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import { CONVERSATION_MAX_MESSAGE_SIZE } from '@/constant'
import type { StateChatMessage, ProtoMessage } from '@/types'
import { useConversationStore } from './useConversationStore'
import { useUIStore } from './useUIStore'
import { useTranscriptStore } from './useTranscriptStore'
import LocalStore from '@/websocket/store/localstore'
import MessageStatus from '@/websocket/message/messageStatus'
import ProtoConversationInfo from '@/websocket/model/protoConversationInfo'
import UnreadCount from '@/websocket/model/unReadCount'
import MessageConfig from '@/websocket/message/messageConfig'
import RecallMessageNotification from '@/websocket/message/notification/recallMessageNotification'
import MessageContentType from '@/websocket/message/messageContentType'
import webSocketClient from '@/websocket/websocketcli'
import { CALL_STATUS_CONNECTED, CALL_STATUS_ENDED } from '@/webrtc/callRecordText'

// 语音「已播放」上线前本地已有的他人语音都是 Unread，首次加载时一次性置为 Played，避免升级后满屏红点
const VOICE_PLAYED_MIGRATION_KEY = 'voice-played-migrated-v1'

function isIncomingVoice(m: ProtoMessage) {
  return m.direction === 1 && m.content?.type === MessageContentType.Voice
}

/**
 * 新插入一条消息后的语音处理：他人语音在 firstLogin 全量拉取期间是历史消息，直接置为已播放避免满屏红点；
 * 否则是实时收到的，交给自动转文字队列（开关判断在 enqueueAuto 内）。
 */
function onIncomingInserted(m: ProtoMessage) {
  if (!isIncomingVoice(m)) return
  if (useUIStore().firstLogin) m.status = MessageStatus.Played
  else useTranscriptStore().enqueueAuto(m.messageUid)
}

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
          }
          chat.protoMessages.push(protoMessage)
          onIncomingInserted(protoMessage)
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
      onIncomingInserted(protoMessage)
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
        const isAppVisible = uiStore.isAppVisible
        // 非当前会话，或当前会话但应用不可见/未聚焦时，均累加未读
        if (!isCurrentConv || !isAppVisible) {
          const sc = convStore.conversations.find(c => c.conversationInfo.target === protoMessage.target)
          const isSilent = sc?.conversationInfo.isSilent ?? false
          // 免打扰时不播放提示音
          if (!isSilent) {
            const notifyTitle = sc?.name || '新消息'
            const ct = protoMessage.content?.type
            let notifyBody: string
            if (ct === MessageContentType.Text || ct === MessageContentType.P_Text) {
              notifyBody = protoMessage.content?.searchableContent || ''
            } else if (ct === MessageContentType.Voice) {
              notifyBody = '[语音]'
            } else if (ct === MessageContentType.Image) {
              notifyBody = '[图片]'
            } else if (ct === MessageContentType.Video) {
              notifyBody = '[视频]'
            } else if (ct === MessageContentType.File) {
              notifyBody = '[文件]'
            } else {
              notifyBody = protoMessage.content?.searchableContent || '[消息]'
            }
            uiStore.playMsgNotify(notifyTitle, notifyBody)
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
      if (!exists) {
        // 上滑加载的是历史消息，多半已在其他端听过，不显示红点
        if (isIncomingVoice(protoMessage)) protoMessage.status = MessageStatus.Played
        chat.protoMessages.unshift(protoMessage)
      }
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

  /**
   * 就地更新本地通话记录的状态（Android 同款：0 未接听 / 1 通话中 / 2 已结束 /
   * 3 已在其他设备接听）。只改本地消息，不发网络 —— 服务端存的仍是主叫发出时的
   * 原始内容，换设备或清缓存后状态会回到初始值，这与 Android 的行为一致。
   *
   * patch 是增量语义：没传的字段保持原值，结束时才不会冲掉接通时刻。
   */
  function updateCallStatus(
    callId: string,
    patch: { status: number; connectTime?: number; endTime?: number }
  ) {
    for (const chat of messages.value) {
      for (const msg of chat.protoMessages as any[]) {
        // conversationType 这一条是群聊不被误伤的保险：群通话发的是同一种 CallStart
        if (msg.conversationType !== 0) continue
        if (msg.content?.type !== MessageContentType.VOIP_CONTENT_TYPE_START) continue
        if (msg.content?.content !== callId) continue

        const mc: any = MessageConfig.convert2MessageContent(msg.from, msg.content)
        // decode 失败（binaryContent 缺失等）返回 null，放弃更新好过写坏消息
        if (!mc) return
        mc.status = patch.status
        if (patch.connectTime !== undefined) mc.connectTime = patch.connectTime
        if (patch.endTime !== undefined) mc.endTime = patch.endTime
        msg.content = mc.encode()
        return
      }
    }
  }

  /**
   * 把本地缓存里卡在「通话中」(status=1) 的通话记录归一成「已结束」(status=2)。
   * status=1 是 markCallConnected 写的瞬态，靠 endSession 收尾；但通话进行中应用
   * 崩溃/被杀时 endSession 永远不会跑，watch(messages) 已经把这条瞬态记录原样
   * 落了盘。只在启动回灌时兜底，运行期这条记录本就该由 endSession 自己收尾。
   * 不动 connectTime/endTime：确实接通过，只是时长丢了，缺 endTime 时渲染成
   * 「通话时长 00:00」，比永远显示「通话中」更诚实。
   */
  function normalizeStaleCallStatus(chats: StateChatMessage[]) {
    for (const chat of chats) {
      for (const msg of chat.protoMessages as any[]) {
        if (msg.conversationType !== 0) continue
        if (msg.content?.type !== MessageContentType.VOIP_CONTENT_TYPE_START) continue
        const mc: any = MessageConfig.convert2MessageContent(msg.from, msg.content)
        if (!mc) continue
        if (mc.status === CALL_STATUS_CONNECTED) {
          mc.status = CALL_STATUS_ENDED
          msg.content = mc.encode()
        }
      }
    }
  }

  /**
   * 应用启动回灌本地消息的唯一入口（替代直接赋值 messages.value）。
   * 放在 store 而不是 useAuthStore 或 LocalStore：LocalStore 是纯 KV 存取，不该
   * 懂 CallStart 的 payload 结构；useAuthStore 只做编排。这里已经是
   * updateCallStatus 读写同一份 CallStart 编解码逻辑的地方，归一化放在一起最省心。
   */
  function hydrateMessages(chats: StateChatMessage[]) {
    normalizeStaleCallStatus(chats)
    if (localStorage.getItem(VOICE_PLAYED_MIGRATION_KEY) !== '1') {
      for (const chat of chats) {
        for (const m of chat.protoMessages as ProtoMessage[]) {
          if (isIncomingVoice(m)) m.status = MessageStatus.Played
        }
      }
      localStorage.setItem(VOICE_PLAYED_MIGRATION_KEY, '1')
    }
    messages.value = chats
  }

  /** 他人语音被播放或被点击「转文字」后置为已播放，随 messages 持久化 */
  function markPlayed(messageId: string) {
    for (const chat of messages.value) {
      const m = chat.protoMessages.find((p: any) => p.messageId === messageId)
      if (m) {
        if (m.direction === 1) m.status = MessageStatus.Played
        return
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
    updateMessageContent, updateProtoMessageUid, updateMessageStatus, updateCallStatus,
    hydrateMessages, markPlayed,
    appendStreamingContent, setFileDownloadStatus, updateSendMessage,
    scrollBottomTrigger, triggerScrollBottom,
    incomingMsgTrigger, triggerIncoming,
    reset,
  }
})
