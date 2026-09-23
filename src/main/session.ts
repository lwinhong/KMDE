import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { EditorSession, SessionSaveOptions, SessionSaveResult, SessionTab } from '../shared/types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
}

function normalizeDraftIds(value: unknown): Set<string> {
  if (value === undefined) return new Set()
  if (!Array.isArray(value)) throw new Error('待清理草稿 ID 必须是数组')
  const ids = new Set<string>()
  for (const id of value) {
    if (typeof id !== 'string' || id.length !== 36 || !UUID_PATTERN.test(id)) {
      throw new Error('待清理草稿 ID 必须是安全的 UUID')
    }
    ids.add(id.toLowerCase())
  }
  return ids
}

function isSavedTab(tab: SessionTab): boolean {
  return tab.path !== null && !tab.dirty && !tab.deleted
}

function validateSession(value: unknown): EditorSession {
  if (!isRecord(value) || value.version !== 1 || !Array.isArray(value.tabs)) {
    throw new Error('会话版本或结构无效')
  }
  if (typeof value.untitledSeq !== 'number' || !Number.isSafeInteger(value.untitledSeq) || value.untitledSeq < 0) {
    throw new Error('会话未命名序号无效')
  }

  const ids = new Set<string>()
  const tabs: SessionTab[] = []
  for (const tab of value.tabs) {
    if (!isRecord(tab) || typeof tab.id !== 'string' || tab.id.length !== 36 || !UUID_PATTERN.test(tab.id)) {
      throw new Error('会话页签 ID 必须是安全的 UUID')
    }
    const key = tab.id.toLowerCase()
    if (ids.has(key)) throw new Error('会话页签 ID 重复')
    ids.add(key)

    if (tab.path !== null && (
      typeof tab.path !== 'string' || !isAbsolute(tab.path) || tab.path.includes('\0') ||
      tab.path.split(/[\\/]/).includes('..')
    )) {
      throw new Error('会话文件路径必须是无路径穿越的绝对路径')
    }
    if (
      typeof tab.fileName !== 'string' || tab.fileName.length === 0 ||
      /[\\/\0]/.test(tab.fileName) || tab.fileName === '.' || tab.fileName === '..' ||
      typeof tab.markdown !== 'string' || typeof tab.dirty !== 'boolean' ||
      typeof tab.deleted !== 'boolean' || (tab.mode !== 'wysiwyg' && tab.mode !== 'source') ||
      typeof tab.savedMtimeMs !== 'number' || !Number.isFinite(tab.savedMtimeMs)
    ) {
      throw new Error('会话页签字段无效')
    }

    // 复制契约字段，避免排队期间调用方修改对象影响已提交的保存请求。
    const saved: SessionTab = {
      id: tab.id,
      path: tab.path,
      fileName: tab.fileName,
      markdown: tab.markdown,
      dirty: tab.dirty,
      mode: tab.mode,
      savedMtimeMs: tab.savedMtimeMs,
      deleted: tab.deleted
    }
    // 光标是可选 UI 元数据；损坏时忽略，不能影响文档恢复。
    const selection = tab.selection
    if (
      isRecord(selection) && (selection.mode === 'source' || selection.mode === 'wysiwyg') &&
      typeof selection.anchor === 'number' && Number.isSafeInteger(selection.anchor) && selection.anchor >= 0 &&
      typeof selection.head === 'number' && Number.isSafeInteger(selection.head) && selection.head >= 0
    ) {
      saved.selection = { mode: selection.mode, anchor: selection.anchor, head: selection.head }
    }
    tabs.push(saved)
  }
  if (value.activeTabId !== null && (
    typeof value.activeTabId !== 'string' || !tabs.some((tab) => tab.id === value.activeTabId)
  )) {
    throw new Error('会话活动页签不存在')
  }
  return { version: 1, tabs, activeTabId: value.activeTabId, untitledSeq: value.untitledSeq }
}

async function ensureDirectory(directory: string): Promise<void> {
  await fs.mkdir(directory, { recursive: true })
  await checkDirectory(directory)
}

async function checkDirectory(directory: string): Promise<void> {
  // 不跟随草稿目录的符号链接，防止文件写出存储目录。
  const stat = await fs.lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('会话存储目录无效或为符号链接')
  }
}

