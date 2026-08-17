/** 单个附件大小上限：500MB */
export const MAX_FILE_SIZE = 500 * 1024 * 1024

/** 待发队列中的附件数量上限 */
export const MAX_ATTACHMENT_COUNT = 9

export type AttachmentKind = 'image' | 'file'

/**
 * Chromium 能在 <img> 里解码的图片格式。
 *
 * 用白名单而非 `type.startsWith('image/')`：iPhone 默认拍照格式 image/heic
 * 与 image/tiff 等虽然 MIME 是 image/*，Chromium 却没有内置解码器
 * （HEIC 因专利授权一直未内置）。当成图片发会在生成缩略图那一步失败，
 * 而 Finder 能正常预览它们，用户完全看不出区别。
 */
const DECODABLE_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/bmp',
  'image/avif'
])

/**
 * 判定附件按图片消息还是文件消息发送。
 *
 * 不可解码的「图片」降级为文件：生成不了缩略图，但作为文件仍能送达，
 * 对方下载后用系统预览可以打开——比直接发送失败强。
 */
export function resolveAttachmentKind(file: File): AttachmentKind {
  return DECODABLE_IMAGE_TYPES.has(file.type.toLowerCase()) ? 'image' : 'file'
}

export interface ClassifyResult {
  /** 通过校验、可以入队的文件 */
  accepted: File[]
  /** 因超过 MAX_FILE_SIZE 被拒的文件名 */
  oversize: string[]
  /** 因超过 MAX_ATTACHMENT_COUNT 被丢弃的文件数量 */
  overflow: number
}

/**
 * 校验一批待入队的附件。
 * 不做文件夹判定——文件夹只能在 drop 事件里靠 webkitGetAsEntry 精确识别，
 * 由 useFileDrop 负责在调用本函数之前分流掉。
 *
 * @param currentCount 队列中已有的附件数，用于计算剩余额度
 */
export function classifyFiles(files: File[], currentCount: number): ClassifyResult {
  const oversize: string[] = []
  const withinSize: File[] = []

  for (const file of files) {
    if (file.size > MAX_FILE_SIZE) oversize.push(file.name)
    else withinSize.push(file)
  }

  const remaining = Math.max(0, MAX_ATTACHMENT_COUNT - currentCount)
  const accepted = withinSize.slice(0, remaining)

  return { accepted, oversize, overflow: withinSize.length - accepted.length }
}
