import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { setActivePinia, createPinia } from 'pinia'

// SavedGroupList -> websocketcli -> useUIStore 会引入 benz-amr-recorder，jsdom 下无
// createObjectURL 会直接抛错；此处与本仓库其余组件测试（如 MessageList.test.ts）保持一致的 mock 方式
vi.mock('benz-amr-recorder', () => ({ default: vi.fn() }))
vi.mock('@/websocket/websocketcli', () => ({
  default: { getGroupInfo: vi.fn() }
}))

import SavedGroupList from './SavedGroupList.vue'
import { useUserSettingStore } from '@/stores/useUserSettingStore'

describe('SavedGroupList', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
  })

  it('没有保存任何群时显示空态', () => {
    const wrapper = mount(SavedGroupList)

    expect(wrapper.text()).toContain('还没有保存的群聊')
  })

  it('只渲染 value 为 1 的群，tombstone 不出现', () => {
    const store = useUserSettingStore()
    store.applyEntries([
      { scope: 6, key: 'group-a', value: '1', updateDt: 100 },
      { scope: 6, key: 'group-b', value: '0', updateDt: 200 },
      { scope: 6, key: 'group-c', value: '1', updateDt: 300 }
    ])

    const wrapper = mount(SavedGroupList)

    const items = wrapper.findAll('[data-testid="saved-group-item"]')
    expect(items).toHaveLength(2)
  })

  it('取消保存后该群从列表消失', async () => {
    const store = useUserSettingStore()
    store.applyEntries([{ scope: 6, key: 'group-a', value: '1', updateDt: 100 }])
    const wrapper = mount(SavedGroupList)
    expect(wrapper.findAll('[data-testid="saved-group-item"]')).toHaveLength(1)

    store.applyEntries([{ scope: 6, key: 'group-a', value: '0', updateDt: 200 }])
    await wrapper.vm.$nextTick()

    expect(wrapper.findAll('[data-testid="saved-group-item"]')).toHaveLength(0)
  })
})
