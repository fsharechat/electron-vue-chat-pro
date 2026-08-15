import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// useCallStore -> useUIStore -> benz-amr-recorder，jsdom 里跑不起来，同其余 store 测试
vi.mock('benz-amr-recorder', () => ({ default: vi.fn() }))

import { useCallStore } from '@/stores/useCallStore'
import { useUIStore } from '@/stores/useUIStore'
import CallEndReason from '@/webrtc/callEndReason'
import CallState from '@/webrtc/callState'

/**
 * 多端同步的可见反馈：406 让本端静默关掉来电界面后，用户需要知道这通电话
 * 去哪了。handleCallEnd 是 VoipClient 结束会话时的唯一入口（作为
 * sessionCallback.didCallEndWithReason 挂上去），这里直接驱动它。
 */
describe('useCallStore 通话结束提示', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('其他设备接听时给出「已在其他设备接听」', () => {
    const callStore = useCallStore()
    callStore.handleCallEnd(CallEndReason.REASON_AcceptByOtherClient)
    expect(callStore.callEndTip).toBe('已在其他设备接听')
  })

  it('其他设备拒接时给出「已在其他设备挂断」', () => {
    const callStore = useCallStore()
    callStore.handleCallEnd(CallEndReason.REASON_RejectByOtherClient)
    expect(callStore.callEndTip).toBe('已在其他设备挂断')
  })

  it('本端自己挂断不提示 —— 用户知道自己做了什么', () => {
    const callStore = useCallStore()
    callStore.handleCallEnd(CallEndReason.REASON_Hangup)
    expect(callStore.callEndTip).toBe('')
  })

  it('提示消费后清空，同一文案再次到达仍能触发', () => {
    const callStore = useCallStore()
    callStore.handleCallEnd(CallEndReason.REASON_AcceptByOtherClient)
    callStore.clearCallEndTip()
    expect(callStore.callEndTip).toBe('')
    callStore.handleCallEnd(CallEndReason.REASON_AcceptByOtherClient)
    expect(callStore.callEndTip).toBe('已在其他设备接听')
  })

  it('仍然关闭通话界面并回到 IDLE', () => {
    const callStore = useCallStore()
    const uiStore = useUIStore()
    uiStore.showAudioBox = true
    uiStore.showChatBox = true
    callStore.handleCallEnd(CallEndReason.REASON_AcceptByOtherClient)
    expect(uiStore.showAudioBox).toBe(false)
    expect(uiStore.showChatBox).toBe(false)
    expect(callStore.callState).toBe(CallState.STATUS_IDLE)
  })
})
