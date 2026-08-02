import { ref, computed } from 'vue'
import { defineStore } from 'pinia'
import { useUIStore } from './useUIStore'
import { useConversationStore } from './useConversationStore'
import VoipClient from '@/webrtc/voipclient'
import EngineCallback from '@/webrtc/engineCallback'
import SessionCallback from '@/webrtc/sessionCallback'
import CallState from '@/webrtc/callState'
import CallEndReason from '@/webrtc/callEndReason'

export const useCallStore = defineStore('call', () => {
  // ── 响应式状态 ──────────────────────────────
  const callState = ref(CallState.STATUS_IDLE)
  const callDisplayName = ref('')
  const callRemoteImg = ref('')
  const isAudioOnly = ref(true)
  // 通话被「非本端操作」结束时留给用户的一句话提示，由页面消费后清空。
  // 406 多端同步会静默关掉来电界面，没有这条提示用户看不出电话去哪了。
  const callEndTip = ref('')

  // ── VoipClient 单例 ─────────────────────────
  const client = new VoipClient(null)

  // ── EngineCallback 实现 ──────────────────────
  const engineCb = new EngineCallback()
  engineCb.onReceiveCall = (session: any) => {
    const uiStore = useUIStore()
    const convStore = useConversationStore()
    isAudioOnly.value = session.audioOnly

    // 尝试从会话信息获取对方名称
    const name = convStore.conversations.find(
      c => c.conversationInfo.target === session.clientId
    )?.name || session.clientId
    callDisplayName.value = name
    callRemoteImg.value = ''

    // 设置当前会话的 sessionCallback
    session.sessionCallback = sessionCb

    if (session.audioOnly) {
      uiStore.showAudioBox = true
    } else {
      uiStore.showChatBox = true
    }
  }
  engineCb.shouldStartRing = (_isIncoming: boolean) => {}
  engineCb.shouldSopRing = () => {}

  // ── SessionCallback 实现 ──────────────────────
  const sessionCb = new SessionCallback()
  sessionCb.didChangeState = (state: number) => {
    callState.value = state
    if (state === CallState.STATUS_IDLE) {
      const uiStore = useUIStore()
      uiStore.showAudioBox = false
      uiStore.showChatBox = false
    }
  }
  // 只有本端没参与的结束方式才提示；本端自己挂断/拒接时用户清楚发生了什么。
  const CALL_END_TIPS: Record<string, string> = {
    [CallEndReason.REASON_AcceptByOtherClient]: '已在其他设备接听',
    [CallEndReason.REASON_RejectByOtherClient]: '已在其他设备挂断',
  }

  function handleCallEnd(reason: string) {
    callState.value = CallState.STATUS_IDLE
    const uiStore = useUIStore()
    uiStore.showAudioBox = false
    uiStore.showChatBox = false
    callEndTip.value = CALL_END_TIPS[reason] ?? ''
  }

  function clearCallEndTip() {
    callEndTip.value = ''
  }

  sessionCb.didCallEndWithReason = handleCallEnd
  sessionCb.didCreateLocalVideoTrack = (stream: MediaStream) => {
    setTimeout(() => {
      const el = document.getElementById('wxCallLocalVideo') as HTMLVideoElement | null
      if (el) { el.srcObject = stream; el.play().catch(() => {}) }
    }, 100)
  }
  sessionCb.didReceiveRemoteVideoTrack = (stream: MediaStream) => {
    setTimeout(() => {
      const el = document.getElementById('wxCallRemoteVideo') as HTMLVideoElement | null
      if (el) { el.srcObject = stream; el.play().catch(() => {}) }
    }, 100)
  }
  sessionCb.didReceiveRemoteAudioTrack = (stream: MediaStream) => {
    setTimeout(() => {
      const el = document.getElementById('wxCallRemoteAudio') as HTMLAudioElement | null
      if (el) { el.srcObject = stream; el.play().catch(() => {}) }
    }, 100)
  }

  client.setCurrentEngineCallback(engineCb)
  client.setCurrentSessionCallback(sessionCb)

  // ── 外部调用方法 ─────────────────────────────
  function startCall(target: string, audioOnly: boolean) {
    isAudioOnly.value = audioOnly
    const uiStore = useUIStore()
    const convStore = useConversationStore()
    const name = convStore.conversations.find(
      c => c.conversationInfo.target === target
    )?.name || target
    callDisplayName.value = name
    callRemoteImg.value = ''

    // 先绑定 sessionCallback
    client.setCurrentSessionCallback(sessionCb)
    client.setCurrentEngineCallback(engineCb)
    client.startCall(target, audioOnly)
    callState.value = CallState.STATUS_OUTGOING

    if (audioOnly) uiStore.showAudioBox = true
    else uiStore.showChatBox = true
  }

  function answerCall() {
    client.setCurrentSessionCallback(sessionCb)
    client.answerCall(isAudioOnly.value)
    callState.value = CallState.STATUS_CONNECTING
  }

  function cancelCall() {
    client.cancelCall()
    callState.value = CallState.STATUS_IDLE
    const uiStore = useUIStore()
    uiStore.showAudioBox = false
    uiStore.showChatBox = false
  }

  const isOutgoing = computed(() => callState.value === CallState.STATUS_OUTGOING)
  const isIncoming = computed(() => callState.value === CallState.STATUS_INCOMING)
  const isConnected = computed(() => callState.value === CallState.STATUS_CONNECTED)
  const isConnecting = computed(() => callState.value === CallState.STATUS_CONNECTING)

  return {
    callState, callDisplayName, callRemoteImg, isAudioOnly, callEndTip,
    isOutgoing, isIncoming, isConnected, isConnecting,
    startCall, answerCall, cancelCall, handleCallEnd, clearCallEndTip,
  }
})
