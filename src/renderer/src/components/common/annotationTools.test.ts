import { describe, it, expect, vi } from 'vitest'
import { drawRect, drawArrow, applyMosaic } from './annotationTools'

function makeCtx() {
  return {
    save: vi.fn(), restore: vi.fn(),
    beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(),
    closePath: vi.fn(), stroke: vi.fn(), fill: vi.fn(),
    strokeRect: vi.fn(), drawImage: vi.fn(),
    strokeStyle: '', fillStyle: '', lineWidth: 1,
    imageSmoothingEnabled: true,
  } as unknown as CanvasRenderingContext2D
}

describe('drawRect', () => {
  it('normalises coordinates and calls strokeRect', () => {
    const ctx = makeCtx()
    drawRect(ctx, 50, 80, 10, 20, '#ff0000')
    // x=min(50,10)=10, y=min(80,20)=20, w=|50-10|=40, h=|80-20|=60
    expect(ctx.strokeRect).toHaveBeenCalledWith(10, 20, 40, 60)
  })

  it('sets strokeStyle to the given color', () => {
    const ctx = makeCtx()
    drawRect(ctx, 0, 0, 100, 100, '#123456')
    expect(ctx.strokeStyle).toBe('#123456')
  })
})

describe('drawArrow', () => {
  it('calls stroke for the line and fill for the arrowhead', () => {
    const ctx = makeCtx()
    drawArrow(ctx, 0, 0, 100, 0, '#ff0000')
    expect(ctx.stroke).toHaveBeenCalled()
    expect(ctx.fill).toHaveBeenCalled()
  })

  it('draws from (x1,y1) to (x2,y2)', () => {
    const ctx = makeCtx()
    drawArrow(ctx, 10, 20, 90, 80, '#ff0000')
    expect(ctx.moveTo).toHaveBeenCalledWith(10, 20)
    expect(ctx.lineTo).toHaveBeenCalledWith(90, 80)
  })
})

describe('applyMosaic', () => {
  it('draws into ctx using a small temp canvas', () => {
    const ctx = makeCtx()
    const mockBg = { naturalWidth: 1920, naturalHeight: 1080 } as HTMLImageElement
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      if (tag === 'canvas') {
        return {
          width: 0, height: 0,
          getContext: () => ({
            imageSmoothingEnabled: true,
            drawImage: vi.fn(),
          })
        } as unknown as HTMLCanvasElement
      }
      return document.createElement(tag)
    })
    // Should not throw and should call drawImage at least twice (shrink + expand)
    applyMosaic(ctx, mockBg, 100, 100, 200, 100, 960, 540)
    expect(ctx.drawImage).toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('does nothing when w or h is 0', () => {
    const ctx = makeCtx()
    const mockBg = { naturalWidth: 1920, naturalHeight: 1080 } as HTMLImageElement
    applyMosaic(ctx, mockBg, 0, 0, 0, 100, 960, 540)
    expect(ctx.drawImage).not.toHaveBeenCalled()
  })
})
