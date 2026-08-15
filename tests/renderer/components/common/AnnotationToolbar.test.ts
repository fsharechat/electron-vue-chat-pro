import { describe, it, expect } from 'vitest'
import { mount } from '@vue/test-utils'
import AnnotationToolbar from '@/components/common/AnnotationToolbar.vue'

describe('AnnotationToolbar', () => {
  it('highlights the active tool button', () => {
    const wrapper = mount(AnnotationToolbar, {
      props: { activeTool: 'rect', activeColor: '#f5222d', canUndo: false }
    })
    expect(wrapper.find('[data-tool="rect"]').classes()).toContain('active')
    expect(wrapper.find('[data-tool="arrow"]').classes()).not.toContain('active')
  })

  it('emits selectTool when a tool button is clicked', async () => {
    const wrapper = mount(AnnotationToolbar, {
      props: { activeTool: null, activeColor: '#f5222d', canUndo: false }
    })
    await wrapper.find('[data-tool="arrow"]').trigger('click')
    expect(wrapper.emitted('selectTool')?.[0]).toEqual(['arrow'])
  })

  it('emits selectColor when a color dot is clicked', async () => {
    const wrapper = mount(AnnotationToolbar, {
      props: { activeTool: null, activeColor: '#f5222d', canUndo: false }
    })
    await wrapper.find('[data-color="#1890ff"]').trigger('click')
    expect(wrapper.emitted('selectColor')?.[0]).toEqual(['#1890ff'])
  })

  it('undo button is disabled when canUndo is false', () => {
    const wrapper = mount(AnnotationToolbar, {
      props: { activeTool: null, activeColor: '#f5222d', canUndo: false }
    })
    expect(wrapper.find('[data-action="undo"]').attributes('disabled')).toBeDefined()
  })

  it('emits undo when undo button clicked and canUndo is true', async () => {
    const wrapper = mount(AnnotationToolbar, {
      props: { activeTool: null, activeColor: '#f5222d', canUndo: true }
    })
    await wrapper.find('[data-action="undo"]').trigger('click')
    expect(wrapper.emitted('undo')).toBeTruthy()
  })

  it('emits cancel and confirm from action buttons', async () => {
    const wrapper = mount(AnnotationToolbar, {
      props: { activeTool: null, activeColor: '#f5222d', canUndo: false }
    })
    await wrapper.find('[data-action="cancel"]').trigger('click')
    await wrapper.find('[data-action="confirm"]').trigger('click')
    expect(wrapper.emitted('cancel')).toBeTruthy()
    expect(wrapper.emitted('confirm')).toBeTruthy()
  })
})
