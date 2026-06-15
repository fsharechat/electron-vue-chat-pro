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
  sessionCb.didCallEndWithReason = (_reason: number) => {
    callState.value = CallState.STATUS_IDLE
    const uiStore = useUIStore()
    uiStore.showAudioBox = false
    uiStore.showChatBox = false
  }
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
    callState, callDisplayName, callRemoteImg, isAudioOnly,
    isOutgoing, isIncoming, isConnected, isConnecting,
    startCall, answerCall, cancelCall,
  }
})
