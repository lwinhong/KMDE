export interface TextDiffChange {
  from: number
  to: number
  insert: string
}

/**
 * 计算把 current 变成 next 的最小公共前后缀差异，
 * 用于分屏视图同步对侧内容时尽量保住光标与滚动位置。
 * 内容相同返回 null，调用方可直接跳过更新。
 */
export function computeTextDiff(current: string, next: string): TextDiffChange | null {
  if (current === next) return null

  const min = Math.min(current.length, next.length)
  let start = 0
  while (start < min && current.charCodeAt(start) === next.charCodeAt(start)) start++

  let endCurrent = current.length
  let endNext = next.length
  while (endCurrent > start && endNext > start && current.charCodeAt(endCurrent - 1) === next.charCodeAt(endNext - 1)) {
    endCurrent--
    endNext--
  }

  return { from: start, to: endCurrent, insert: next.slice(start, endNext) }
}
