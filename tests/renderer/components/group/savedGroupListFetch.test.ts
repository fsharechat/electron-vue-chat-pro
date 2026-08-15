import { describe, it, expect } from 'vitest'
import { selectMissingGroupIds } from '@/components/group/savedGroupList'

describe('selectMissingGroupIds', () => {
  it('本地已有群信息的 id 不需要拉取', () => {
    const requested = new Set<string>()
    const result = selectMissingGroupIds(['group-a'], [{ target: 'group-a' }], requested)

    expect(result).toEqual([])
  })

  it('本地缺信息的 id 会被选中拉取', () => {
    const requested = new Set<string>()
    const result = selectMissingGroupIds(['group-a', 'group-b'], [{ target: 'group-a' }], requested)

    expect(result).toEqual(['group-b'])
  })

  it('去重：同一个 id 请求过一次后，即使仍然缺信息也不会再次被选中', () => {
    const requested = new Set<string>()
    const first = selectMissingGroupIds(['group-a'], [], requested)
    expect(first).toEqual(['group-a'])

    // 模拟 groupInfoList 因其它群信息到达而变化，但 group-a 依旧没拉回来
    const second = selectMissingGroupIds(['group-a'], [], requested)
    expect(second).toEqual([])
  })

  it('未被请求过 Set 记录的 id 每次都会被重新选中（对照组，证明上一条用例的去重确实来自 requested）', () => {
    const first = selectMissingGroupIds(['group-a'], [], new Set<string>())
    const second = selectMissingGroupIds(['group-a'], [], new Set<string>())

    expect(first).toEqual(['group-a'])
    expect(second).toEqual(['group-a'])
  })
})
