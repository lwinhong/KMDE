import { createI18n } from 'vue-i18n'
import { localeMessages } from '@shared/locales'
import { DEFAULT_SETTINGS } from '@shared/types'

export const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: DEFAULT_SETTINGS.language,
  fallbackLocale: 'zh-CN',
  messages: localeMessages
})

/** Translate outside of components (stores, tiptap extensions in .js files). */
export function t(key: string, params?: Record<string, string | number>): string {
  return i18n.global.t(key, params ?? {})
}
