import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import type { FriendInfo, FriendData, FriendRequest } from '@/types'
import { useConversationStore } from './useConversationStore'
import { useAuthStore } from './useAuthStore'
import { pinyin } from 'pinyin-pro'

export const useFriendStore = defineStore('friend', () => {
  const friendlist = ref<FriendInfo[]>([{
    id: 0, wxid: 'new', initial: '新的朋友', img: 'images/newfriend.jpg',
    signature: '', nickname: '新的朋友', sex: 0, remark: '新的朋友', area: '', mobile: ''
  }])
  const friendIds = ref<string[]>([])
  const friendDatas = ref<FriendData[]>([])
  const friendRequests = ref<FriendRequest[]>([])
  const newFriendRequestCount = ref(0)
  const searchUsers = ref<any[]>([])
  const selectFriendId = ref(0)
  const friendSearchText = ref('')

  const searchedFriendlist = computed(() => {
    const keyword = friendSearchText.value.trim().toLowerCase()
    const map = new Map<string, FriendInfo[]>()
    const noInit: FriendInfo[] = []
    for (const f of friendlist.value) {
      if (f.id === 0) continue
      if (keyword) {
        const name = (f.remark || f.nickname || '').toLowerCase()
        if (!name.includes(keyword)) continue
      }
      if (f.initial) {
        if (!map.has(f.initial)) map.set(f.initial, [])
        map.get(f.initial)!.push(f)
      } else {
        noInit.push(f)
      }
    }
    const sorted = [...map.keys()].sort((a, b) => a.localeCompare(b))
    const all: FriendInfo[] = []
    if (!keyword && friendlist.value.length > 0) all.push(friendlist.value[0])
    noInit.forEach(f => all.push(f))
    for (const k of sorted) map.get(k)!.forEach(f => all.push(f))
    return all
  })

  const onlyFriendlist = computed(() =>
    friendlist.value.slice(1).map(f => ({ id: f.id, wxid: f.wxid, remark: f.remark, img: f.img, initial: f.initial, checked: false }))
  )

  const selectedFriend = computed(() =>
    friendlist.value.find(f => f.id === selectFriendId.value)
  )

  function updateFriendList(users: any[]) {
    if (friendlist.value.length === 0) {
      friendlist.value.push({ id: 0, wxid: 'new', initial: '新的朋友', img: 'images/newfriend.jpg', signature: '', nickname: '新的朋友', sex: 0, remark: '新的朋友', area: '', mobile: '' })
    }
    const convStore = useConversationStore()

    for (const currentUser of users) {
      const friendUid = friendIds.value.find(id => id === currentUser.wxid)
      if (!friendUid) continue
      const friendData = friendDatas.value.find((f: FriendData) => f.friendUid === friendUid)
      if (friendData?.alias) {
        currentUser.remark = friendData.alias
        try {
          const pi = pinyin(currentUser.remark, { pattern: 'first', toneType: 'none', type: 'array' })
          const initial = pi[0]
          currentUser.initial = /^[A-Za-z]/.test(initial) ? initial.toUpperCase() : '#'
        } catch {
          currentUser.initial = '#'
        }
      }
      const exists = friendlist.value.find(f => f.wxid === currentUser.wxid)
      if (exists) {
        exists.initial = currentUser.initial; exists.nickname = currentUser.nickname
        exists.img = currentUser.img; exists.remark = currentUser.remark
      } else {
        currentUser.id = friendlist.value.length
        friendlist.value.push(currentUser)
      }
    }
    for (const sc of convStore.conversations) {
      const friend = friendlist.value.find(f => f.wxid === sc.conversationInfo.target)
      if (friend) { sc.name = friend.remark || friend.nickname; sc.img = friend.img }
    }
  }

  function updateFriendIds(list: FriendData[]) {
    if (!list) return
    friendDatas.value = list
    friendIds.value = list.map(f => f.friendUid)
  }

  function updateFriendRequest(requests: any[]) {
    for (const r of requests) {
      if (r.status === 0 && Date.now() - r.timestamp > 7 * 24 * 60 * 60 * 1000) continue
      const existing = friendRequests.value.find(f => f.from === r.from)
      if (existing) { existing.status = r.status }
      else {
        if (r.status === 0) newFriendRequestCount.value++
        friendRequests.value.push(r)
      }
    }
  }

  function updateSearchUser(users: any[]) {
    const authStore = useAuthStore()
    searchUsers.value = users.filter(u => !friendlist.value.find(f => f.wxid === u.uid) && u.uid !== authStore.userId)
  }

  function handleFriendRequest(value: { targetUid: string }) {
    const r = friendRequests.value.find(f => f.from === value.targetUid)
    if (r && r.status === 0) {
      r.status = 1
      if (newFriendRequestCount.value > 0) newFriendRequestCount.value--
    }
  }

  function reset() {
    friendlist.value = [{
      id: 0, wxid: 'new', initial: '新的朋友', img: 'images/newfriend.jpg',
      signature: '', nickname: '新的朋友', sex: 0, remark: '新的朋友', area: '', mobile: ''
    }]
    friendIds.value = []
    friendDatas.value = []
    friendRequests.value = []
    newFriendRequestCount.value = 0
    searchUsers.value = []
    selectFriendId.value = 0
  }

  return {
    friendlist, friendIds, friendDatas, friendRequests, newFriendRequestCount,
    searchUsers, selectFriendId, friendSearchText,
    searchedFriendlist, onlyFriendlist, selectedFriend,
    updateFriendList, updateFriendIds, updateFriendRequest, updateSearchUser, handleFriendRequest,
    reset,
  }
})
