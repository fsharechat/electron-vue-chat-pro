// 图片消息的显示状态缓存(模式同 fileDownloadStates.ts 的 dlStateCache):
// 虚拟列表把滚出视口的气泡真正卸载,重挂时从这里恢复已锁定的显示框和
// 已升级的原图 URL,避免重新走「缩略图→原图」流程造成闪烁
export interface ImgState {
  box: { w: number; h: number } | null
  upgradedSrc: string
}

export const imgStateCache = new Map<string, ImgState>()
