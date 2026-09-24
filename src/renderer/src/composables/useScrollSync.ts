export interface ScrollSyncHandle {
  destroy: () => void
  /** 源侧（第一个编辑器）滚动时调用。 */
  syncFromFirst: () => void
  /** 源侧（第二个编辑器）滚动时调用。 */
  syncFromSecond: () => void
}

export interface ScrollEndpoint {
  getLine: () => number
  scrollToLine: (line: number) => void
}

export interface ScrollSyncOptions {
  /** 可注入时钟，便于测试程序滚动抑制窗口。 */
  now?: () => number
  /** 程序滚动目标侧后，其回声滚动在该窗口内被忽略。 */
  ignoreWindowMs?: number
}

const DEFAULT_IGNORE_WINDOW_MS = 150

/**
 * 按行号双向联动两个编辑器（分屏所见即所得 / 源码）。
 *
 * 滚动事件由编辑器内部监听并通知（见 SplitEditor 的 @scroll 转发），
 * 这里只负责「读源侧可视行号 → 滚到目标侧同一行号」，并在时间窗内抑制回声，
 * 避免"按全局比例"在内容高度差异大时内容对不上的问题。
 */
export function createScrollSync(
  first: ScrollEndpoint,
  second: ScrollEndpoint,
  options: ScrollSyncOptions = {}
): ScrollSyncHandle {
  const now = options.now ?? (() => performance.now())
  const ignoreWindowMs = options.ignoreWindowMs ?? DEFAULT_IGNORE_WINDOW_MS

  let lastProgrammatic: { target: ScrollEndpoint; time: number } | null = null

  function syncFrom(source: ScrollEndpoint, target: ScrollEndpoint): void {
    const time = now()
    if (lastProgrammatic && lastProgrammatic.target === source && time - lastProgrammatic.time < ignoreWindowMs) return
    const line = source.getLine()
    lastProgrammatic = { target, time }
    target.scrollToLine(line)
  }

  return {
    syncFromFirst: () => syncFrom(first, second),
    syncFromSecond: () => syncFrom(second, first),
    destroy() {
      lastProgrammatic = null
    }
  }
}
