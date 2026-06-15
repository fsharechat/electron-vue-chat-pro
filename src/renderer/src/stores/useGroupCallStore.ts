import { ref } from 'vue'
import { defineStore } from 'pinia'
import GroupCallClient from '@/webrtc/groupCallClient'
import SessionCallback from '@/webrtc/sessionCallback'
import EngineCallback from '@/webrtc/engineCallback'
import CallState from '@/webrtc/callState'
import LocalStore from '@/websocket/store/localstore'

export interface GroupCallMember {
  uid: string
  name: string
  img: string
  showVideo: boolean
}

export const useGroupCallStore = defineStore('groupCall', () => {
  const members = ref<GroupCallMember[]>([])
  const isSender = ref(false)
  const currentTarget = ref('')
  const showGroupCallDialog = ref(false)

  const sessionCb = new SessionCallback()
  const engineCb = new EngineCallback()
  const client = new GroupCallClient()
  client.setCurrentSessionCallback(sessionCb)
  client.setCurrentEngineCallback(engineCb)

  sessionCb.didReceiveRemoteVideoTrack = (_stream: any, sender: string) => {
    const member = members.value.find(m => m.uid === sender)
    if (member) member.showVideo = true
  }

  sessionCb.didCallEndWithReason = (_reason: number, sender: string) => {
    const selfId = LocalStore.getUserId()
    if (!sender || selfId === sender) {
      showGroupCallDialog.value = false
      members.value = []
    } else {
      const member = members.value.find(m => m.uid === sender)
      if (member) member.showVideo = false
    }
  }

  sessionCb.didError = () => {
    showGroupCallDialog.value = false
    members.value = []
  }

  engineCb.onReceiveCall = (session: any) => {
    isSender.value = false
    const tos: string[] = session.tos ?? []
    // populate members with minimal info; portraits load later
    members.value = tos.map((id: string) => ({
      uid: id, name: id, img: '', showVideo: false
    }))
    showGroupCallDialog.value = true
  }

  engineCb.shouldStartRing = () => {}
  engineCb.shouldSopRing = () => {}

  function resolveMembers(memberIds: string[], userInfoList: any[]) {
    members.value = memberIds.map(id => {
      const user = userInfoList.find((u: any) => u.uid === id)
      return {
        uid: id,
        name: user?.displayName || user?.nickname || id,
        img: user?.portrait || '',
        showVideo: false,
      }
    })
  }

  function startGroupCall(target: string, memberIds: string[], userInfoList: any[]) {
    isSender.value = true
    currentTarget.value = target
    resolveMembers(memberIds, userInfoList)
    showGroupCallDialog.value = true
    try {
      client.startCall(target, memberIds, false)
    } catch (e) {
      console.error('startGroupCall error:', e)
      showGroupCallDialog.value = false
      members.value = []
    }
  }

  function answerCall() {
    client.answerCall(false)
  }

  function endCall() {
    // 先关闭对话框，再尝试发送结束信令（currentSession 可能尚未建立）
    const membersSnap = members.value.map(m => m.uid)
    members.value = []
    showGroupCallDialog.value = false
    try {
      client.endCall(membersSnap)
    } catch (e) {
      console.warn('endCall signal error (session may not be established):', e)
    }
  }

  function updateMemberInfo(userInfoList: any[]) {
    members.value = members.value.map(m => {
      const user = userInfoList.find((u: any) => u.uid === m.uid)
      if (user) {
        return { ...m, name: user.displayName || user.nickname || m.name, img: user.portrait || m.img }
      }
      return m
    })
  }

  return {
    members, isSender, currentTarget, showGroupCallDialog,
    client, startGroupCall, answerCall, endCall, updateMemberInfo,
  }
})
