import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import type { StateConversationInfo } from '@/types'
import LocalStore from '@/websocket/store/localstore'
import webSocketClient from '@/websocket/websocketcli'
import { useAuthStore } from '@/stores/useAuthStore'

export const useConversationStore = defineStore('conversation', () => {
  const conversations = ref<StateConversationInfo[]>([])
  const selectTarget = ref(LocalStore.getSelectTarget() ?? '')
  const searchText = ref('')
  const isLoadRemoteMessage = ref(false)
  const atMeSet = ref<Set<string>>(new Set())

  const searchedConversationList = computed(() =>
    conversations.value.filter(c => c.name?.includes(searchText.value))
  )

  const isSingleConversation = computed(() => {
    const c = conversations.value.find(c => c.conversationInfo.target === selectTarget.value)
    return c?.conversationInfo.conversationType === 0
  })

  function selectConversation(target: string) {
    isLoadRemoteMessage.value = false
    selectTarget.value = target
    atMeSet.value.delete(target)
    const c = conversations.value.find(c => c.conversationInfo.target === target)
    if (c?.conversationInfo.unreadCount) {
      c.conversationInfo.unreadCount.unread = 0
    }
  }

  function clearUnreadStatus() {
    const c = conversations.value.find(c => c.conversationInfo.target === selectTarget.value)
    if (c?.conversationInfo.unreadCount) {
      c.conversationInfo.unreadCount.unread = 0
    }
  }

  function updateConversationInfo(protoConversationInfo: any) {
    // Check if this group message @ mentions the current user
    const msg = protoConversationInfo.lastMessage
    if (protoConversationInfo.conversationType === 1 && msg?.content) {
      const myId = useAuthStore().userId
      const { mentionedType, mentionedTargets } = msg.content
      if (
        mentionedType === 2 ||
        (mentionedType === 1 && Array.isArray(mentionedTargets) && mentionedTargets.includes(myId))
      ) {
        atMeSet.value.add(protoConversationInfo.target)
      }
    }

    let update = false
    let updateStateConversationInfo: StateConversationInfo | null = null
    let currentIndex = -1

    for (let i = 0; i < conversations.value.length; i++) {
      const sc = conversations.value[i]
      if (sc.conversationInfo.conversationType === protoConversationInfo.conversationType &&
          sc.conversationInfo.target === protoConversationInfo.target) {
        update = true
        currentIndex = i
        sc.conversationInfo.lastMessage = protoConversationInfo.lastMessage
        sc.conversationInfo.timestamp = protoConversationInfo.lastMessage?.timestamp ?? protoConversationInfo.timestamp
        updateStateConversationInfo = sc
        break
      }
    }

    if (update && currentIndex !== -1 && updateStateConversationInfo) {
      conversations.value.splice(currentIndex, 1)
      conversations.value.unshift(updateStateConversationInfo)
    }

    if (!update) {
      updateStateConversationInfo = {
        name: protoConversationInfo.target,
        img: '',
        conversationInfo: protoConversationInfo
      }
      conversations.value.unshift(updateStateConversationInfo)
      if (protoConversationInfo.conversationType === 1) {
        webSocketClient.getGroupInfo(protoConversationInfo.target, false)
      }
    }

    updateConverstationOrder()
  }

  function updateConversationIntro(groupInfos: any[]) {
    for (const groupInfo of groupInfos) {
      const sc = conversations.value.find(c => c.conversationInfo.target === groupInfo.target)
      if (sc) {
        sc.name = groupInfo.name
        if (groupInfo.portrait) sc.img = groupInfo.portrait
      }
    }
  }

  function topConversation(targetId: string) {
    const sc = conversations.value.find(c => c.conversationInfo.target === targetId)
    if (sc) sc.conversationInfo.isTop = true
    updateConverstationOrder()
  }

  function unTopConversation(targetId: string) {
    const sc = conversations.value.find(c => c.conversationInfo.target === targetId)
    if (sc) sc.conversationInfo.isTop = false
    updateConverstationOrder()
  }

  function silentConversation(targetId: string) {
    const sc = conversations.value.find(c => c.conversationInfo.target === targetId)
    if (sc) sc.conversationInfo.isSilent = true
  }

  function unSilentConversation(targetId: string) {
    const sc = conversations.value.find(c => c.conversationInfo.target === targetId)
    if (sc) sc.conversationInfo.isSilent = false
  }

  function deleteConversation(targetId: string) {
    const idx = conversations.value.findIndex(c => c.conversationInfo.target === targetId)
    if (idx !== -1) conversations.value.splice(idx, 1)
    if (conversations.value.length > 0) {
      const nextIdx = Math.max(0, idx - 1)
      selectTarget.value = conversations.value[nextIdx].conversationInfo.target
    }
  }

  function clearConversationMessages(target: string) {
    const sc = conversations.value.find(c => c.conversationInfo.target === target)
    if (sc) sc.conversationInfo.lastMessage = null
  }

  function updateConverstationOrder() {
    const top = conversations.value.filter(c => c.conversationInfo.isTop)
    const rest = conversations.value.filter(c => !c.conversationInfo.isTop)
    conversations.value = [...top, ...rest]
  }

  // Called after initial message pull to fetch portraits for group convs missing them
  function syncGroupInfos() {
    const groupTargets = conversations.value
      .filter(c => c.conversationInfo.conversationType === 1 && !c.img)
      .map(c => c.conversationInfo.target)
    for (const target of groupTargets) {
      webSocketClient.getGroupInfo(target, false)
    }
  }

  // Called after initial message pull to fetch user info for single convs missing name/portrait
  function syncUserInfos() {
    const userTargets = conversations.value
      .filter(c => c.conversationInfo.conversationType === 0 && !c.img)
      .map(c => c.conversationInfo.target)
    if (userTargets.length > 0) {
      webSocketClient.getUserInfos(userTargets)
    }
  }

  function reset() {
    conversations.value = []
    selectTarget.value = ''
    searchText.value = ''
    isLoadRemoteMessage.value = false
  }

  watch(conversations, val => LocalStore.saveConverSations(val), { deep: true })
  watch(selectTarget, val => LocalStore.setSelectTarget(val))

  return {
    conversations, selectTarget, searchText, isLoadRemoteMessage, atMeSet,
    searchedConversationList, isSingleConversation,
    selectConversation, clearUnreadStatus, updateConversationInfo,
    updateConversationIntro, topConversation, unTopConversation,
    silentConversation, unSilentConversation, deleteConversation,
    clearConversationMessages, updateConverstationOrder, syncGroupInfos, syncUserInfos,
    reset,
  }
})
