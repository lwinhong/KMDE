import { onBeforeUnmount, shallowRef, watch } from 'vue'
import { useTabsStore } from '../stores/tabs.store'

// 会话备份独立于编辑器挂载；普通文件继续按文档自动保存。
export function useDocumentPersistence(onSaveError: () => void) {
  const tabs = useTabsStore()
  const paused = shallowRef(false)
  let sessionTimer: ReturnType<typeof setTimeout> | undefined
  const fileTimers = new Map<string, { markdown: string; path: string; timer: ReturnType<typeof setTimeout> }>()

  function cancelTimers(): void {
    clearTimeout(sessionTimer)
    sessionTimer = undefined
    for (const entry of fileTimers.values()) clearTimeout(entry.timer)
    fileTimers.clear()
  }

  watch(
    () => [tabs.sessionReady, paused.value, tabs.sessionSnapshot()],
    () => {
      if (!tabs.sessionReady || paused.value || sessionTimer) return
      // 不反复推迟截止时间，持续编辑时也定期保全草稿。
      sessionTimer = setTimeout(() => {
        sessionTimer = undefined
        void tabs.persistSession()
      }, 400)
    },
    { deep: true }
  )

  watch(
    () => tabs.tabs.map((tab) => ({
      id: tab.id, path: tab.path, markdown: tab.markdown,
      eligible: tabs.sessionReady && !paused.value && tab.dirty && !!tab.path &&
        !tab.deleted && !tab.loading && !tabs.hasConflict(tab.id)
    })),
    (documents) => {
      for (const [id, entry] of fileTimers) {
        const doc = documents.find((item) => item.id === id)
        if (!doc?.eligible || doc.markdown !== entry.markdown || doc.path !== entry.path) {
          clearTimeout(entry.timer)
          fileTimers.delete(id)
        }
      }
      for (const doc of documents) {
        if (!doc.eligible || !doc.path || fileTimers.has(doc.id)) continue
        const timer = setTimeout(async () => {
          fileTimers.delete(doc.id)
          if (paused.value || tabs.hasConflict(doc.id)) return
          if (await tabs.saveTab(doc.id) === 'error') onSaveError()
        }, 800)
        fileTimers.set(doc.id, { markdown: doc.markdown, path: doc.path, timer })
      }
    },
    { deep: true }
  )

  function pause(): void {
    paused.value = true
    cancelTimers()
  }

  function resume(): void {
    paused.value = false
  }

  async function flush(): Promise<boolean> {
    clearTimeout(sessionTimer)
    sessionTimer = undefined
    return tabs.persistSession()
  }

  onBeforeUnmount(cancelTimers)
  return { pause, resume, flush }
}
