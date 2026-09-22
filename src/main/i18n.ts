import { createT } from '../shared/locales'
import { getCurrentLocale } from './settings'

/** Translate a key with the main process's current locale (native menu, dialogs, errors). */
export function t(key: string, params?: Record<string, string | number>): string {
  return createT(getCurrentLocale())(key, params)
}
