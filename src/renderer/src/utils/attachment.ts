/** 单个附件大小上限：500MB */
export const MAX_FILE_SIZE = 500 * 1024 * 1024

/** 待发队列中的附件数量上限 */
export const MAX_ATTACHMENT_COUNT = 9

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
