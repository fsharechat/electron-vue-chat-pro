export function drawRect(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, lineWidth = 2
): void {
  const x = Math.min(x1, x2)
  const y = Math.min(y1, y2)
  const w = Math.abs(x2 - x1)
  const h = Math.abs(y2 - y1)
  ctx.save()
  ctx.strokeStyle = color
  ctx.lineWidth = lineWidth
  ctx.strokeRect(x, y, w, h)
  ctx.restore()
}

export function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number, y1: number, x2: number, y2: number,
  color: string, lineWidth = 2
): void {
  ctx.save()
  ctx.strokeStyle = color
  ctx.fillStyle = color
  ctx.lineWidth = lineWidth

  ctx.beginPath()
  ctx.moveTo(x1, y1)
  ctx.lineTo(x2, y2)
  ctx.stroke()

  const angle = Math.atan2(y2 - y1, x2 - x1)
  const headLen = Math.max(12, lineWidth * 5)
  ctx.beginPath()
  ctx.moveTo(x2, y2)
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - Math.PI / 6),
    y2 - headLen * Math.sin(angle - Math.PI / 6)
  )
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + Math.PI / 6),
    y2 - headLen * Math.sin(angle + Math.PI / 6)
  )
  ctx.closePath()
  ctx.fill()

  ctx.restore()
}

export function applyMosaic(
  ctx: CanvasRenderingContext2D,
  bgImage: HTMLImageElement,
  x: number, y: number, w: number, h: number,
  canvasW: number, canvasH: number,
  blockSize = 12
): void {
  if (w <= 0 || h <= 0) return
  const scaleX = bgImage.naturalWidth / canvasW
  const scaleY = bgImage.naturalHeight / canvasH

  const tmp = document.createElement('canvas')
  const scaledW = Math.max(1, Math.round(w / blockSize))
  const scaledH = Math.max(1, Math.round(h / blockSize))
  tmp.width = scaledW
  tmp.height = scaledH
  const tmpCtx = tmp.getContext('2d')!
  tmpCtx.imageSmoothingEnabled = false
  tmpCtx.drawImage(bgImage, x * scaleX, y * scaleY, w * scaleX, h * scaleY, 0, 0, scaledW, scaledH)

  ctx.save()
  ctx.imageSmoothingEnabled = false
  ctx.drawImage(tmp, 0, 0, scaledW, scaledH, x, y, w, h)
  ctx.imageSmoothingEnabled = true
  ctx.restore()
}
