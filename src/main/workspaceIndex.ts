import { promises as fs } from 'node:fs'
import { extname, join, relative, sep } from 'node:path'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { SUPPORTED_DOCUMENT_EXTENSIONS } from '../shared/types.ts'
import type { QuickOpenEntry, WorkspaceIndexChunk } from '../shared/types'
import { isIgnoredWorkspaceName } from './workspaceFiles.ts'

const nameCollator = new Intl.Collator('zh-CN')

/**
 * 工作区索引器：在主进程内做广度优先目录枚举（I/O 密集，异步 readdir 不阻塞事件循环），
 * 按块流式推送给渲染进程。渲染进程不再自行遍历，彻底消除索引期间的 UI 卡顿。
 */
export class WorkspaceIndexer {
  private readonly maxDirs: number
  private readonly chunkSize: number
  private readonly concurrency: number
  private generation = 0
  private active: { cancelled: boolean } | null = null

  constructor(options?: { maxDirs?: number; chunkSize?: number; concurrency?: number }) {
    this.maxDirs = options?.maxDirs ?? 20000
    this.chunkSize = options?.chunkSize ?? 2000
    this.concurrency = options?.concurrency ?? 16
  }

  /**
   * 启动一次索引扫描；自动取消上一次。返回本次代次。
   * emit 保证只在本任务未被取消时调用，且 done=true 一定是最后一次。
   */
  start(root: string, emit: (chunk: WorkspaceIndexChunk) => void): number {
    const generation = ++this.generation
    if (this.active) this.active.cancelled = true
    const job = { cancelled: false }
    this.active = job
    void this.walk(root, generation, job, emit)
    return generation
  }

  cancel(): void {
    if (this.active) this.active.cancelled = true
    this.active = null
  }

  private async walk(
    root: string,
    generation: number,
    job: { cancelled: boolean },
    emit: (chunk: WorkspaceIndexChunk) => void
  ): Promise<void> {
    const queue: string[] = [root]
    const seen = new Set(queue)
    let cursor = 0
    let pending: QuickOpenEntry[] = []

    const send = (done: boolean): void => {
      if (job.cancelled) return
      emit({ generation, entries: pending, done })
      pending = []
    }

    try {
      while (!job.cancelled && cursor < queue.length && cursor < this.maxDirs) {
        const end = Math.min(cursor + this.concurrency, queue.length, this.maxDirs)
        const batch = queue.slice(cursor, end)
        cursor = end
        const lists = await Promise.all(batch.map(async (dir) => {
          try {
            return await fs.readdir(dir, { withFileTypes: true })
          } catch {
            return []
          }
        }))
        if (job.cancelled) return
        for (let index = 0; index < batch.length; index++) {
          const dir = batch[index]
          const files: QuickOpenEntry[] = []
          for (const entry of lists[index]) {
            if (isIgnoredWorkspaceName(entry.name)) continue
            // Dirent 无法区分链接目标；不解引用任何链接，避免目录递归逃逸。
            if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) continue
            if (entry.isDirectory()) {
              const path = join(dir, entry.name)
              if (!seen.has(path) && queue.length < this.maxDirs) {
                seen.add(path)
                queue.push(path)
              }
            } else {
              const ext = extname(entry.name).toLowerCase()
              if (!SUPPORTED_DOCUMENT_EXTENSIONS.has(ext)) continue
              const path = join(dir, entry.name)
              files.push({ path, fileName: entry.name, relPath: relative(root, path).split(sep).join('/') })
            }
          }
          // 与 listWorkspaceDir 保持同目录稳定顺序，便于快速打开结果可预期。
          files.sort((a, b) => nameCollator.compare(a.fileName, b.fileName))
          for (const file of files) {
            pending.push(file)
            if (pending.length >= this.chunkSize) send(false)
          }
        }
        // 批与批之间让出主进程事件循环，保证其它 IPC（保存/读取）低延迟。
        await yieldToEventLoop()
      }
      send(true)
    } catch {
      send(true)
    }
  }
}
