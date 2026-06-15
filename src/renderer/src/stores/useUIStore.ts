import { ref, computed, watch } from 'vue'
import BenzAMRRecorder from 'benz-amr-recorder'
import { defineStore } from 'pinia'
import type { StateMessageReport, ProtoMessage } from '@/types'
import { useConversationStore } from './useConversationStore'
import { useGroupStore } from './useGroupStore'
import { useAuthStore } from './useAuthStore'
import { useFriendStore } from './useFriendStore'
import LocalStore from '@/websocket/store/localstore'

export const useUIStore = defineStore('ui', () => {
  const onlineStatus = ref(false)
  const firstLogin = ref(false)
  const appHeight = ref(638)
  const visibilityState = ref('visible')
  const showChatBox = ref(false)
  const showAudioBox = ref(false)
  const showSearchFriendDialog = ref(false)
  const showCreateGroupDialog = ref(false)
  const showRelayMessageDialog = ref(false)
  const showGroupCallVideoDialog = ref(false)
  const showGroupInfo = ref(false)
  const showMessageRightMenu = ref<any[]>([])
  const currentRightMenuMessage = ref<ProtoMessage | null>(null)
  const waitUserIds = ref<string[]>([])
  const emptyMessage = ref(false)
  const isWinMaxed = ref(false)
  const stateMessageReports = ref<StateMessageReport[]>([])
  const groupCallMembers = ref<any[]>([])
  const userInfoList = ref<any[]>([])
  const emojis = ref([
    { file: '100.gif', code: '/::)', title: '微笑', reg: /\/::\)/g },
    { file: '101.gif', code: '/::~', title: '伤心', reg: /\/::~/g },
    { file: '102.gif', code: '/::B', title: '美女', reg: /\/::B/g },
    { file: '103.gif', code: '/::|', title: '发呆', reg: /\/::\|/g },
    { file: '104.gif', code: '/:8-)', title: '墨镜', reg: /\/:8-\)/g },
    { file: '105.gif', code: '/::<', title: '哭', reg: /\/::</g },
    { file: '106.gif', code: '/::$', title: '羞', reg: /\/::\$/g },
    { file: '107.gif', code: '/::X', title: '哑', reg: /\/::X/g },
    { file: '108.gif', code: '/::Z', title: '睡', reg: /\/::Z/g },
    { file: '109.gif', code: '/::\'(', title: '哭', reg: /\/::'\(/g },
    { file: '110.gif', code: '/::-|', title: '囧', reg: /\/::-\|/g },
    { file: '111.gif', code: '/::@', title: '怒', reg: /\/::@/g },
    { file: '112.gif', code: '/::P', title: '调皮', reg: /\/::P/g },
    { file: '113.gif', code: '/::D', title: '笑', reg: /\/::D/g },
    { file: '114.gif', code: '/::O', title: '惊讶', reg: /\/::O/g },
    { file: '115.gif', code: '/::(', title: '难过', reg: /\/::\(/g },
    { file: '116.gif', code: '/::+', title: '酷', reg: /\/::\+/g },
    { file: '117.gif', code: '/:--b', title: '汗', reg: /\/:--b/g },
    { file: '118.gif', code: '/::Q', title: '抓狂', reg: /\/::Q/g },
    { file: '119.gif', code: '/::T', title: '吐', reg: /\/::T/g },
    { file: '120.gif', code: '/:,@P', title: '笑', reg: /\/:,@P/g },
    { file: '121.gif', code: '/:,@-D', title: '快乐', reg: /\/:,@-D/g },
    { file: '122.gif', code: '/::d', title: '奇', reg: /\/::d/g },
    { file: '123.gif', code: '/:,@o', title: '傲', reg: /\/:,@o/g },
    { file: '124.gif', code: '/::g', title: '饿', reg: /\/::g/g },
    { file: '125.gif', code: '/:|-)' , title: '累', reg: /\/:\|-\)/g },
    { file: '126.gif', code: '/::!', title: '吓', reg: /\/::!/g },
    { file: '127.gif', code: '/::L', title: '汗', reg: /\/::L/g },
    { file: '128.gif', code: '/::>', title: '高兴', reg: /\/::>/g },
    { file: '129.gif', code: '/::,@', title: '闲', reg: /\/::,@/g },
    { file: '130.gif', code: '/:,@f', title: '努力', reg: /\/:,@f/g },
    { file: '131.gif', code: '/::-S', title: '骂', reg: /\/::-S/g },
    { file: '133.gif', code: '/:,@x', title: '秘密', reg: /\/:,@x/g },
    { file: '134.gif', code: '/:,@@', title: '乱', reg: /\/:,@@/g },
    { file: '135.gif', code: '/::8', title: '疯', reg: /\/::8/g },
    { file: '136.gif', code: '/:,@!', title: '哀', reg: /\/:,@!/g },
    { file: '137.gif', code: '/:!!!', title: '鬼', reg: /\/:!!!/g },
    { file: '138.gif', code: '/:xx', title: '打击', reg: /\/:xx/g },
    { file: '139.gif', code: '/:bye', title: 'bye', reg: /\/:bye/g },
    { file: '142.gif', code: '/:handclap', title: '鼓掌', reg: /\/:handclap/g },
    { file: '145.gif', code: '/:<@', title: '什么', reg: /\/:<@/g },
    { file: '147.gif', code: '/::-O', title: '累', reg: /\/::-O/g },
    { file: '153.gif', code: '/:@x', title: '吓', reg: /\/:@x/g },
    { file: '155.gif', code: '/:pd', title: '刀', reg: /\/:pd/g },
    { file: '156.gif', code: '/:<W>', title: '水果', reg: /\/:<W>/g },
    { file: '157.gif', code: '/:beer', title: '酒', reg: /\/:beer/g },
    { file: '158.gif', code: '/:basketb', title: '篮球', reg: /\/:basketb/g },
    { file: '159.gif', code: '/:oo', title: '乒乓', reg: /\/:oo/g },
    { file: '195.gif', code: '/:circle', title: '跳舞', reg: /\/:circle/g },
    { file: '160.gif', code: '/:coffee', title: '咖啡', reg: /\/:coffee/g },
  ])
  const minuteTick = ref(0)
  setInterval(() => { minuteTick.value++ }, 60 * 1000)

  let _vueSocket: any = null
  let _notify: any = null
  let _inCommingNotify: any = null
  let _outGoingNotify: any = null

  const unreadTotalCount = computed(() => {
    const convStore = useConversationStore()
    let total = 0
    for (const sc of convStore.conversations) {
      total += sc.conversationInfo.unreadCount?.unread ?? 0
    }
    if (total === 0) {
      _notify?.faviconClear?.()
      _notify?.setTitle?.()
    } else {
      _notify?.setFavicon?.(total)
      _notify?.setTitle?.('你有新的消息未读')
    }
    return total
  })

  async function initNotify() {
    try {
      const Notify = (await import('@wcjiang/notify')).default
      _notify = new Notify({ effect: 'flash', interval: 500, audio: { file: ['audio/notify.mp3'] } })
      _inCommingNotify = new Notify({ audio: { file: ['audio/incoming_call_ring.mp3'] } })
      _outGoingNotify = new Notify({ audio: { file: ['audio/outgoing_call_ring.mp3'] } })
    } catch (e) {
      console.warn('Notify init failed', e)
    }
  }

  const currentAudioMessageId = ref('')
  let _amrInstance: any = null

  function playAudio(url: string, messageId: string, onEnded: () => void) {
    stopAudio()
    try {
      _amrInstance = new BenzAMRRecorder()
      _amrInstance.initWithUrl(url).then(() => {
        _amrInstance.play()
        currentAudioMessageId.value = messageId
      })
      _amrInstance.onEnded(() => { _amrInstance = null; currentAudioMessageId.value = ''; onEnded() })
    } catch (e) { console.warn('Audio playback error', e) }
  }

  function stopAudio() {
    try { _amrInstance?.stop() } catch {}
    _amrInstance = null
    currentAudioMessageId.value = ''
  }

  function setVueSocket(ws: any) { _vueSocket = ws }
  function setOnlineStatus(status: boolean) { onlineStatus.value = status }
  function setFirstLogin(val: boolean) { firstLogin.value = val }
  function visibilityChange(state: string) { visibilityState.value = state }
  function playMsgNotify() { try { _notify?.player?.() } catch (e) {} }

  function updateUserInfos(infos: any[]) {
    const authStore = useAuthStore()
    const convStore = useConversationStore()
    const friendStore = useFriendStore()
    for (const info of infos) {
      if (info.uid === authStore.userId) {
        authStore.user.img = info.portrait
        authStore.user.name = info.displayName
      }
      const idx = userInfoList.value.findIndex((u: any) => u.uid === info.uid)
      if (idx !== -1) userInfoList.value.splice(idx, 1, info)
      else userInfoList.value.push(info)
      // 同步到好友列表，确保好友详情页展示最新数据
      const friend = friendStore.friendlist.find(f => f.wxid === info.uid)
      if (friend) {
        if (info.displayName) friend.nickname = info.displayName
        if (info.portrait) friend.img = info.portrait
        if (info.mobile !== undefined) friend.mobile = info.mobile
        if (info.email !== undefined) friend.email = info.email
      }
    }
    // Apply name/portrait to single conversations that match
    for (const sc of convStore.conversations) {
      if (sc.conversationInfo.conversationType !== 0) continue
      const user = infos.find((u: any) => u.uid === sc.conversationInfo.target)
      if (user) {
        sc.name = user.displayName
        if (user.portrait) sc.img = user.portrait
      }
    }
  }

  function addMessageReport(report: any) {
    let sr = stateMessageReports.value.find(r => r.target === report.target)
    if (!sr) {
      sr = { target: report.target, messageReports: [] }
      stateMessageReports.value.push(sr)
    }
    const existing = sr.messageReports.find(r =>
      r.reportType === report.reportType && r.uid === report.uid && r.target === report.target
    )
    if (existing) existing.date = report.date
    else sr.messageReports.push(report)
  }

  function uploadReport(protoMessage: ProtoMessage, vueSocket: any) {
    if (protoMessage.direction !== 1) return
    const convStore = useConversationStore()
    const groupStore = useGroupStore()

    if (protoMessage.conversationType === 0) {
      vueSocket?.uploadDeliveryReport(Date.now(), protoMessage.target)
    }
    if (convStore.selectTarget === protoMessage.target && visibilityState.value === 'visible') {
      const tos = protoMessage.conversationType === 1
        ? groupStore.groupSendMessageUserMap.get(protoMessage.target)
        : undefined
      vueSocket?.uploadReadReport(Date.now(), protoMessage.target, protoMessage.conversationType, tos)
    }
  }

  function reset() {
    userInfoList.value = []
    stateMessageReports.value = []
    onlineStatus.value = false
    showChatBox.value = false
    showGroupInfo.value = false
  }

  watch(userInfoList, val => LocalStore.saveUserInfoList(val), { deep: true })
  watch(stateMessageReports, val => LocalStore.setMessageReports(val), { deep: true })

  return {
    onlineStatus, firstLogin, appHeight, visibilityState,
    showChatBox, showAudioBox, showSearchFriendDialog, showCreateGroupDialog,
    showRelayMessageDialog, showGroupCallVideoDialog, showGroupInfo,
    showMessageRightMenu, currentRightMenuMessage, waitUserIds,
    emptyMessage, isWinMaxed, stateMessageReports, groupCallMembers,
    minuteTick, userInfoList, emojis, unreadTotalCount,
    currentAudioMessageId,
    initNotify, setVueSocket, setOnlineStatus, setFirstLogin, visibilityChange,
    updateUserInfos, addMessageReport, uploadReport, playMsgNotify,
    playAudio, stopAudio, reset,
  }
})
