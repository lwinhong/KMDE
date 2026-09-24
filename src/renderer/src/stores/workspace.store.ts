import { computed, onScopeDispose, shallowRef } from 'vue'
import { defineStore } from 'pinia'
import { SUPPORTED_DOCUMENT_EXTENSIONS, type FileNode, type QuickOpenEntry, type WorkspaceIndexChunk } from '@shared/types'
import { useSettingsStore } from './settings.store'
import { basename } from './pathUtils'

export type { QuickOpenEntry }

// 由完整索引推导"递归包含至少一个支持文档"的目录集合（绝对路径、正斜杠），
// 文件树用它隐藏过滤后的空目录；relPath 与根路径分隔符差异在此归一。
export function collectNonEmptyDirs(root: string, fileIndex: QuickOpenEntry[]): Set<string> {
  const prefix = root.replace(/\\/g, '/').replace(/\/$/, '')
  const dirs = new Set<string>()
  for (const item of fileIndex) {
    let slash = item.relPath.lastIndexOf('/')
    if (slash < 0) continue
    let dir = item.relPath.slice(0, slash)
    for (;;) {
      dirs.add(`${prefix}/${dir}`)
      const cut = dir.lastIndexOf('/')
      if (cut < 0) break
      dir = dir.slice(0, cut)
    }
  }
  return dirs
}

interface IndexRun {
  cancelled: boolean
  generation: number | null
  entries: QuickOpenEntry[]
  unsubscribe: () => void
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

  function cancelIndex(): void {
    const run = indexRun
    if (run) {
      run.cancelled = true
      run.unsubscribe()
      indexRun = null
      // 遍历在主进程执行；显式通知取消（打开新目录时主进程也会自动作废旧任务）。
      void window.kmde.cancelIndexWorkspace()
    }
    indexing.value = false
  }

  function cancelRefresh(): void {
    if (refreshTimer !== null) clearTimeout(refreshTimer)
    refreshTimer = null
  }

  function isMdFile(node: FileNode): boolean {
    return !node.isDir && SUPPORTED_DOCUMENT_EXTENSIONS.has(node.ext.toLowerCase())
  }

  async function rebuildFileIndex(): Promise<void> {
    cancelRefresh()
    cancelIndex()
    const scanRoot = root.value
    if (!scanRoot) return
    const run: IndexRun = { cancelled: false, generation: null, entries: [], unsubscribe: () => {} }
    indexRun = run
    indexing.value = true
    // 先订阅再发起扫描，避免主进程秒回时丢失最早的分块。
    // invoke 的应答先于任何分块到达（主进程 start 同步返回后才异步遍历），
    // generation 尚未就绪时分块照收；就绪后用它丢弃迟到/串代的旧分块。
    run.unsubscribe = window.kmde.onIndexChunk((chunk: WorkspaceIndexChunk) => {
      if (indexRun !== run || run.cancelled) return
      if (run.generation !== null && chunk.generation !== run.generation) return
      for (const entry of chunk.entries) run.entries.push(entry)
      if (!chunk.done) return
      indexRun = null
      indexing.value = false
      run.unsubscribe()
      fileIndex.value = run.entries
    })
    try {
      run.generation = await window.kmde.indexWorkspace(scanRoot)
    } catch {
      if (indexRun === run) {
        indexRun = null
        indexing.value = false
        run.unsubscribe()
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
