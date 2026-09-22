import chokidar, { type FSWatcher } from 'chokidar'
import type { Stats } from 'fs'
import type { FsEvent } from '../shared/types'

const DEBOUNCE_MS = 120

export class WatcherManager {
  private watcher: FSWatcher | null = null
  private selfWrites = new Map<string, number>()
  private pending = new Map<string, { type: FsEvent['type']; mtimeMs?: number; timer: NodeJS.Timeout }>()
  private root: string | null = null

  constructor(private send: (event: FsEvent) => void) {}

  get currentRoot(): string | null {
    return this.root
  }

  markSelfWrite(path: string, mtimeMs: number): void {
    this.selfWrites.set(path, mtimeMs)
    // keep map small
    if (this.selfWrites.size > 256) {
      const firstKey = this.selfWrites.keys().next().value
      if (firstKey !== undefined) this.selfWrites.delete(firstKey)
    }
  }

  watch(root: string): void {
    this.stop()
    this.root = root
    this.watcher = chokidar.watch(root, {
      ignoreInitial: true,
      ignored: (path: string, stats?: Stats) => {
        if (!stats) return false
        if (stats.isFile()) return false
        const base = path.replace(/\\/g, '/').split('/').pop() ?? ''
        return base === 'node_modules' || base === '.git' || base === 'dist' || base === '.hvigor'
      },
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50
      }
    })

    const handle = (type: FsEvent['type'], path: string, stats?: Stats): void => {
      // skip our own writes
      if (type === 'change' && stats) {
        const recorded = this.selfWrites.get(path)
        if (recorded !== undefined && Math.abs(recorded - stats.mtimeMs) < 5) {
          this.selfWrites.delete(path)
          return
        }
      }
      const mtimeMs = stats?.mtimeMs
      const prev = this.pending.get(path)
      if (prev) {
        clearTimeout(prev.timer)
        this.pending.delete(path)
      }
      const timer = setTimeout(() => {
        const entry = this.pending.get(path)
        this.pending.delete(path)
        if (entry) {
          this.send({ type: entry.type, path, mtimeMs: entry.mtimeMs })
        }
      }, DEBOUNCE_MS)
      this.pending.set(path, { type, mtimeMs, timer })
    }

    this.watcher
      .on('add', (path, stats) => handle('add', path, stats))
      .on('change', (path, stats) => handle('change', path, stats))
      .on('unlink', (path) => handle('unlink', path))
      .on('addDir', (path) => handle('addDir', path))
      .on('unlinkDir', (path) => handle('unlinkDir', path))
      .on('error', (err) => {
        console.error('[watcher]', err)
      })
  }

  stop(): void {
    for (const { timer } of this.pending.values()) {
      clearTimeout(timer)
    }
    this.pending.clear()
    this.selfWrites.clear()
    if (this.watcher) {
      void this.watcher.close()
      this.watcher = null
    }
    this.root = null
  }
}
