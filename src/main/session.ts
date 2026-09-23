import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import type { EditorSession, SessionTab } from '../shared/types'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isMissing(error: unknown): boolean {
  return isRecord(error) && error.code === 'ENOENT'
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
    if (!isRecord(tab) || typeof tab.id !== 'string' || !UUID_PATTERN.test(tab.id)) {
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
    tabs.push({
      id: tab.id,
      path: tab.path,
      fileName: tab.fileName,
      markdown: tab.markdown,
      dirty: tab.dirty,
      mode: tab.mode,
      savedMtimeMs: tab.savedMtimeMs,
      deleted: tab.deleted
    })
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

  load(): Promise<EditorSession | null> {
    return this.enqueue(async () => {
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
      // 全量快照是恢复边界，不混入未提交草稿或重新读取普通文件。
      return validateSession(JSON.parse(content))
    })
  }

  async save(session: EditorSession): Promise<void> {
    const snapshot = validateSession(session)
    return this.enqueue(async () => {
      await ensureDirectory(this.rootDir)
      await ensureDirectory(this.draftsDir)
      for (const tab of snapshot.tabs) {
        if (tab.path === null) {
          await atomicWrite(join(this.draftsDir, `${tab.id.toLowerCase()}.md`), tab.markdown)
        }
      }
      await atomicWrite(this.sessionPath, JSON.stringify(snapshot, null, 2))

      // 只有提交成功且已保存为正式文件的同 ID 草稿可清理；关闭页签不清理。
      for (const tab of snapshot.tabs) {
        if (tab.path !== null && !tab.dirty) {
          try {
            await fs.unlink(join(this.draftsDir, `${tab.id.toLowerCase()}.md`))
          } catch (error) {
            if (!isMissing(error)) throw error
          }
        }
      }
    })
  }
}
