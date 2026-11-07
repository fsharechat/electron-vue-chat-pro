import webSocketClient from '@/websocket/websocketcli'
import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'
import { useMessageStore } from '@/stores/useMessageStore'
import SendMessageHandler from '@/websocket/handler/sendMessageHandler'
import { useAuthStore } from '@/stores/useAuthStore'
import LocalStore from '@/websocket/store/localstore'
import ConnectAckHandler from '@/websocket/handler/connectackhandler'
import NotifyMessageHandler from '@/websocket/handler/notifyMessageHandler'
import ReceiveMessageHandler from '@/websocket/handler/receiveMessageHandler'

vi.mock('benz-amr-recorder', () => ({ default: vi.fn() }))
vi.mock('@wcjiang/notify', () => ({ default: vi.fn() }))
let dispatch: (action: string, data?: any) => void
vi.mock('@/websocket/index', () => ({ default: class {
  constructor(_error: any, dispatcher: any) { dispatch = dispatcher }
  getUserInfos() {}
  getGroupInfo() {}
  uploadDeliveryReport() {}
} }))

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
  useAuthStore().initData(() => {})
  LocalStore.setLastMessageSeq('100')
})
const handlers: ReceiveMessageHandler[] = []
function receiver(socket = ws()) {
  const handler = new ReceiveMessageHandler(socket)
  handlers.push(handler)
  return handler
}
afterEach(() => {
  for (const handler of handlers.splice(0)) handler.destroy()
  vi.useRealTimers()
  vi.restoreAllMocks()
})
function ws() {
  return { getFriend: vi.fn(), getFriendRequest: vi.fn(), getUserSettings: vi.fn(),
    pullMessage: vi.fn(), sendAction: (action: string, data: any) => dispatch(action, data) }
}
function ack(head = '200', current = head, messages: any[] = []) {
  return { content: JSON.stringify({ head, current, messageCount: messages.length, messageResponseList: messages }) }
}
const rawMessage = { messageId: '1000', localMessageId: 'local-1', from: 'peer', target: 'me',
  conversationType: 0, line: 0, timestamp: 1, content: { type: 1, searchableContent: 'new message' } }

it('CONNECT_ACK 丢应答再重连，保留已确认游标和发送计数偏移', () => {
  LocalStore.updateSendMessageCount()
  const socket = ws()
  const handler = new ConnectAckHandler(socket)
  handler.processMessage({ content: JSON.stringify({ messageHead: '200' }) })
  handler.processMessage({ content: JSON.stringify({ messageHead: '200' }) })
  expect(LocalStore.getLastMessageSeq()).toBe('100')
  expect(socket.pullMessage).toHaveBeenLastCalledWith('100', 0, 0, '1')
})
it('MN 不提前推进游标或清除发送计数', () => {
  LocalStore.updateSendMessageCount()
  new NotifyMessageHandler(ws()).processMessage({ content: JSON.stringify({ messageHead: '200', type: 0 }) })
  expect(LocalStore.getLastMessageSeq()).toBe('100')
  expect(Number(LocalStore.getSendMessageCount())).toBe(1)
})
it('MP 消息及会话同步保存成功后才提交游标（不等待 Vue watch）', () => {
  const original = LocalStore.setLastMessageSeq
  const commit = vi.spyOn(LocalStore, 'setLastMessageSeq').mockImplementation(seq => {
    expect(LocalStore.getMessages()?.[0].protoMessages[0].content.searchableContent).toBe('new message')
    expect(LocalStore.getConversations()?.[0].conversationInfo.lastMessage.content.searchableContent).toBe('new message')
    original(seq)
  })
  receiver().processMessage(ack('200', '200', [rawMessage]))
  expect(commit).toHaveBeenCalledWith('200')
  expect(LocalStore.getLastMessageSeq()).toBe('200')
})
it('空 MP 已追到最新时也提交进度', () => {
  receiver().processMessage(ack())
  expect(LocalStore.getLastMessageSeq()).toBe('200')
})
it.each(['saveMessages', 'saveConverSations'] as const)('%s 失败保留游标与发送计数，重试成功后提交', async method => {
  vi.useFakeTimers()
  LocalStore.updateSendMessageCount()
  vi.spyOn(LocalStore, method).mockImplementationOnce(() => { throw new Error('storage full') })
  const done = receiver().processMessage(ack())
  await vi.advanceTimersByTimeAsync(0)
  expect(LocalStore.getLastMessageSeq()).toBe('100')
  expect(Number(LocalStore.getSendMessageCount())).toBe(1)
  await vi.advanceTimersByTimeAsync(1000)
  await done
  expect(LocalStore.getLastMessageSeq()).toBe('200')
})
it('消息处理异常不提交游标', () => {
  const socket = ws()
  socket.sendAction = (action, data) => {
    if (action === 'addProtoMessage') throw new Error('message failed')
    dispatch(action, data)
  }
  receiver(socket).processMessage(ack('200', '200', [rawMessage]))
  expect(LocalStore.getLastMessageSeq()).toBe('100')
})
it.each([['0', '0'], ['200', '150'], ['99', '99']])('head=%s current=%s 不提交或回退游标', (head, current) => {
  receiver().processMessage(ack(head, current))
  expect(LocalStore.getLastMessageSeq()).toBe('100')
})
it('64 位游标比较不丢精度', () => {
  LocalStore.setLastMessageSeq('9007199254740992')
  receiver().processMessage(ack('9007199254740993'))
  expect(LocalStore.getLastMessageSeq()).toBe('9007199254740993')
})

