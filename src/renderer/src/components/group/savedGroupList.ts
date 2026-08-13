/**
 * SavedGroupList 的纯逻辑：从已保存的群 id 里挑出「本地没有群信息、且还没请求过」的那些。
 *
 * 之所以单独抽出来（而不是内联在 computed 里）：computed 的求值时机由它读取的响应式依赖决定，
 * 一旦在 getter 里调用有副作用的 getGroupInfo，只要 groupStore.groupInfoList 因任意群信息到达
 * 而变化（哪怕跟本列表无关），computed 就会重新求值，对当时仍缺信息的每个群再次发起请求——
 * getGroupInfo 本身没有去重/节流，面板开着就会不停打请求。
 *
 * 这里用 requested 这个 Set 做去重：一个 groupId 只要被标记过，就不再进入返回值，
 * 调用方也就不会再为它调用 getGroupInfo，避免同一个群被重复拉取。
 */
export function selectMissingGroupIds(
  ids: string[],
  groupInfoList: { target: string }[],
  requested: Set<string>
): string[] {
  const toFetch: string[] = []
  for (const id of ids) {
    if (requested.has(id)) continue
    const hasInfo = groupInfoList.some(g => g.target === id)
    if (hasInfo) continue
    requested.add(id)
    toFetch.push(id)
  }
  return toFetch
}
