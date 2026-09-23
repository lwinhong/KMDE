import chokidar, { type FSWatcher } from 'chokidar'
import type { Stats } from 'node:fs'
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path'
import type { FsEvent } from '../shared/types'
import { isIgnoredWorkspaceName } from './workspaceFiles.ts'

const DEBOUNCE_MS = 120
const OVERLAP_MS = 1000
const WRITE_FINISH = { stabilityThreshold: 200, pollInterval: 50 }

type EventSource = { id: symbol; current: () => boolean }
type OpenFile = { path: string; id: symbol }
type PendingEvent = { event: FsEvent; sources: Map<symbol, EventSource>; timer: NodeJS.Timeout }
type DeliveredEvent = { event: FsEvent; sources: Map<symbol, EventSource>; time: number }

function pathKey(path: string): string {
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

function sameEvent(a: FsEvent, b: FsEvent): boolean {
  return a.type === b.type && a.mtimeMs === b.mtimeMs
}

function outsideRoot(path: string): boolean {
  return path === '..' || path.startsWith(`..${sep}`) || isAbsolute(path)
}

export class WatcherManager {
  private watcher: FSWatcher | null = null
  private filesWatcher: FSWatcher | null = null
  private workspaceGeneration = 0
  private filesGeneration = 0
  private openFiles = new Map<string, OpenFile>()
  private openAncestors = new Set<string>()
  private selfWrites = new Map<string, number>()
  private pending = new Map<string, PendingEvent>()
  private delivered = new Map<string, DeliveredEvent>()
  private root: string | null = null
  private readonly send: (event: FsEvent) => void

  constructor(send: (event: FsEvent) => void) {
    this.send = send
  }

  get currentRoot(): string | null {
    return this.root
  }

  markSelfWrite(path: string, mtimeMs: number): void {
    const key = pathKey(path)
    this.selfWrites.delete(key)
    this.selfWrites.set(key, mtimeMs)
    if (this.selfWrites.size > 256) {
      this.selfWrites.delete(this.selfWrites.keys().next().value!)
    }
  }

  watch(root: string): void {
    const absoluteRoot = resolve(root)
    if (this.root !== null && pathKey(this.root) === pathKey(absoluteRoot)) return
    this.stop()
    const generation = this.workspaceGeneration
    const ignored = (path: string, stats?: Stats): boolean => {
      if (stats?.isSymbolicLink()) return true
      const local = relative(absoluteRoot, resolve(path))
      if (!local) return false
      // 仅按工作区内的相对名称过滤，显式选择的根及其祖先不受名称影响。
      if (outsideRoot(local)) return outsideRoot(relative(resolve(path), absoluteRoot))
      return local.split(sep).some(isIgnoredWorkspaceName)
    }
    const watcher = chokidar.watch(absoluteRoot, {
      ignoreInitial: true,
      followSymlinks: false,
      ignored,
      awaitWriteFinish: WRITE_FINISH
    })
    this.root = absoluteRoot
    this.watcher = watcher
    const source: EventSource = {
      id: Symbol('workspace'),
      current: () => generation === this.workspaceGeneration && watcher === this.watcher
    }
    this.bindEvents(watcher, (type, path, stats) => {
      if (!source.current() || ignored(path, stats)) return
      const local = relative(absoluteRoot, resolve(path))
      if (outsideRoot(local)) return
      this.queueEvent(type, path, stats, source)
    }, true)
    // 不等待 ready；递归发现目录由 chokidar 在后台完成。
  }

  setOpenFiles(paths: string[]): void {
    const next = new Map<string, OpenFile>()
    for (const path of paths) {
      const key = pathKey(path)
      next.set(key, this.openFiles.get(key) ?? { path: resolve(path), id: Symbol('file') })
    }
    const removed = [...this.openFiles].filter(([key]) => !next.has(key)).map(([, file]) => file.path)
    const added = [...next].filter(([key]) => !this.openFiles.has(key)).map(([, file]) => file.path)
    if (removed.length === 0 && added.length === 0) return
    this.openFiles = next
    this.openAncestors.clear()
    for (const { path } of next.values()) {
      let parent = dirname(path)
      while (!this.openAncestors.has(pathKey(parent))) {
        this.openAncestors.add(pathKey(parent))
        const ancestor = dirname(parent)
        if (ancestor === parent) break
        parent = ancestor
      }
    }
    this.pruneEvents()
    if (next.size === 0) {
      const watcher = this.filesWatcher
      this.filesWatcher = null
      this.filesGeneration += 1
      this.closeWatcher(watcher)
      return
    }
    if (this.filesWatcher) {
      if (removed.length) this.filesWatcher.unwatch(removed)
      if (added.length) this.filesWatcher.add(added)
      return
    }
    const generation = ++this.filesGeneration
    const watcher = chokidar.watch(added, {
      ignoreInitial: true,
      followSymlinks: false,
      depth: 0,
      ignored: (path, stats) => {
        if (stats?.isSymbolicLink()) return true
        const key = pathKey(path)
        if (this.openFiles.has(key)) return stats?.isDirectory() ?? false
        return !this.openAncestors.has(key)
      },
      awaitWriteFinish: WRITE_FINISH
    })
    this.filesWatcher = watcher
    this.bindEvents(watcher, (type, path, stats) => {
      if (generation !== this.filesGeneration || watcher !== this.filesWatcher || stats?.isSymbolicLink()) return
      const key = pathKey(path)
      const file = this.openFiles.get(key)
      if (!file) return
      this.queueEvent(type, file.path, stats, {
        id: file.id,
        current: () => generation === this.filesGeneration && this.openFiles.get(key) === file
      })
    }, false)
  }

  stop(): void {
    this.workspaceGeneration += 1
    const watcher = this.watcher
    this.watcher = null
    this.root = null
    this.pruneEvents()
    this.closeWatcher(watcher)
  }

  private bindEvents(
    watcher: FSWatcher,
    handle: (type: FsEvent['type'], path: string, stats?: Stats) => void,
    directories: boolean
  ): void {
    watcher.on('add', (path, stats) => handle('add', path, stats))
      .on('change', (path, stats) => handle('change', path, stats))
      .on('unlink', (path) => handle('unlink', path))
      .on('error', (error) => { console.error('[watcher]', error) })
    if (directories) {
      watcher.on('addDir', (path, stats) => handle('addDir', path, stats))
        .on('unlinkDir', (path) => handle('unlinkDir', path))
    }
  }

  private queueEvent(type: FsEvent['type'], path: string, stats: Stats | undefined, source: EventSource): void {
    const key = pathKey(path)
    if (type === 'change' && stats) {
      const recorded = this.selfWrites.get(key)
      // 保留自写入戳，让两路监听的同一次写入都被抑制。
      if (recorded !== undefined && Math.abs(recorded - stats.mtimeMs) < 5) return
    }
    const previous = this.pending.get(key)
    const delivered = this.delivered.get(key)
    // 直接监听文件时，重建可能只收到 change；已报告删除后统一恢复为 add。
    const wasRemoved = (previous ?? delivered)?.event.type === 'unlink'
    const event: FsEvent = {
      type: type === 'change' && (previous?.event.type === 'add' || wasRemoved) ? 'add' : type,
      path: resolve(path),
      mtimeMs: stats?.mtimeMs
    }
    // 两路监听可能在不同的稳定窗口后送达；仅折叠另一来源的相同事件。
    if (delivered && Date.now() - delivered.time < OVERLAP_MS &&
      sameEvent(delivered.event, event) && !delivered.sources.has(source.id) &&
      [...delivered.sources.values()].some((item) => item.current())) {
      delivered.sources.set(source.id, source)
      return
    }
    if (previous) clearTimeout(previous.timer)
    const sources = previous && sameEvent(previous.event, event) ? previous.sources : new Map<symbol, EventSource>()
    sources.set(source.id, source)
    const entry: PendingEvent = {
      event,
      sources,
      timer: setTimeout(() => {
        if (this.pending.get(key) !== entry) return
        this.pending.delete(key)
        for (const [id, item] of sources) if (!item.current()) sources.delete(id)
        if (sources.size === 0) return
        this.delivered.delete(key)
        this.delivered.set(key, { event, sources, time: Date.now() })
        if (this.delivered.size > 1024) this.delivered.delete(this.delivered.keys().next().value!)
        this.send(event)
      }, DEBOUNCE_MS)
    }
    this.pending.set(key, entry)
  }

  private pruneEvents(): void {
    for (const [key, entry] of this.pending) {
      for (const [id, source] of entry.sources) if (!source.current()) entry.sources.delete(id)
      if (entry.sources.size === 0) {
        clearTimeout(entry.timer)
        this.pending.delete(key)
      }
    }
    for (const [key, entry] of this.delivered) {
      for (const [id, source] of entry.sources) if (!source.current()) entry.sources.delete(id)
      if (entry.sources.size === 0) this.delivered.delete(key)
    }
  }

  private closeWatcher(watcher: FSWatcher | null): void {
    if (!watcher) return
    try {
      void watcher.close().catch((error: unknown) => { console.error('[watcher:close]', error) })
    } catch (error) {
      console.error('[watcher:close]', error)
    }
  }
}
