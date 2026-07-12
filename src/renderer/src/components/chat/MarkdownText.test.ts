import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { marked } from 'marked'
import MarkdownText from './MarkdownText.vue'

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
