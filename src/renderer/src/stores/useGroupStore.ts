import { ref, computed, watch } from 'vue'
import { defineStore } from 'pinia'
import type { GroupInfo, GroupMember } from '@/types'
import { useConversationStore } from './useConversationStore'
import LocalStore from '@/websocket/store/localstore'

export const useGroupStore = defineStore('group', () => {
  const groupInfoList = ref<GroupInfo[]>([])
  const groupMemberMap = ref<Map<string, GroupMember[]>>(new Map())
  const tempGroupMembers = ref<GroupMember[]>([])
  const groupOperateState = ref(0)
  const groupMemberTracker = ref(0)
  const groupSendMessageUserMap = ref<Map<string, string[]>>(new Map())
  const groupCallMembers = ref<{ uid: string; name: string }[]>([])

  const currentGroupMembers = computed(() => {
    const target = useConversationStore().selectTarget
    return groupMemberMap.value.get(target) ?? []
  })

  const currentGroupMemberCount = computed(() => {
    const target = useConversationStore().selectTarget
    return groupInfoList.value.find(g => g.target === target)?.memberCount ?? 0
  })

  function updateGroupInfos(infos: any[]) {
    for (const info of infos) {
      const idx = groupInfoList.value.findIndex(g => g.target === info.target)
      if (idx !== -1) groupInfoList.value.splice(idx, 1, info)
      else groupInfoList.value.push(info)
    }
    useConversationStore().updateConversationIntro(infos)
  }

  function updateTempGroupMember(members: GroupMember[]) {
    tempGroupMembers.value = members
  }

  function addGroupSendUser(info: { target: string; from: string }) {
    const list = groupSendMessageUserMap.value.get(info.target) ?? []
    if (!list.includes(info.from)) list.push(info.from)
    groupSendMessageUserMap.value.set(info.target, list)
  }

  function reset() {
    groupInfoList.value = []
    groupMemberMap.value = new Map()
    tempGroupMembers.value = []
    groupOperateState.value = 0
    groupMemberTracker.value = 0
    groupSendMessageUserMap.value = new Map()
    groupCallMembers.value = []
  }

  watch(groupInfoList, val => LocalStore.setGroupInfos(val), { deep: true })

  return {
    groupInfoList, groupMemberMap, tempGroupMembers,
    groupOperateState, groupMemberTracker, groupSendMessageUserMap,
    groupCallMembers,
    currentGroupMembers, currentGroupMemberCount,
    updateGroupInfos, updateTempGroupMember, addGroupSendUser,
    reset,
  }
})
