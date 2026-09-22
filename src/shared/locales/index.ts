import zhCN from './zh-CN'
import enUS from './en-US'
import type { AppLocale } from '../types'

export const localeMessages: Record<AppLocale, typeof zhCN> = {
  'zh-CN': zhCN,
  'en-US': enUS
}

export type Translator = (key: string, params?: Record<string, string | number>) => string

/**
 * Lightweight translator for the Electron main process (no vue-i18n there).
 * Supports dot-path lookup and {name} interpolation.
 */
export function createT(locale: AppLocale): Translator {
  return (key, params) => {
    const parts = key.split('.')
    let node: unknown = localeMessages[locale]
    for (const part of parts) {
      if (node && typeof node === 'object' && part in (node as Record<string, unknown>)) {
        node = (node as Record<string, unknown>)[part]
      } else {
        node = undefined
        break
      }
    }
    let text = typeof node === 'string' ? node : key
    if (params) {
      for (const [name, value] of Object.entries(params)) {
        text = text.replaceAll(`{${name}}`, String(value))
      }
    }
    return text
  }
}
