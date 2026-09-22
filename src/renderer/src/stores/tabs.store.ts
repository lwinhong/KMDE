import { defineStore } from 'pinia'
import { basename, dirname, extname } from './pathUtils'
import { MAX_WYSIWYG_FILE_SIZE } from '@shared/types'
import type { EditorMode } from '@shared/types'
import { useSettingsStore } from './settings.store'

export interface EditorTab {
  id: string
  path: string | null
  fileName: string
  markdown: string
  dirty: boolean
  mode: EditorMode
  savedMtimeMs: number
  deleted: boolean
  reloadToken: number
}

export interface TabConflict {
  tabId: string
  path: string
  diskContent: string
  mtimeMs: number
}

let tabSeq = 0

export const useTabsStore = defineStore('tabs', {
  state: () => ({
    tabs: [] as EditorTab[],
    activeTabId: null as string | null,
    conflict: null as TabConflict | null,
    saving: false
  }),
  getters: {
    activeTab(state): EditorTab | null {
      return state.tabs.find((t) => t.id === state.activeTabId) ?? null
    }
  },
  actions: {
    byPath(path: string): EditorTab | null {
      return this.tabs.find((t) => t.path === path) ?? null
    },

    updateTabContent(id: string, markdown: string): void {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab) return
      if (markdown !== tab.markdown) {
        tab.markdown = markdown
        tab.dirty = true
      }
    },

    async openPath(path: string): Promise<EditorTab | null> {
      const settings = useSettingsStore()
      try {
        const { content, mtimeMs } = await window.kmde.readFile(path)
        const existing = this.byPath(path)
        if (existing) {
          this.activeTabId = existing.id
          existing.deleted = false
          // reload from disk only when not dirty
          if (!existing.dirty && content !== existing.markdown) {
            existing.markdown = content
            existing.savedMtimeMs = mtimeMs
            existing.reloadToken++
          }
          return existing
        }
        const mode: EditorMode =
          content.length > MAX_WYSIWYG_FILE_SIZE ? 'source' : settings.defaultMode
        const tab: EditorTab = {
          id: `tab-${++tabSeq}`,
          path,
          fileName: basename(path),
          markdown: content,
          dirty: false,
          mode,
          savedMtimeMs: mtimeMs,
          deleted: false,
          reloadToken: 0
        }
        this.tabs.push(tab)
        this.activeTabId = tab.id
        return tab
      } catch (err) {
        console.error('[tabs] open failed:', path, err)
        throw err
      }
    },

    newUntitled(): EditorTab {
      const settings = useSettingsStore()
      const tab: EditorTab = {
        id: `tab-${++tabSeq}`,
        path: null,
        fileName: `未命名-${tabSeq}.md`,
        markdown: '',
        dirty: true,
        mode: settings.defaultMode,
        savedMtimeMs: 0,
        deleted: false,
        reloadToken: 0
      }
      this.tabs.push(tab)
      this.activeTabId = tab.id
      return tab
    },

    activateTab(id: string): void {
      if (this.tabs.some((t) => t.id === id)) {
        this.activeTabId = id
      }
    },

    removeTab(id: string): void {
      const idx = this.tabs.findIndex((t) => t.id === id)
      if (idx < 0) return
      this.tabs.splice(idx, 1)
      if (this.activeTabId === id) {
        const next = this.tabs[Math.min(idx, this.tabs.length - 1)]
        this.activeTabId = next ? next.id : null
      }
      if (this.conflict && this.conflict.tabId === id) {
        this.conflict = null
      }
    },

    async saveTab(id: string): Promise<'saved' | 'need-path' | 'error'> {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab) return 'error'
      if (!tab.path || tab.deleted) {
        return 'need-path'
      }
      const snapshot = tab.markdown
      try {
        this.saving = true
        const { mtimeMs } = await window.kmde.writeFile(tab.path, snapshot)
        if (tab.markdown === snapshot) {
          tab.dirty = false
          tab.savedMtimeMs = mtimeMs
        }
        return 'saved'
      } catch (err) {
        console.error('[tabs] save failed:', err)
        return 'error'
      } finally {
        this.saving = false
      }
    },

    async saveTabAs(id: string, targetPath: string): Promise<'saved' | 'error'> {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab) return 'error'
      const snapshot = tab.markdown
      try {
        this.saving = true
        const { mtimeMs } = await window.kmde.writeFile(targetPath, snapshot)
        tab.path = targetPath
        tab.fileName = basename(targetPath)
        tab.dirty = false
        tab.deleted = false
        tab.savedMtimeMs = mtimeMs
        return 'saved'
      } catch (err) {
        console.error('[tabs] save-as failed:', err)
        return 'error'
      } finally {
        this.saving = false
      }
    },

    async flushSave(id: string): Promise<boolean> {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab) return false
      if (tab.dirty || tab.deleted) {
        const result = await this.saveTab(id)
        if (result === 'saved') return true
        if (result === 'need-path') {
          const suggested = tab.path ?? `${tab.fileName}`
          const target = await window.kmde.saveAsDialog(suggested.endsWith('.md') ? suggested : `${suggested}.md`)
          if (!target) return false
          return (await this.saveTabAs(id, target)) === 'saved'
        }
        return false
      }
      return true
    },

    toggleMode(id: string): void {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab) return
      tab.mode = tab.mode === 'wysiwyg' ? 'source' : 'wysiwyg'
    },

    setMode(id: string, mode: EditorMode): void {
      const tab = this.tabs.find((t) => t.id === id)
      if (tab) tab.mode = mode
    },

    // ----- external change state machine -----

    handleExternalDelete(path: string): void {
      const tab = this.byPath(path)
      if (tab) {
        tab.deleted = true
      }
    },

    handleExternalContent(path: string, content: string, mtimeMs: number): 'reloaded' | 'clean' | 'conflict' | 'none' {
      const tab = this.byPath(path)
      if (!tab) return 'none'
      if (!tab.dirty) {
        if (content !== tab.markdown) {
          tab.markdown = content
          tab.savedMtimeMs = mtimeMs
          tab.reloadToken++
          return 'reloaded'
        }
        tab.savedMtimeMs = mtimeMs
        return 'clean'
      }
      if (content === tab.markdown) {
        tab.dirty = false
        tab.savedMtimeMs = mtimeMs
        return 'clean'
      }
      this.conflict = { tabId: tab.id, path, diskContent: content, mtimeMs }
      return 'conflict'
    },

    resolveConflict(action: 'load-disk' | 'keep'): void {
      const conflict = this.conflict
      if (!conflict) return
      const tab = this.tabs.find((t) => t.id === conflict.tabId)
      if (tab && action === 'load-disk') {
        tab.markdown = conflict.diskContent
        tab.dirty = false
        tab.deleted = false
        tab.savedMtimeMs = conflict.mtimeMs
        tab.reloadToken++
      }
      this.conflict = null
    }
  }
})

// small helpers kept in a separate module to avoid importing 'path' in renderer
// re-export for convenience of components
export { basename, dirname, extname }
