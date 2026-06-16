export interface DlState {
  status: 'idle' | 'downloading' | 'done'
  percent: number
}

// 普通 Map，不参与 Vue 响应式追踪，切换会话后持久保存下载完成状态
export const dlStateCache = new Map<string, DlState>()
