// 图片消息显示框:以首次加载成功的图(通常是缩略图)的自然尺寸按 max×max 约束
// 等比算出并锁定,之后原图加载只替换内容不改变框,避免气泡尺寸跳变
export function fitImageBox(nw: number, nh: number, max = 200) {
  const scale = Math.min(max / nw, max / nh, 1)
  return { w: Math.max(1, Math.round(nw * scale)), h: Math.max(1, Math.round(nh * scale)) }
}