async function atomicWrite(target: string, content: string): Promise<void> {
  const temporary = join(dirname(target), `.${basename(target)}.${randomUUID()}.tmp`)
  const handle = await fs.open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(content, 'utf-8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  // 临时文件与目标同目录；失败时保留临时文件及原文件，不做破坏性清理。
  await fs.rename(temporary, target)
}

export class SessionStorage {
  private readonly rootDir: string
  private readonly draftsDir: string
  private readonly sessionPath: string
  private pending: Promise<void> = Promise.resolve()
  // 仅防护本实例队列中的迟到请求；重启后不存在旧进程的在途请求。
  private readonly closedIds = new Set<string>()
  private readonly namedIds = new Set<string>()

  constructor(rootDir: string) {
    if (typeof rootDir !== 'string' || rootDir.length === 0 || rootDir.includes('\0')) {
      throw new Error('会话存储根目录无效')
    }
    this.rootDir = resolve(rootDir)
    this.draftsDir = join(this.rootDir, 'drafts')
    this.sessionPath = join(this.rootDir, 'session.json')
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.pending.then(operation)
    // 对外保留原始拒绝；单次失败不阻断后续保存或读取。
    this.pending = result.then(() => undefined, () => undefined)
    return result
  }

  private async readManifest(): Promise<{ snapshot: EditorSession; cleanupIds: Set<string> } | null> {
    let content: string
    try {
      content = await fs.readFile(this.sessionPath, 'utf-8')
    } catch (error) {
      if (!isMissing(error)) throw error
      // Windows 在父路径不是目录时也可能返回 ENOENT，不能当成新会话。
      let directory
      try {
        directory = await fs.lstat(this.rootDir)
      } catch (directoryError) {
        if (isMissing(directoryError)) return null
        throw directoryError
      }
      if (!directory.isDirectory() || directory.isSymbolicLink()) throw error
      try {
        await fs.lstat(this.sessionPath)
      } catch (snapshotError) {
        if (isMissing(snapshotError)) return null
        throw snapshotError
      }
      // 快照路径存在但无法读取（例如悬空链接）时保留原始错误。
      throw error
    }
    const value: unknown = JSON.parse(content)
    const snapshot = validateSession(value)
    const cleanupIds = normalizeDraftIds((value as Record<string, unknown>).pendingCleanupIds)
    return { snapshot, cleanupIds }
  }

  private writeManifest(snapshot: EditorSession, cleanupIds: Set<string>): Promise<void> {
    const manifest = cleanupIds.size > 0
      ? { ...snapshot, pendingCleanupIds: [...cleanupIds].sort() }
      : snapshot
    return atomicWrite(this.sessionPath, JSON.stringify(manifest, null, 2))
  }

  private protectActiveDrafts(snapshot: EditorSession, cleanupIds: Set<string>): void {
    for (const tab of snapshot.tabs) {
      if (!isSavedTab(tab)) cleanupIds.delete(tab.id.toLowerCase())
    }
  }

  private async cleanup(snapshot: EditorSession, cleanupIds: Set<string>): Promise<boolean> {
    if (cleanupIds.size === 0) return false
    const remaining = new Set(cleanupIds)
    // 旧清理意图不得伤害新快照中的有效草稿或尚未成功保存的普通文件备份。
    this.protectActiveDrafts(snapshot, remaining)
    try {
      if (remaining.size > 0) {
        try {
          await checkDirectory(this.rootDir)
          await checkDirectory(this.draftsDir)
        } catch (error) {
          if (!isMissing(error)) throw error
          remaining.clear()
        }
        for (const id of remaining) {
          try {
            // 只拼接受管 UUID 路径，不扫描目录，也不使用普通文件路径。
            await fs.unlink(join(this.draftsDir, `${id}.md`))
            remaining.delete(id)
          } catch (error) {
            if (isMissing(error)) remaining.delete(id)
          }
        }
      }
      if (remaining.size !== cleanupIds.size) {
        await this.writeManifest(snapshot, remaining)
      }
      return remaining.size > 0
    } catch {
      // 提交已成功：清理或确认清理的回写失败都不能让调用方回滚身份。
      // 原 manifest 保留意图，下次 load/save（包括重启后）幂等重试。
      return true
    }
  }

  private rememberCommitted(snapshot: EditorSession, previousIds: Iterable<string>): void {
    const activeIds = new Set(snapshot.tabs.map((tab) => tab.id.toLowerCase()))
    for (const id of previousIds) {
      const key = id.toLowerCase()
      // 缺席只终结本实例中的旧请求，不意味着获得删除草稿的授权。
      if (!activeIds.has(key)) this.closedIds.add(key)
    }
    for (const tab of snapshot.tabs) {
      if (tab.path !== null) this.namedIds.add(tab.id.toLowerCase())
    }
  }

  load(): Promise<EditorSession | null> {
    return this.enqueue(async () => {
      const manifest = await this.readManifest()
      if (!manifest) return null
      this.rememberCommitted(manifest.snapshot, manifest.cleanupIds)
      await this.cleanup(manifest.snapshot, manifest.cleanupIds)
      // 全量快照是恢复边界，不混入未提交草稿或重新读取普通文件。
      return manifest.snapshot
    })
  }

  async save(session: EditorSession, options?: SessionSaveOptions): Promise<SessionSaveResult> {
    const snapshot = validateSession(session)
    if (options !== undefined && !isRecord(options)) throw new Error('会话保存选项无效')
    const discardIds = normalizeDraftIds(options?.discardDraftIds)
    for (const tab of snapshot.tabs) {
      if (discardIds.has(tab.id.toLowerCase())) throw new Error('待关闭页签仍在会话快照中')
    }
    return this.enqueue(async () => {
      // 必须在队列内、任何写入前检查，且仅在提交后记录终结状态。
      for (const tab of snapshot.tabs) {
        const id = tab.id.toLowerCase()
        if (this.closedIds.has(id)) throw new Error('迟到快照不能复活已关闭页签')
        if (tab.path === null && this.namedIds.has(id)) throw new Error('迟到快照不能将正式页签退回草稿')
      }
      const previous = await this.readManifest()
      const cleanupIds = new Set([...(previous?.cleanupIds ?? []), ...discardIds])
      for (const tab of snapshot.tabs) {
        if (isSavedTab(tab)) cleanupIds.add(tab.id.toLowerCase())
      }
      this.protectActiveDrafts(snapshot, cleanupIds)
      await ensureDirectory(this.rootDir)
      await ensureDirectory(this.draftsDir)
      for (const tab of snapshot.tabs) {
        if (tab.path === null) {
          await atomicWrite(join(this.draftsDir, `${tab.id.toLowerCase()}.md`), tab.markdown)
        }
      }
      await this.writeManifest(snapshot, cleanupIds)
      this.rememberCommitted(snapshot, [
        ...discardIds, ...(previous?.snapshot.tabs.map((tab) => tab.id) ?? [])
      ])
      return { cleanupPending: await this.cleanup(snapshot, cleanupIds) }
    })
  }
}
