import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { h, nextTick } from 'vue'
import ChatVirtualList from './ChatVirtualList.vue'

// jsdom 无布局引擎:stub ResizeObserver,手动设置 clientHeight/scrollHeight。
// 保留构造时传入的回调,以便测试主动喂入 entries,驱动补偿/钉底逻辑。
let roCallback: ((entries: any[]) => void) | null = null
class ROStub {
  constructor(cb: (entries: any[]) => void) {
    roCallback = cb
  }
  observe() {}
  unobserve() {}
  disconnect() {}
}
beforeEach(() => {
  roCallback = null
  vi.stubGlobal('ResizeObserver', ROStub)
})

function makeItems(n: number) {
  return Array.from({ length: n }, (_, i) => ({ messageId: `m${i}` }))
}

function mountList(n = 200) {
  const wrapper = mount(ChatVirtualList, {
    props: { items: makeItems(n), estimate: 100, overscan: 0 },
    slots: {
      default: ({ item, index, prev }: any) =>
        h('div', { class: 'row', 'data-idx': index, 'data-prev': prev?.messageId ?? '' }, item.messageId)
    }
  })
  const el = wrapper.element as HTMLElement
  Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true })
  Object.defineProperty(el, 'scrollHeight', { value: 100 * n, configurable: true })
  return { wrapper, el }
}

describe('ChatVirtualList 渲染窗口', () => {
  it('只渲染视口附近的项,而非全部', async () => {
    const { wrapper, el } = mountList(200)
    el.dispatchEvent(new Event('scroll')) // 触发读取 clientHeight
    await nextTick()
    const rows = wrapper.findAll('.row')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(30) // 200 项只渲染视口窗口
  })

  it('滚动后窗口移动,且 index/prev 对应原数组', async () => {
    const { wrapper, el } = mountList(200)
    el.scrollTop = 5000
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    const first = wrapper.find('.row')
    expect(first.text()).toBe('m50') // 5000/100
    expect(first.attributes('data-idx')).toBe('50')
    expect(first.attributes('data-prev')).toBe('m49')
  })

  it('空列表不渲染任何项', async () => {
    const wrapper = mount(ChatVirtualList, {
      props: { items: [] },
      slots: { default: ({ item }: any) => h('div', { class: 'row' }, item.messageId) }
    })
    await nextTick()
    expect(wrapper.findAll('.row')).toHaveLength(0)
  })
})

describe('ChatVirtualList ResizeObserver 联动', () => {
  it('视口上方项变高时补偿 scrollTop', async () => {
    const wrapper = mount(ChatVirtualList, {
      props: { items: makeItems(100), estimate: 100, overscan: 300 },
      slots: {
        default: ({ item, index, prev }: any) =>
          h('div', { class: 'row', 'data-idx': index, 'data-prev': prev?.messageId ?? '' }, item.messageId)
      }
    })
    const el = wrapper.element as HTMLElement
    Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(el, 'scrollHeight', { value: 100 * 100, configurable: true })
    el.scrollTop = 5000
    el.dispatchEvent(new Event('scroll'))
    await nextTick()

    // overscan=300 时 range.start=47(offset 4700 < scrollTop 5000),即视口上方的项
    const target = el.querySelector('[data-vl-key="m47"]') as HTMLElement
    expect(target).toBeTruthy()
    Object.defineProperty(target, 'offsetHeight', { value: 150, configurable: true })

    expect(roCallback).toBeTruthy()
    roCallback!([{ target }])
    await nextTick()

    // 该项高度从估算值 100 变为真实 150,多出的 50px 会推挤视口内容,需补偿 scrollTop
    expect(el.scrollTop).toBe(5050)
  })

  it('贴底状态下高度变化重新钉底', async () => {
    const wrapper = mount(ChatVirtualList, {
      props: { items: makeItems(100), estimate: 100, overscan: 0 },
      slots: {
        default: ({ item, index, prev }: any) =>
          h('div', { class: 'row', 'data-idx': index, 'data-prev': prev?.messageId ?? '' }, item.messageId)
      }
    })
    const el = wrapper.element as HTMLElement
    Object.defineProperty(el, 'clientHeight', { value: 500, configurable: true })
    Object.defineProperty(el, 'scrollHeight', { value: 100 * 100, configurable: true })
    el.scrollTop = 9500 // gap = 10000 - 9500 - 500 = 0 < 60,贴底
    el.dispatchEvent(new Event('scroll'))
    await nextTick()

    const target = el.querySelector('.cvl-item') as HTMLElement
    expect(target).toBeTruthy()
    Object.defineProperty(target, 'offsetHeight', { value: 200, configurable: true })
    // 模拟该项变高后整体内容区变高(真实布局中 scrollHeight 会随内容增长)
    Object.defineProperty(el, 'scrollHeight', { value: 100 * 100 + 100, configurable: true })

    expect(roCallback).toBeTruthy()
    roCallback!([{ target }])
    await nextTick()

    expect(el.scrollTop).toBe(el.scrollHeight)

    // scrollTop.value 若未与 DOM 同步,视口范围(range)仍会用旧的 scrollTop 计算,
    // 渲染窗口不会跟到贴底后的尾部项。再等一轮 flush 让 scrollTop.value 的变化触发重渲染。
    await nextTick()
    const lastRow = wrapper.findAll('.row').at(-1)
    expect(lastRow?.attributes('data-idx')).toBe('99')
  })
})

