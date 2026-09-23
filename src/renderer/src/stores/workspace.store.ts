import { computed, onScopeDispose, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { SUPPORTED_DOCUMENT_EXTENSIONS, type FileNode } from '@shared/types'
import { useSettingsStore } from './settings.store'
import { basename, relativeTo } from './pathUtils'

const INDEX_CONCURRENCY = 4
const INDEX_BATCH_SIZE = 200
const MAX_INDEX_DIRS = 20000

export interface QuickOpenEntry {
  path: string
  fileName: string
  relPath: string
}

interface IndexRun {
  cancelled: boolean
  pauses: Map<ReturnType<typeof setTimeout>, () => void>
}

export const useWorkspaceStore = defineStore('workspace', () => {
  const settings = useSettingsStore()
  const root = shallowRef<string | null>(null)
  const rootName = shallowRef('')
  const fileIndex = shallowRef<QuickOpenEntry[]>([])
  const indexing = shallowRef(false)
  const treeVersion = shallowRef(0)
  const isOpen = computed(() => root.value !== null)
  let operation = 0
  let indexRun: IndexRun | null = null
  let refreshTimer: ReturnType<typeof setTimeout> | null = null
  let activeReads = 0
  const readWaiters = new Set<() => void>()

  function wakeReaders(): void {
    const waiting = [...readWaiters]
    readWaiters.clear()
    for (const resume of waiting) resume()
  }

  function cancelIndex(): void {
    if (indexRun) {
      indexRun.cancelled = true
      for (const [timer, resume] of indexRun.pauses) {
        clearTimeout(timer)
        resume()
      }
      indexRun.pauses.clear()
      indexRun = null
    }
    wakeReaders()
    indexing.value = false
  }

  function cancelRefresh(): void {
    if (refreshTimer !== null) clearTimeout(refreshTimer)
    refreshTimer = null
  }

  function current(run: IndexRun): boolean {
    return indexRun === run && !run.cancelled
  }

  function yieldToUI(run: IndexRun): Promise<void> {
    if (!current(run)) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        run.pauses.delete(timer)
        resolve()
      }, 0)
      run.pauses.set(timer, resolve)
    })
  }

  async function readIndexDir(run: IndexRun, path: string): Promise<FileNode[]> {
    // 旧 IPC 无法撤回；跨重建共用配额，避免快速切换不断增加在途请求。
    while (current(run) && activeReads >= INDEX_CONCURRENCY) {
      await new Promise<void>((resolve) => readWaiters.add(resolve))
    }
    if (!current(run)) return []
    activeReads++
    try {
      return await window.kmde.listDir(path)
    } catch {
      return []
    } finally {
      activeReads--
      wakeReaders()
    }
  }

  function isMdFile(node: FileNode): boolean {
    return !node.isDir && SUPPORTED_DOCUMENT_EXTENSIONS.has(node.ext.toLowerCase())
  }

  async function rebuildFileIndex(): Promise<void> {
    cancelRefresh()
    cancelIndex()
    const scanRoot = root.value
    if (!scanRoot) return
    const run: IndexRun = { cancelled: false, pauses: new Map() }
    indexRun = run
    indexing.value = true
    try {
      // 首轮也让出主线程，让根目录和编辑器先完成本轮更新。
      await yieldToUI(run)
      if (!current(run)) return
      const entries: QuickOpenEntry[] = []
      const queue = [scanRoot]
      const seen = new Set(queue)
      let cursor = 0
      let processed = 0
      while (current(run) && cursor < queue.length && cursor < MAX_INDEX_DIRS) {
        const end = Math.min(cursor + INDEX_CONCURRENCY, queue.length, MAX_INDEX_DIRS)
        const batch = queue.slice(cursor, end)
        cursor = end
        const results = await Promise.all(batch.map((path) => readIndexDir(run, path)))
        if (!current(run)) return
        for (const nodes of results) {
          for (const node of nodes) {
            if (node.isDir) {
              if (!seen.has(node.path) && queue.length < MAX_INDEX_DIRS) {
                seen.add(node.path)
                queue.push(node.path)
              }
            } else if (isMdFile(node)) {
              entries.push({ path: node.path, fileName: node.name, relPath: relativeTo(node.path, scanRoot) })
            }
            if (++processed % INDEX_BATCH_SIZE === 0) {
              await yieldToUI(run)
              if (!current(run)) return
            }
          }
        }
        // 即使 IPC 立即 resolve，也不能用连续微任务垄断渲染线程。
        if (cursor < queue.length) await yieldToUI(run)
      }
      if (current(run)) fileIndex.value = entries
    } finally {
      if (current(run)) {
        indexRun = null
        indexing.value = false
      }
    }
  }

  async function updateWatch(nextRoot: string | null): Promise<void> {
    const ok = nextRoot === null
      ? await window.kmde.unwatchWorkspace()
      : await window.kmde.watchWorkspace(nextRoot)
    if (!ok) throw new Error(nextRoot === null ? '停止工作区监听失败' : '启动工作区监听失败')
  }

  async function persistWorkspace(nextRoot: string | null): Promise<void> {
    settings.lastWorkspace = nextRoot
    await settings.persist()
  }

  async function finishOperation(id: number, tasks: Promise<void>[]): Promise<void> {
    // 同时消费两个失败分支，且必须等设置落盘；旧操作不得回滚新状态或报告迟到错误。
    const results = await Promise.allSettled(tasks)
    if (id !== operation) return
    for (const result of results) {
      if (result.status === 'rejected') throw result.reason
    }
  }

  async function openFolder(nextRoot: string): Promise<void> {
    const id = ++operation
    cancelRefresh()
    cancelIndex()
    root.value = nextRoot
    rootName.value = basename(nextRoot)
    fileIndex.value = []
    treeVersion.value++
    // IPC 必须在任何 await 之前发送，不能被前一次设置写入或 watch 响应重排。
    const watching = updateWatch(nextRoot)
    const saving = persistWorkspace(nextRoot)
    void rebuildFileIndex()
    await finishOperation(id, [watching, saving])
  }

  async function closeFolder(): Promise<void> {
    const id = ++operation
    cancelRefresh()
    cancelIndex()
    root.value = null
    rootName.value = ''
    fileIndex.value = []
    treeVersion.value++
    const watching = updateWatch(null)
    const saving = persistWorkspace(null)
    await finishOperation(id, [watching, saving])
  }

  function scheduleTreeRefresh(): void {
    if (!root.value) return
    cancelRefresh()
    cancelIndex()
    const id = operation
    refreshTimer = setTimeout(() => {
      refreshTimer = null
      if (id !== operation || !root.value) return
      treeVersion.value++
      void rebuildFileIndex()
    }, 400)
  }

  onScopeDispose(() => {
    operation++
    cancelRefresh()
    cancelIndex()
  })

  return {
    root, rootName, fileIndex, indexing, treeVersion, isOpen,
    openFolder, closeFolder, isMdFile, rebuildFileIndex, scheduleTreeRefresh
  }
})