function sendAck(id = 'local-1', content = JSON.stringify({ messageId: '1000' })) {
  const socket = { ...ws(), resolvePromiseMap: new Map([[1, { protoMessageId: id, resolve: vi.fn() }]]) }
  const handler = new SendMessageHandler(socket)
  return { socket, handler, proto: { messageId: 1, content } }
}
it('发送成功只增加发送计数，重复 ACK 不重复计数', () => {
  useMessageStore().preAddProtoMessage({ ...rawMessage, messageId: 'local-1', messageUid: '0', direction: 0 } as any)
  const { handler, proto } = sendAck()
  handler.processMessage(proto)
  expect(LocalStore.getLastMessageSeq()).toBe('100')
  expect(Number(LocalStore.getSendMessageCount())).toBe(1)
  expect(useMessageStore().messages[0].protoMessages[0].messageUid).toBe('1000')
  handler.processMessage(proto)
  expect(Number(LocalStore.getSendMessageCount())).toBe(1)
})
it('发送失败不增加发送计数或游标', () => {
  const { handler, proto } = sendAck('local-1', '')
  handler.processMessage(proto)
  expect(LocalStore.getLastMessageSeq()).toBe('100')
  expect(Number(LocalStore.getSendMessageCount())).toBe(0)
})
it('MP 成功落盘后更新游标并重置发送计数', () => {
  LocalStore.updateSendMessageCount()
  receiver().processMessage(ack())
  expect(LocalStore.getLastMessageSeq()).toBe('200')
  expect(Number(LocalStore.getSendMessageCount())).toBe(0)
})

function tailAck(head = '200') {
  return { content: JSON.stringify({ head, current: head, messageCount: 0, messageResponseList: [],
    gapList: [{ conversation: { target: 'peer', conversationType: 0, line: 0 }, beforeUid: '9223372036854775807' }] }) }
}
it('尾部补拉完成前不提交游标，也不处理后续 MP；成功后保存补齐的消息', async () => {
  let finish!: (value: any) => void
  vi.spyOn(webSocketClient, 'getRemoteMessages').mockReturnValue(new Promise(resolve => { finish = resolve }))
  useMessageStore().hydrateMessages([{ target: 'peer', name: '', protoMessages: [{ ...rawMessage, messageUid: '1000' }] }] as any)
  const handler = receiver()
  const first = handler.processMessage(tailAck())
  const second = handler.processMessage(ack('201'))
  expect(LocalStore.getLastMessageSeq()).toBe('100')
  finish({ result: JSON.stringify({ messageResponseList: [rawMessage] }) })
  await first
  await second
  expect(LocalStore.getMessages()?.[0].protoMessages[0].messageUid).toBe('1000')
  expect(LocalStore.getLastMessageSeq()).toBe('201')
})
it('空缓存或没有缓存的尾部会话也必须补拉', async () => {
  const fetch = vi.spyOn(webSocketClient, 'getRemoteMessages').mockResolvedValue({ result: JSON.stringify({ messageResponseList: [rawMessage] }) })
  await receiver().processMessage(tailAck())
  expect(fetch).toHaveBeenCalledOnce()
  expect(LocalStore.getMessages()?.[0].protoMessages[0].messageUid).toBe('1000')
})
it('尾部补拉失败会重试原任务，成功前不放行后续 MP', async () => {
  vi.useFakeTimers()
  const fetch = vi.spyOn(webSocketClient, 'getRemoteMessages')
    .mockResolvedValueOnce({ result: null })
    .mockResolvedValue({ result: JSON.stringify({ messageResponseList: [rawMessage] }) })
  const handler = receiver()
  const first = handler.processMessage(tailAck())
  const second = handler.processMessage(ack('201'))
  await vi.advanceTimersByTimeAsync(0)
  expect(LocalStore.getLastMessageSeq()).toBe('100')
  await vi.advanceTimersByTimeAsync(1000)
  await first
  await second
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(LocalStore.getLastMessageSeq()).toBe('201')
  expect(LocalStore.getMessages()?.[0].protoMessages[0].messageUid).toBe('1000')
  vi.useRealTimers()
})