describe('ChatVirtualList 交互 API', () => {
  it('scrollToBottom 钉到底并报告 atBottom', async () => {
    const { wrapper, el } = mountList(200)
    await (wrapper.vm as any).scrollToBottom()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    expect(el.scrollTop).toBe(el.scrollHeight)
    expect((wrapper.vm as any).isAtBottom()).toBe(true)
  })

  it('captureAnchor/restoreAnchor:prepend 后锚点项回到原视口偏移', async () => {
    const { wrapper, el } = mountList(100)
    el.scrollTop = 1000 // 视口第一项 m10,偏移 delta=0
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    ;(wrapper.vm as any).captureAnchor()
    // 头部 prepend 20 条
    const more = Array.from({ length: 20 }, (_, i) => ({ messageId: `old${i}` }))
    await wrapper.setProps({ items: [...more, ...makeItems(100)] })
    await (wrapper.vm as any).restoreAnchor()
    // m10 现在是第 30 项,offsets[30]=3000,delta 0 → scrollTop 应为 3000
    expect(el.scrollTop).toBe(3000)
  })

  it('滚到顶部 emit reach-top', async () => {
    const { wrapper, el } = mountList(100)
    el.scrollTop = 0
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(wrapper.emitted('reach-top')).toBeTruthy()
  })

  it('内容不足一屏时 scrollToBottom 不触发 reach-top', async () => {
    // mountList(3) 的 scrollHeight 被 mock 为 100*3=300 < clientHeight 500,
    // 模拟短会话内容不足一屏的场景;scrollToBottom 的钉底循环会手动调用 onScroll,
    // 此时 scrollTop 恒为 0,若不叠加 scrollHeight > clientHeight 判断会误触发 reach-top
    const { wrapper, el } = mountList(3)
    expect(el.scrollHeight).toBeLessThanOrEqual(el.clientHeight)
    await (wrapper.vm as any).scrollToBottom()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    expect(wrapper.emitted('reach-top')).toBeFalsy()
  })

  it('整组 items 替换(切换会话)后窗口基于新数据计算', async () => {
    // 上一次虚拟化尝试的真实回归:切换到消息数恰好相同的会话时状态未刷新
    const { wrapper, el } = mountList(100)
    el.scrollTop = 5000
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    const newItems = Array.from({ length: 100 }, (_, i) => ({ messageId: `x${i}` }))
    await wrapper.setProps({ items: newItems })
    await (wrapper.vm as any).scrollToBottom()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    expect(el.scrollTop).toBe(el.scrollHeight)
    const rows = wrapper.findAll('.row')
    expect(rows.every((r) => r.text().startsWith('x'))).toBe(true)
  })
})

describe('ChatVirtualList restoreAnchor 绝对复位(Bug1 回归)', () => {
  it('restoreAnchor 后高度重测按当前 offsets 绝对复位锚点,而非依赖增量补偿', async () => {
    const { wrapper, el } = mountList(100)
    el.scrollTop = 1000 // 视口第一项 m10,偏移 delta=0
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    ;(wrapper.vm as any).captureAnchor()
    // 头部 prepend 20 条
    const more = Array.from({ length: 20 }, (_, i) => ({ messageId: `old${i}` }))
    await wrapper.setProps({ items: [...more, ...makeItems(100)] })
    await (wrapper.vm as any).restoreAnchor()
    // 20 个新 prepend 项尚未测量,按 estimate=100 兜底:m10 现为第 30 项 → offsets[30]=3000
    expect(el.scrollTop).toBe(3000)

    // 模拟 ResizeObserver 测出 prepend 项真实高度:150(比估算的 100 多 50/项)
    const entries = more.map((it) => ({
      target: { dataset: { vlKey: it.messageId }, offsetHeight: 150 }
    }))
    expect(roCallback).toBeTruthy()
    roCallback!(entries)
    // 分支内部用了一次 nextTick 才复位,offsets 的 computed 重算也需要一轮 flush
    await nextTick()
    await nextTick()

    // 重算后 offsets[30] = 20*150(prepend 实测) + 10*100(m0..m9 仍是估算) = 3000+1000 = 4000
    // delta 仍为 0 → 绝对复位到 4000,而不是旧的增量补偿逻辑算出的其它值
    expect(el.scrollTop).toBe(4000)
  })

  it('第二批迟到测量(滑动窗口内)仍按当前 offsets 绝对复位', async () => {
    const { wrapper, el } = mountList(100)
    el.scrollTop = 1000
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    ;(wrapper.vm as any).captureAnchor()
    const more = Array.from({ length: 20 }, (_, i) => ({ messageId: `old${i}` }))
    await wrapper.setProps({ items: [...more, ...makeItems(100)] })
    await (wrapper.vm as any).restoreAnchor()

    // 第一批:prepend 项实测 150
    roCallback!(more.map((it) => ({ target: { dataset: { vlKey: it.messageId }, offsetHeight: 150 } })))
    await nextTick()
    await nextTick()
    expect(el.scrollTop).toBe(4000)

    // 第二批迟到测量:m0..m9(锚点上方的旧项)实测 130(此前按 100 估算)
    // 首次复位已顺延滑动窗口,第二批仍应走绝对复位:
    // offsets[30] = 20*150 + 10*130 = 4300
    roCallback!(
      Array.from({ length: 10 }, (_, i) => ({
        target: { dataset: { vlKey: `m${i}` }, offsetHeight: 130 }
      }))
    )
    await nextTick()
    await nextTick()
    expect(el.scrollTop).toBe(4300)
  })
})

