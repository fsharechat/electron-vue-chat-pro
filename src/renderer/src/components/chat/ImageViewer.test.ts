import { describe, it, expect, afterEach } from 'vitest'
import { mount, VueWrapper } from '@vue/test-utils'
import ImageViewer from './ImageViewer.vue'

const images = [
  { id: 'a', src: 'http://x/a.png' },
  { id: 'b', src: 'http://x/b.png' },
  { id: 'c', src: 'http://x/c.png' },
]

let wrapper: VueWrapper
afterEach(() => wrapper?.unmount())

// 组件用 Teleport 渲染到 body,断言走 document
function q(sel: string) {
  return document.body.querySelector(sel) as HTMLElement | null
}

describe('ImageViewer', () => {
  it('显示起始图片与计数', () => {
    wrapper = mount(ImageViewer, { props: { images, startIndex: 1 } })
    expect(q('.iv-img')?.getAttribute('src')).toBe('http://x/b.png')
    expect(q('.iv-counter')?.textContent).toContain('2 / 3')
  })

  it('点击右侧按钮切到下一张;末张时右按钮消失', async () => {
    wrapper = mount(ImageViewer, { props: { images, startIndex: 1 } })
    q('.iv-next')!.click()
    await wrapper.vm.$nextTick()
    expect(q('.iv-img')?.getAttribute('src')).toBe('http://x/c.png')
    expect(q('.iv-next')).toBeNull()
  })

  it('方向键切换,ESC emit close', async () => {
    wrapper = mount(ImageViewer, { props: { images, startIndex: 1 } })
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft' }))
    await wrapper.vm.$nextTick()
    expect(q('.iv-img')?.getAttribute('src')).toBe('http://x/a.png')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toBeTruthy()
  })
})
