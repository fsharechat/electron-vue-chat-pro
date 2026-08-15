import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PUB_ACK, UG } from '@/constant'

// index.ts -> handler -> message/message.ts -> useConversationStore -> useAuthStore -> useUIStore
// 这条链最终会静态引入 benz-amr-recorder，jsdom 下没有 createObjectURL 会直接抛错；
// 与 SavedGroupList.test.ts / useAuthStore.test.ts 保持一致的 mock 方式
vi.mock('benz-amr-recorder', () => ({ default: vi.fn() }))

/**
 * VueWebSocket 构造函数里会 `new WebSocket(this.url)`，jsdom 默认没有这个全局构造器，
 * 这里用一个最小可用的假实现顶上——只需要能被 new、记录 close() 是否被调用即可，
 * 不需要真的模拟握手/收发。
 */
class FakeWebSocket {
  static instances: FakeWebSocket[] = []
  url: string
  readyState = 0
  onopen: any = null
  onmessage: any = null
  onclose: any = null
  onerror: any = null
  closeCalls = 0
  constructor(url: string) {
    this.url = url
    FakeWebSocket.instances.push(this)
  }
  close() {
    this.closeCalls++
    this.readyState = 3
  }
  send() {}
}
// VueWebSocket 类定义本身不在模块顶层调用 `new WebSocket(...)`（只在 connect() 方法体内，
// 运行到 `new VueWebSocket(...)` 时才会用到），所以这里按普通 import 拿到类、随后再挂载假
// 实现到 globalThis 即可，不需要动态 import 来保证顺序
import VueWebSocket from '@/websocket/index'
;(globalThis as any).WebSocket = FakeWebSocket as unknown as typeof WebSocket

function ugAckPayload(entries: unknown[]) {
  return JSON.stringify({
    signal: PUB_ACK,
    subSignal: UG,
    messageId: 1,
    content: JSON.stringify(entries)
  })
}

describe('VueWebSocket.destroy：登出时摘掉旧连接的 handler', () => {
  beforeEach(() => {
    FakeWebSocket.instances.length = 0
  })

  it('destroy() 之后，旧连接迟到的 UG 应答不会再被派发进 store（删掉 destroy() 里清空 handlerList/storeDispatcher 这两行，这个用例会红）', () => {
    const dispatcher = vi.fn()
    const errorHandler = vi.fn()
    const ws = new VueWebSocket(errorHandler, dispatcher) as any
    const fakeSocket = FakeWebSocket.instances[FakeWebSocket.instances.length - 1]

    // 先证明测试基础设施本身是对的：destroy() 之前，UserSettingResultHandler 真的会把
    // UG 应答派发进 store —— 这正是 useAuthStore.loginOut 描述的失败场景里，迟到应答走的那条路径
    const ugAck = ugAckPayload([{ scope: 1, key: 'k', value: '1', updateDt: 1 }])
    ws.processMessage(ugAck)
    expect(dispatcher).toHaveBeenCalledWith('applyUserSettings', [{ scope: 1, key: 'k', value: '1', updateDt: 1 }])
    dispatcher.mockClear()

    ws.destroy()

    // 真的把底层 socket 关掉了（生产环境下 close() 之后规范上不会再触发 onmessage）
    expect(fakeSocket.closeCalls).toBe(1)
    // 双保险：handlerList 清空、storeDispatcher 换成空函数
    expect(ws.handlerList).toHaveLength(0)
    // destroy() 内部 disconnect() 会先经过（尚未被替换的）storeDispatcher 派发一次
    // setOnlineStatus，这次调用是预期之内的，清掉它以便下面专注断言"迟到的 UG 应答"
    dispatcher.mockClear()

    // 模拟登出后那个 RTT 窗口期里，旧连接仍然把迟到的 UG 应答喂给 processMessage
    // （不管是因为某些环境下 close() 没能立刻掐断 onmessage，还是其他代码路径直接调用了它）
    ws.processMessage(ugAck)

    expect(dispatcher).not.toHaveBeenCalled()
  })

  it('destroy() 不向用户弹"网络断开"提示，而系统唤醒后的重连仍然弹（把 destroy() 里的 disconnect(false) 改回 disconnect()，这个用例会红）', () => {
    const dispatcher = vi.fn()
    const errorHandler = vi.fn()

    // 登出：用户自己发起的，不该看到错误提示
    const loggingOut = new VueWebSocket(errorHandler, dispatcher) as any
    loggingOut.destroy()
    expect(errorHandler).not.toHaveBeenCalled()

    // 意外断开（ping 检测到系统唤醒后走的那条路径）：提示要保留
    const waking = new VueWebSocket(errorHandler, dispatcher) as any
    waking.disconnect()
    expect(errorHandler).toHaveBeenCalledWith(true, '网络断开，飞享服务链接关闭')
  })

  it('destroy() 之后 sendAction 也不会再触达构造时传入的 storeDispatcher（防止有代码绕过 handlerList 直接调用）', () => {
    const dispatcher = vi.fn()
    const errorHandler = vi.fn()
    const ws = new VueWebSocket(errorHandler, dispatcher) as any

    ws.destroy()
    dispatcher.mockClear()

    ws.sendAction('applyUserSettings', [{ scope: 1, key: 'k', value: '1', updateDt: 1 }])

    expect(dispatcher).not.toHaveBeenCalled()
  })
})
