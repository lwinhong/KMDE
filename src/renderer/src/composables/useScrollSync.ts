export interface ScrollSyncHandle {
  destroy: () => void
}

export interface ScrollSyncOptions {
  /** 可注入时钟，便于测试程序滚动抑制窗口。 */
  now?: () => number
  /** 程序设置对侧 scrollTop 后，其 scroll 事件在该窗口内视为回声并被忽略。 */
  ignoreWindowMs?: number
}

const DEFAULT_IGNORE_WINDOW_MS = 150

/**
 * 按比例双向联动两个滚动容器（分屏左视图 / 右源码）。
 * 程序设置对侧 scrollTop 触发的 scroll 事件在时间窗内被忽略，避免 A→B→A 回环振荡。
 */
export function createScrollSync(
  first: HTMLElement,
  second: HTMLElement,
  options: ScrollSyncOptions = {}
): ScrollSyncHandle {
  const now = options.now ?? (() => performance.now())
  const ignoreWindowMs = options.ignoreWindowMs ?? DEFAULT_IGNORE_WINDOW_MS

  let lastProgrammatic: { target: HTMLElement; time: number } | null = null

  function link(source: HTMLElement, target: HTMLElement): () => void {
    return () => {
      const time = now()
      if (lastProgrammatic && lastProgrammatic.target === source && time - lastProgrammatic.time < ignoreWindowMs) return
      // 源内容不足一屏时没有可同步的滚动量；另一侧保持原位即可。
      const from = source.scrollHeight - source.clientHeight
      if (from <= 0) return
      const ratio = source.scrollTop / from
      const to = target.scrollHeight - target.clientHeight
      if (to <= 0) return
      lastProgrammatic = { target, time }
      target.scrollTop = ratio * to
    }
  }

  const onFirst = link(first, second)
  const onSecond = link(second, first)
  first.addEventListener('scroll', onFirst, { passive: true })
  second.addEventListener('scroll', onSecond, { passive: true })

  return {
    destroy() {
      first.removeEventListener('scroll', onFirst)
      second.removeEventListener('scroll', onSecond)
      lastProgrammatic = null
    }
  }
}
