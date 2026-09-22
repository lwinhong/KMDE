import { app } from 'electron'
import { promises as fs } from 'fs'
import { join, dirname } from 'path'
import { DEFAULT_SETTINGS } from '../shared/types'
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

export async function readSettings(): Promise<AppSettings> {
  let parsed: Partial<AppSettings> = {}
  try {
    const raw = await fs.readFile(getSettingsPath(), 'utf-8')
    parsed = JSON.parse(raw) as Partial<AppSettings>
  } catch {
    // no settings file yet — fall through to defaults + system locale
  }
  const settings: AppSettings = { ...DEFAULT_SETTINGS, ...parsed }
  if (!parsed.language) {
    settings.language = detectSystemLocale()
  }
  return settings
}

export async function writeSettings(settings: AppSettings): Promise<void> {
  await fs.mkdir(dirname(getSettingsPath()), { recursive: true })
  await fs.writeFile(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf-8')
}

export function getCurrentLocale(): AppLocale {
  return currentLocale
}

export function setCurrentLocale(locale: AppLocale): void {
  currentLocale = locale
}
