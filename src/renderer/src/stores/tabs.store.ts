import { defineStore } from 'pinia'
import { basename, dirname, extname } from './pathUtils'
import { MAX_WYSIWYG_FILE_SIZE } from '@shared/types'
import type { EditorMode, EditorSelectionState, EditorSession, SessionSaveOptions, SessionTab } from '@shared/types'
import { useSettingsStore } from './settings.store'
import { t } from '@/i18n'

export interface EditorTab extends SessionTab {
  reloadToken: number
  loading: boolean
}

export interface TabConflict {
  tabId: string
  path: string
  diskContent: string
  mtimeMs: number
}

type SaveResult = 'saved' | 'need-path' | 'error' | 'loading'
const pendingSaves = new Map<string, Promise<SaveResult>>()
const sessionQueues = new WeakMap<object, Promise<void>>()

// 在执行时捕获快照，让关闭、身份转换与周期保存共享提交顺序。
function enqueueSession<T>(store: object, action: () => Promise<T>): Promise<T> {
  const result = (sessionQueues.get(store) ?? Promise.resolve()).then(action)
  sessionQueues.set(store, result.then(() => undefined, () => undefined))
  return result
}

function pathKey(path: string): string {
  return path.replace(/\\/g, '/').toLowerCase()
}

export const MAX_TABS = 12

