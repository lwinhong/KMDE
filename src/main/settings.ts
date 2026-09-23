import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join, dirname, basename } from 'node:path'
import { DEFAULT_SETTINGS } from '../shared/types.ts'
import type { AppSettings, AppLocale } from '../shared/types'

let settingsPath = ''
let currentLocale: AppLocale = DEFAULT_SETTINGS.language

export function getSettingsPath(): string {
  if (!settingsPath) {
    settingsPath = join(process.env['APPDATA'] ?? process.cwd(), 'kmde', 'settings.json')
  }
  return settingsPath
}

export function detectSystemLocale(): AppLocale {
  return app.getLocale().toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US'
}

let pending: Promise<void> = Promise.resolve()

function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const result = pending.then(operation)
  // 保留调用方的错误，但不让一次失败阻断后续读写。
  pending = result.then(() => undefined, () => undefined)
  return result
}

export async function readSettings(): Promise<AppSettings> {
  return enqueue(async () => {
    let parsed: Partial<AppSettings> = {}
    try {
      const raw = await fs.readFile(getSettingsPath(), 'utf-8')
      const value: unknown = JSON.parse(raw)
      if (value && typeof value === 'object' && !Array.isArray(value)) parsed = value as Partial<AppSettings>
    } catch {
      // no settings file yet — fall through to defaults + system locale
    }
    const settings: AppSettings = { ...DEFAULT_SETTINGS, ...parsed }
    if (!parsed.language) {
      settings.language = detectSystemLocale()
    }
    return settings
  })
}

export async function writeSettings(settings: AppSettings): Promise<void> {
  // 入队前立即序列化副本，排队期间调用方继续修改对象不会改变本次提交。
  const content = JSON.stringify(settings, null, 2)
  return enqueue(async () => {
    const path = getSettingsPath()
    const directory = dirname(path)
    await fs.mkdir(directory, { recursive: true })
    const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`)
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined
    let created = false
    try {
      handle = await fs.open(temporary, 'wx', 0o600)
      created = true
      await handle.writeFile(content, 'utf-8')
      await handle.sync()
      await handle.close()
      handle = undefined
      await fs.rename(temporary, path)
      created = false
    } finally {
      if (handle) await handle.close().catch(() => undefined)
      if (created) {
        await fs.unlink(temporary).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') console.error('[settings:cleanup]', error)
        })
      }
    }
  })
}

export function getCurrentLocale(): AppLocale {
  return currentLocale
}

export function setCurrentLocale(locale: AppLocale): void {
  currentLocale = locale
}
