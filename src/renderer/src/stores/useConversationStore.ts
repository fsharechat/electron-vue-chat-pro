import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import type { StateConversationInfo } from '@/types'
import LocalStore from '@/websocket/store/localstore'
import webSocketClient from '@/websocket/websocketcli'
import { useAuthStore } from '@/stores/useAuthStore'
import { useUserSettingStore } from '@/stores/useUserSettingStore'
import { USER_SETTING_SCOPE, conversationSettingKey } from '@/constant'

export const useConversationStore = defineStore('conversation', () => {
  const conversations = ref<StateConversationInfo[]>([])
  const selectTarget = ref(LocalStore.getSelectTarget() ?? '')
  const searchText = ref('')
  const atMeSet = ref<Set<string>>(new Set())

  const searchedConversationList = computed(() =>
    conversations.value.filter(c => c.name?.includes(searchText.value))
  )

  const isSingleConversation = computed(() => {
    const c = conversations.value.find(c => c.conversationInfo.target === selectTarget.value)
    return c?.conversationInfo.conversationType === 0
  })

  function selectConversation(target: string) {
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
      // 从设置派生而非沿用服务端推来的 falsy 值：UG 可能先于会话建立到达
      //（重装/换设备场景），只在 UG 落地那一刻投影一次会漏掉之后才建出来的会话
      const settingStore = useUserSettingStore()
      const info = protoConversationInfo
      info.isTop = settingStore.isConversationTop(info.conversationType, info.line ?? 0, info.target)
      info.isSilent = settingStore.isConversationSilent(info.conversationType, info.line ?? 0, info.target)

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

  /**
   * 把设置表投影回已存在的会话行。只应在两个点调用：UG 应答落地（applyEntries）之后，
   * 以及登录时从 LocalStore 回灌会话缓存之后——这两个点服务端/上次持久化的数据都是权威的。
   * 千万不要挂在每条消息的 update 分支上：那样会把用户刚做的本地取消/开启操作，
   * 用尚未来得及被这次操作覆盖的旧设置值盖回去。
   */
  function projectUserSettings() {
    const settingStore = useUserSettingStore()
    for (const sc of conversations.value) {
      const info = sc.conversationInfo
      info.isTop = settingStore.isConversationTop(info.conversationType, info.line ?? 0, info.target)
      info.isSilent = settingStore.isConversationSilent(info.conversationType, info.line ?? 0, info.target)
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

  /** 把一条会话设置上报给服务端。取消传 "0"（tombstone），不要用删除表达 */
  function reportConversationSetting(sc: StateConversationInfo, scope: number, value: string) {
    const info = sc.conversationInfo
    const key = conversationSettingKey(info.conversationType, info.line ?? 0, info.target)
    webSocketClient.updateUserSetting(scope, key, value)
  }

  function topConversation(targetId: string) {
    const sc = conversations.value.find(c => c.conversationInfo.target === targetId)
    if (sc) {
      sc.conversationInfo.isTop = true
      reportConversationSetting(sc, USER_SETTING_SCOPE.conversationTop, '1')
    }
    updateConverstationOrder()
  }

  function unTopConversation(targetId: string) {
    const sc = conversations.value.find(c => c.conversationInfo.target === targetId)
    if (sc) {
      sc.conversationInfo.isTop = false
      reportConversationSetting(sc, USER_SETTING_SCOPE.conversationTop, '0')
    }
    updateConverstationOrder()
  }

  function silentConversation(targetId: string) {
    const sc = conversations.value.find(c => c.conversationInfo.target === targetId)
    if (sc) {
      sc.conversationInfo.isSilent = true
      reportConversationSetting(sc, USER_SETTING_SCOPE.conversationSilent, '1')
    }
  }

  function unSilentConversation(targetId: string) {
    const sc = conversations.value.find(c => c.conversationInfo.target === targetId)
    if (sc) {
      sc.conversationInfo.isSilent = false
      reportConversationSetting(sc, USER_SETTING_SCOPE.conversationSilent, '0')
    }
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
  }

  watch(conversations, val => LocalStore.saveConverSations(val), { deep: true })
  watch(selectTarget, val => LocalStore.setSelectTarget(val))

  return {
    conversations, selectTarget, searchText, atMeSet,
    searchedConversationList, isSingleConversation,
    selectConversation, clearUnreadStatus, updateConversationInfo,
    updateConversationIntro, topConversation, unTopConversation,
    silentConversation, unSilentConversation, deleteConversation,
    clearConversationMessages, updateConverstationOrder, syncGroupInfos, syncUserInfos,
    projectUserSettings,
    reset,
  }
})