it('尾部补拉失败清空缓存后，再次重试仍会补拉', async () => {
  vi.useFakeTimers()
  useMessageStore().hydrateMessages([{ target: 'peer', name: '', protoMessages: [{ ...rawMessage, messageUid: '1000' }] }] as any)
  const fetch = vi.spyOn(webSocketClient, 'getRemoteMessages')
    .mockResolvedValueOnce({ result: null })
    .mockResolvedValue({ result: JSON.stringify({ messageResponseList: [rawMessage] }) })
  const done = receiver().processMessage(tailAck())
  await vi.advanceTimersByTimeAsync(0)
  expect(useMessageStore().messages[0].protoMessages).toHaveLength(0)
  expect(LocalStore.getLastMessageSeq()).toBe('100')
  await vi.advanceTimersByTimeAsync(1000)
  await done
  expect(fetch).toHaveBeenCalledTimes(2)
  expect(LocalStore.getMessages()?.[0].protoMessages).toHaveLength(1)
})
it('尾部补拉成功返回空列表可以提交游标', async () => {
  vi.spyOn(webSocketClient, 'getRemoteMessages').mockResolvedValue({ result: JSON.stringify({ messageResponseList: [] }) })
  await receiver().processMessage(tailAck())
  expect(LocalStore.getLastMessageSeq()).toBe('200')
})
it('尾部补拉响应无效不能提交，销毁后不再重试', async () => {
  vi.useFakeTimers()
  const fetch = vi.spyOn(webSocketClient, 'getRemoteMessages').mockResolvedValue({ result: '{}' })
  const handler = receiver()
  const done = handler.processMessage(tailAck())
  await vi.advanceTimersByTimeAsync(0)
  expect(LocalStore.getLastMessageSeq()).toBe('100')
  handler.destroy()
  expect(await done).toBe(false)
  await vi.advanceTimersByTimeAsync(60000)
  expect(fetch).toHaveBeenCalledOnce()
})
it('销毁时取消队列，迟到的尾部补拉不能写入新账号缓存', async () => {
  let finish!: (value: any) => void
  vi.spyOn(webSocketClient, 'getRemoteMessages').mockReturnValue(new Promise(resolve => { finish = resolve }))
  const handler = receiver()
  const first = handler.processMessage(tailAck())
  const second = handler.processMessage(ack('201'))
  handler.destroy()
  useMessageStore().reset()
  LocalStore.clearLocalStore()
  LocalStore.setLastMessageSeq('50')
  finish({ result: JSON.stringify({ messageResponseList: [rawMessage] }) })
  expect(await first).toBe(false)
  expect(await second).toBe(false)
  await Promise.resolve()
  expect(useMessageStore().messages).toHaveLength(0)
  expect(LocalStore.getLastMessageSeq()).toBe('50')
})
it('同步等待重试期间，透明消息仍立即处理且不改变游标', async () => {
  vi.useFakeTimers()
  vi.spyOn(webSocketClient, 'getRemoteMessages').mockResolvedValue({ result: null })
  const socket = ws()
  const original = socket.sendAction
  socket.sendAction = vi.fn(original)
  const handler = receiver(socket)
  handler.processMessage(tailAck())
  await vi.advanceTimersByTimeAsync(0)
  vi.mocked(socket.sendAction).mockClear()
  await handler.processMessage(ack('0', '0', [rawMessage]))
  expect(socket.sendAction).toHaveBeenCalledWith('addProtoMessage', expect.objectContaining({ messageUid: '1000' }))
  expect(socket.sendAction).not.toHaveBeenCalledWith('changetFirstLogin', false)
  expect(LocalStore.getLastMessageSeq()).toBe('100')
})
