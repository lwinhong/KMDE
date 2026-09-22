import { defineStore } from 'pinia'
import { DEFAULT_SETTINGS } from '@shared/types'
import type { AppSettings, AppLocale } from '@shared/types'
import { i18n } from '@/i18n'

export const useSettingsStore = defineStore('settings', {
  state: (): AppSettings => ({ ...DEFAULT_SETTINGS }),
  getters: {
    isDark: (state): boolean => state.theme === 'dark'
  },
  actions: {
    async load(): Promise<void> {
      try {
        const loaded = await window.kmde.loadSettings()
        this.$patch(loaded)
      } catch {
        // keep defaults
      }
      i18n.global.locale.value = this.language
      this.applyThemeClass()
    },
    persist(): void {
      void window.kmde.saveSettings({ ...this.$state })
    },
    setLanguage(locale: AppLocale): void {
      if (this.language === locale) return
      this.language = locale
      i18n.global.locale.value = locale
      this.persist()
      void window.kmde.setLocale(locale)
    },
    applyThemeClass(): void {
      document.documentElement.classList.toggle('dark', this.isDark)
    },
    toggleTheme(): void {
      this.theme = this.isDark ? 'light' : 'dark'
      this.applyThemeClass()
      this.persist()
    },
    toggleSidebar(): void {
      this.sidebarVisible = !this.sidebarVisible
      this.persist()
    },
    toggleOutline(): void {
      this.outlineVisible = !this.outlineVisible
      this.persist()
    }
  }
})
