import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { marked } from 'marked'
import MarkdownText from '@/components/chat/MarkdownText.vue'

// 生成一段超过折叠阈值(600字符)的 Markdown 大表格,模拟「系统通知」日报
function bigTable(seed: string) {
  let md = `# ${seed} 日报\n\n| 代码 | 收盘价 | 涨跌幅 |\n| --- | --- | --- |\n`
  for (let i = 0; i < 40; i++) {
    md += `| ${seed}${i} | $${100 + i}.00 | +${i}.0% |\n`
  }
  return md
}

afterEach(() => vi.restoreAllMocks())

describe('MarkdownText 短消息', () => {
  it('直接渲染 Markdown,不出现展开按钮', () => {
    const wrapper = mount(MarkdownText, {
      props: { content: '| a | b |\n| --- | --- |\n| 1 | 2 |' }
    })
    expect(wrapper.find('table').exists()).toBe(true)
    expect(wrapper.find('.md-expand-btn').exists()).toBe(false)
  })
})

describe('MarkdownText 长消息折叠', () => {
  it('超过阈值时默认折叠:显示纯文本摘要 + 展开全文,不解析 Markdown', () => {
    const parseSpy = vi.spyOn(marked, 'parse')
    const wrapper = mount(MarkdownText, { props: { content: bigTable('COLLAPSE') } })
    expect(wrapper.find('table').exists()).toBe(false)
    expect(wrapper.find('.md-expand-btn').text()).toContain('展开全文')
    expect(wrapper.text()).toContain('COLLAPSE 日报')
    expect(parseSpy).not.toHaveBeenCalled()
  })

  it('点击展开全文后完整渲染,并可收起', async () => {
    const wrapper = mount(MarkdownText, { props: { content: bigTable('EXPAND') } })
    await wrapper.find('.md-expand-btn').trigger('click')
    expect(wrapper.find('table').exists()).toBe(true)
    expect(wrapper.find('.md-expand-btn').text()).toContain('收起')
    await wrapper.find('.md-expand-btn').trigger('click')
    expect(wrapper.find('table').exists()).toBe(false)
  })

  it('streaming 中的长消息不折叠', () => {
    const wrapper = mount(MarkdownText, {
      props: { content: bigTable('STREAM'), streaming: true }
    })
    expect(wrapper.find('table').exists()).toBe(true)
    expect(wrapper.find('.md-expand-btn').exists()).toBe(false)
  })
})

describe('MarkdownText 解析缓存', () => {
  it('相同内容重复挂载(模拟切回会话)只解析一次', async () => {
    const parseSpy = vi.spyOn(marked, 'parse')
    const content = bigTable('CACHE')
    const w1 = mount(MarkdownText, { props: { content } })
    await w1.find('.md-expand-btn').trigger('click')
    expect(parseSpy).toHaveBeenCalledTimes(1)
    w1.unmount()
    const w2 = mount(MarkdownText, { props: { content } })
    await w2.find('.md-expand-btn').trigger('click')
    expect(w2.find('table').exists()).toBe(true)
    expect(parseSpy).toHaveBeenCalledTimes(1) // 命中缓存,没有再次解析
  })

  it('streaming 内容不写入缓存', () => {
    const parseSpy = vi.spyOn(marked, 'parse')
    const content = bigTable('NOCACHE')
    mount(MarkdownText, { props: { content, streaming: true } }).unmount()
    mount(MarkdownText, { props: { content, streaming: true } })
    expect(parseSpy).toHaveBeenCalledTimes(2)
  })
})

describe('MarkdownText 展开状态跨挂载保持', () => {
  it('展开后卸载重挂(模拟滚出视口再回来)仍是展开态', async () => {
    const content = bigTable('PERSIST')
    const w1 = mount(MarkdownText, { props: { content, messageId: 'persist-1' } })
    await w1.find('.md-expand-btn').trigger('click')
    expect(w1.find('table').exists()).toBe(true)
    w1.unmount()
    const w2 = mount(MarkdownText, { props: { content, messageId: 'persist-1' } })
    expect(w2.find('table').exists()).toBe(true) // 不再折叠
    // 收起后重挂恢复折叠
    await w2.find('.md-expand-btn').trigger('click')
    w2.unmount()
    const w3 = mount(MarkdownText, { props: { content, messageId: 'persist-1' } })
    expect(w3.find('table').exists()).toBe(false)
  })

  it('未传 messageId 时行为不变(默认折叠)', () => {
    const w = mount(MarkdownText, { props: { content: bigTable('NOID') } })
    expect(w.find('table').exists()).toBe(false)
  })
})

describe('MarkdownText 链接点击', () => {
  const url = 'https://mp.weixin.qq.com/s/DGhupop0z1iDn9uL4Cp2mg?scene=1&click_id=1548970940'

  function mockElectronAPI() {
    const openExternal = vi.fn()
    Object.defineProperty(window, 'electronAPI', { value: { openExternal }, configurable: true })
    return openExternal
  }

  afterEach(() => {
    Object.defineProperty(window, 'electronAPI', { value: undefined, configurable: true })
  })

  it('点击 http(s) 链接用系统浏览器打开,并阻止窗口内跳转', async () => {
    const openExternal = mockElectronAPI()
    const wrapper = mount(MarkdownText, { props: { content: url } })
    const a = wrapper.find('a')
    expect(a.attributes('href')).toBe(url)
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    a.element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(openExternal).toHaveBeenCalledWith(url)
  })

  it('点击非链接文字不触发打开', async () => {
    const openExternal = mockElectronAPI()
    const wrapper = mount(MarkdownText, { props: { content: '普通文字' } })
    await wrapper.find('.markdown-text').trigger('click')
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('非 http(s) 协议的链接不交给系统打开', async () => {
    const openExternal = mockElectronAPI()
    const wrapper = mount(MarkdownText, { props: { content: '[x](file:///etc/passwd)' } })
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    wrapper.find('a').element.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(openExternal).not.toHaveBeenCalled()
  })
})