describe('ChatVirtualList scrollToBottom 延迟钉底(Bug2 回归)', () => {
  it('长内容延迟测出真实高度后,150ms 内的延迟钉底追平新的 scrollHeight', async () => {
    const { wrapper, el } = mountList(50)
    await (wrapper.vm as any).scrollToBottom()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))
    expect(el.scrollTop).toBe(el.scrollHeight)

    // 模拟表格/图片等慢速内容在收敛窗口之后才让 scrollHeight 变大,且不触发 RO
    Object.defineProperty(el, 'scrollHeight', { value: 5510, configurable: true })
    await new Promise((r) => setTimeout(r, 260))
    expect(el.scrollTop).toBe(5510)
  })

  it('延迟钉底触发前用户已上滚离底,不会被拉回', async () => {
    const { wrapper, el } = mountList(50)
    await (wrapper.vm as any).scrollToBottom()
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

    Object.defineProperty(el, 'scrollHeight', { value: 5510, configurable: true })
    // 用户在延迟钉底触发前主动上滚
    el.scrollTop = 200
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect((wrapper.vm as any).isAtBottom()).toBe(false)

    await new Promise((r) => setTimeout(r, 450))
    expect(el.scrollTop).toBe(200) // atBottom 守卫生效,未被拉回
  })
})

describe('ChatVirtualList wheel 驱动的 user-scroll', () => {
  it('wheel 事件(任意方向)都 emit user-scroll', async () => {
    const { wrapper, el } = mountList(200)
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -50 }))
    await nextTick()
    expect(wrapper.emitted('user-scroll')).toHaveLength(1)
  })

  it('原生 scroll 事件(模拟 scrollToBottom/restoreAnchor 的程序化调用)不 emit user-scroll', async () => {
    const { wrapper, el } = mountList(200)
    el.scrollTop = 5000
    el.dispatchEvent(new Event('scroll'))
    await nextTick()
    expect(wrapper.emitted('user-scroll')).toBeFalsy()
  })
})

describe('ChatVirtualList wheel 驱动的 reach-top(短会话拉历史)', () => {
  it('内容不足一屏时,向上滚轮 emit reach-top', async () => {
    // 短会话没有滚动条,浏览器根本不派发 scroll 事件,onScroll 的触顶判断永远收不到信号
    const { wrapper, el } = mountList(3)
    expect(el.scrollHeight).toBeLessThanOrEqual(el.clientHeight)
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -50 }))
    await nextTick()
    expect(wrapper.emitted('reach-top')).toHaveLength(1)
  })

  it('内容超一屏但已停在顶部时,向上滚轮也 emit reach-top', async () => {
    // scrollTop 已是 0,再上滚不会产生 scroll 事件,同样需要 wheel 兜底
    const { wrapper, el } = mountList(200)
    el.scrollTop = 0
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -50 }))
    await nextTick()
    expect(wrapper.emitted('reach-top')).toHaveLength(1)
  })

  it('向下滚轮不 emit reach-top', async () => {
    const { wrapper, el } = mountList(3)
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: 50 }))
    await nextTick()
    expect(wrapper.emitted('reach-top')).toBeFalsy()
  })

  it('视口不在顶部时,向上滚轮不 emit reach-top', async () => {
    const { wrapper, el } = mountList(200)
    el.scrollTop = 5000
    el.dispatchEvent(new WheelEvent('wheel', { deltaY: -50 }))
    await nextTick()
    expect(wrapper.emitted('reach-top')).toBeFalsy()
  })

  it('一次连续滚轮手势内节流,不会打出多次 reach-top', async () => {
    const { wrapper, el } = mountList(3)
    for (let i = 0; i < 20; i++) el.dispatchEvent(new WheelEvent('wheel', { deltaY: -50 }))
    await nextTick()
    expect(wrapper.emitted('reach-top')).toHaveLength(1)
  })
})