export const useTabsStore = defineStore('tabs', {
  state: () => ({
    tabs: [] as EditorTab[],
    activeTabId: null as string | null,
    conflict: null as TabConflict | null,
    conflictQueue: [] as TabConflict[],
    saving: false,
    untitledSeq: 0,
    sessionReady: false,
    sessionError: false,
    cleanupPending: false
  }),
  getters: {
    activeTab(state): EditorTab | null {
      return state.tabs.find((t) => t.id === state.activeTabId) ?? null
    }
  },
  actions: {
    byPath(path: string): EditorTab | null {
      return this.tabs.find((t) => t.path && pathKey(t.path) === pathKey(path)) ?? null
    },

    sessionSnapshot(): EditorSession {
      const tabs = this.tabs.filter((tab) => !tab.loading).map((tab): SessionTab => ({
        id: tab.id, path: tab.path, fileName: tab.fileName, markdown: tab.markdown,
        dirty: tab.dirty, mode: tab.mode, savedMtimeMs: tab.savedMtimeMs, deleted: tab.deleted,
        ...(tab.selection ? { selection: { ...tab.selection } } : {})
      }))
      return {
        version: 1, tabs, untitledSeq: this.untitledSeq,
        activeTabId: tabs.some((tab) => tab.id === this.activeTabId) ? this.activeTabId : tabs[0]?.id ?? null
      }
    },

    persistSession(): Promise<boolean> {
      return enqueueSession(this, () => this.commitSession(this.sessionSnapshot()))
    },

    async commitSession(snapshot: EditorSession, options?: SessionSaveOptions): Promise<boolean> {
      if (!this.sessionReady) return false
      try {
        const result = await window.kmde.saveSession(snapshot, options)
        this.cleanupPending = result.cleanupPending
        this.sessionError = false
        return true
      } catch (error) {
        this.sessionError = true
        console.error('[session] 保存失败:', error)
        return false
      }
    },

    async restoreSession(): Promise<void> {
      this.sessionReady = false
      const session = await window.kmde.loadSession()
      const restored: EditorTab[] = []
      const conflicts: TabConflict[] = []
      this.conflict = null
      this.conflictQueue = []
      for (const saved of session?.tabs ?? []) {
        if (saved.path && restored.some((tab) => tab.path && pathKey(tab.path) === pathKey(saved.path!))) continue
        const tab: EditorTab = { ...saved, reloadToken: 0, loading: false }
        if (saved.selection) tab.selection = { ...saved.selection }
        if (tab.path) {
          try {
            const disk = await window.kmde.readFile(tab.path)
            if (!tab.dirty || disk.content === tab.markdown) {
              tab.markdown = disk.content
              tab.dirty = false
              tab.savedMtimeMs = disk.mtimeMs
            } else if (disk.mtimeMs !== tab.savedMtimeMs) {
              conflicts.push({ tabId: tab.id, path: tab.path, diskContent: disk.content, mtimeMs: disk.mtimeMs })
            }
            tab.deleted = false
          } catch {
            // 保留快照，不用空白覆盖无法读取或已被删除的文档。
            tab.deleted = true
          }
        }
        if (tab.markdown.length > MAX_WYSIWYG_FILE_SIZE) tab.mode = 'source'
        if (tab.selection && tab.selection.mode !== tab.mode) delete tab.selection
        restored.push(tab)
      }
      this.tabs = restored
      this.conflict = conflicts.shift() ?? null
      this.conflictQueue = conflicts
      this.untitledSeq = session?.untitledSeq ?? 0
      this.activeTabId = restored.find((tab) => tab.id === session?.activeTabId)?.id ?? restored[0]?.id ?? null
      this.sessionReady = true
    },

    hasConflict(id: string): boolean {
      return this.conflict?.tabId === id || this.conflictQueue.some((conflict) => conflict.tabId === id)
    },

    enqueueConflict(conflict: TabConflict): void {
      if (!this.conflict || this.conflict.tabId === conflict.tabId) this.conflict = conflict
      else {
        this.conflictQueue = this.conflictQueue.filter((item) => item.tabId !== conflict.tabId)
        this.conflictQueue.push(conflict)
      }
    },

    updateTabContent(id: string, markdown: string): void {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab) return
      if (markdown !== tab.markdown) {
        tab.markdown = markdown
        tab.dirty = true
      }
    },

    updateTabSelection(id: string, selection: EditorSelectionState): void {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.loading || selection.mode !== tab.mode) return
      const previous = tab.selection
      if (previous?.mode === selection.mode && previous.anchor === selection.anchor && previous.head === selection.head) return
      tab.selection = { ...selection }
    },

    async openPath(path: string): Promise<EditorTab | null> {
      const settings = useSettingsStore()
      const existing = this.byPath(path)
      if (existing) {
        this.activeTabId = existing.id
        existing.deleted = false
        if (!existing.loading && !existing.dirty) {
          void this.reloadFromDisk(existing)
        }
        return existing
      }
      if (this.tabs.length >= MAX_TABS) return null
      // two-phase open: mount the tab immediately with a skeleton, fill content once read
      const tab: EditorTab = {
        id: crypto.randomUUID(),
        path,
        fileName: basename(path),
        markdown: '',
        dirty: false,
        mode: settings.defaultMode,
        savedMtimeMs: 0,
        deleted: false,
        reloadToken: 0,
        loading: true
      }
      this.tabs.push(tab)
      this.activeTabId = tab.id
      // grab the reactive proxy stored in state: mutating the raw object
      // would bypass reactivity and leave the skeleton stuck forever
      const staged = this.byPath(path)
      try {
        const { content, mtimeMs } = await window.kmde.readFile(path)
        if (staged) {
          staged.markdown = content
          staged.savedMtimeMs = mtimeMs
          staged.mode = content.length > MAX_WYSIWYG_FILE_SIZE ? 'source' : settings.defaultMode
        }
      } catch (err) {
        this.removeTab(tab.id)
        console.error('[tabs] open failed:', path, err)
        throw err
      } finally {
        if (staged) staged.loading = false
      }
      return tab
    },

    async reloadFromDisk(tab: EditorTab): Promise<void> {
      if (!tab.path) return
      try {
        const { content, mtimeMs } = await window.kmde.readFile(tab.path)
        if (!this.tabs.includes(tab) || tab.dirty || tab.loading) return
        if (content !== tab.markdown) {
          tab.markdown = content
          tab.savedMtimeMs = mtimeMs
          tab.reloadToken++
        } else {
          tab.savedMtimeMs = mtimeMs
        }
      } catch (err) {
        console.error('[tabs] reload check failed:', tab.path, err)
      }
    },

    newUntitled(): EditorTab | null {
      if (this.tabs.length >= MAX_TABS) return null
      const settings = useSettingsStore()
      const tab: EditorTab = {
        id: crypto.randomUUID(),
        path: null,
        fileName: `${t('tabs.untitled')}-${++this.untitledSeq}.md`,
        markdown: '',
        dirty: true,
        mode: settings.defaultMode,
        savedMtimeMs: 0,
        deleted: false,
        reloadToken: 0,
        loading: false
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
      this.conflictQueue = this.conflictQueue.filter((conflict) => conflict.tabId !== id)
      if (this.conflict?.tabId === id) this.conflict = this.conflictQueue.shift() ?? null
    },

    closePersistedTab(id: string): Promise<boolean> {
      return enqueueSession(this, async () => {
        const tab = this.tabs.find((item) => item.id === id)
        if (!tab || !this.sessionReady) return false
        const snapshot = this.sessionSnapshot()
        const index = snapshot.tabs.findIndex((item) => item.id === id)
        snapshot.tabs = snapshot.tabs.filter((item) => item.id !== id)
        if (snapshot.activeTabId === id) {
          snapshot.activeTabId = snapshot.tabs[Math.min(index, snapshot.tabs.length - 1)]?.id ?? null
        }
        const options = tab.path === null ? { discardDraftIds: [id] } : undefined
        // 先提交候选会话；失败时保留标签、内容与活动状态供重试。
        if (!await this.commitSession(snapshot, options)) return false
        this.removeTab(id)
        return true
      })
    },

    saveTab(id: string): Promise<SaveResult> {
      return this.queueSave(id)
    },

    saveTabAs(id: string, targetPath: string): Promise<SaveResult> {
      return this.queueSave(id, targetPath)
    },

    queueSave(id: string, targetPath?: string): Promise<SaveResult> {
      const previous = pendingSaves.get(id) ?? Promise.resolve()
      const operation = previous.then(() => enqueueSession(this, async (): Promise<SaveResult> => {
        const tab = this.tabs.find((item) => item.id === id)
        if (!tab) return 'error'
        if (tab.loading) return 'loading'
        if (this.hasConflict(id)) return 'error'
        const path = targetPath ?? tab.path
        if (!path || (!targetPath && tab.deleted)) return 'need-path'
        const existing = this.byPath(path)
        if (existing && existing.id !== id) return 'error'
        const snapshot = tab.markdown
        const identity = { path: tab.path, fileName: tab.fileName, savedMtimeMs: tab.savedMtimeMs, deleted: tab.deleted }
        try {
          const { mtimeMs } = await window.kmde.writeFile(path, snapshot)
          tab.path = path
          tab.fileName = basename(path)
          tab.dirty = tab.markdown !== snapshot
          tab.deleted = false
          tab.savedMtimeMs = mtimeMs
          // 会话引用提交成功后，主进程才清理对应草稿。
          if (await this.commitSession(this.sessionSnapshot())) return 'saved'
          if (targetPath) {
            Object.assign(tab, identity)
            tab.dirty = true
          }
          return 'error'
        } catch (error) {
          console.error('[tabs] 保存失败:', error)
          return 'error'
        }
      }))
      pendingSaves.set(id, operation)
      this.saving = true
      void operation.finally(() => {
        if (pendingSaves.get(id) === operation) pendingSaves.delete(id)
        this.saving = pendingSaves.size > 0
      })
      return operation
    },

    async waitForSaves(): Promise<void> {
      while (pendingSaves.size) await Promise.all([...pendingSaves.values()])
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
      delete tab.selection
    },

    setMode(id: string, mode: EditorMode): void {
      const tab = this.tabs.find((t) => t.id === id)
      if (!tab || tab.mode === mode) return
      tab.mode = mode
      delete tab.selection
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
      if (tab.loading) return 'none'
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
      this.enqueueConflict({ tabId: tab.id, path, diskContent: content, mtimeMs })
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
      this.conflict = this.conflictQueue.shift() ?? null
    }
  }
})

// small helpers kept in a separate module to avoid importing 'path' in renderer
// re-export for convenience of components
export { basename, dirname, extname }
