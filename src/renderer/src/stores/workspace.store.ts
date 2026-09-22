import { defineStore } from 'pinia'
import type { FileNode } from '@shared/types'
import { useSettingsStore } from './settings.store'
import { basename, relativeTo } from './pathUtils'

const MD_EXTS = new Set(['.md', '.markdown', '.mdown', '.txt'])

export interface QuickOpenEntry {
  path: string
  fileName: string
  relPath: string
}

export const useWorkspaceStore = defineStore('workspace', {
  state: () => ({
    root: null as string | null,
    rootName: '',
    fileIndex: [] as QuickOpenEntry[],
    indexing: false,
    treeVersion: 0,
    _indexTimer: null as ReturnType<typeof setTimeout> | null
  }),
  getters: {
    isOpen: (state): boolean => state.root !== null
  },
  actions: {
    async openFolder(root: string): Promise<void> {
      const settings = useSettingsStore()
      this.root = root
      this.rootName = basename(root)
      settings.lastWorkspace = root
      settings.persist()
      await window.kmde.watchWorkspace(root)
      await this.rebuildFileIndex()
      this.treeVersion++
    },

    async closeFolder(): Promise<void> {
      await window.kmde.unwatchWorkspace()
      const settings = useSettingsStore()
      settings.lastWorkspace = null
      settings.persist()
      this.root = null
      this.rootName = ''
      this.fileIndex = []
      this.treeVersion++
    },

    isMdFile(node: FileNode): boolean {
      return !node.isDir && MD_EXTS.has(node.ext)
    },

    async rebuildFileIndex(): Promise<void> {
      if (!this.root) return
      const root = this.root
      this.indexing = true
      try {
        const entries: QuickOpenEntry[] = []
        const queue: string[] = [root]
        let visited = 0
        while (queue.length > 0 && visited < 20000) {
          const dir = queue.shift()!
          visited++
          let nodes: FileNode[]
          try {
            nodes = await window.kmde.listDir(dir)
          } catch {
            continue
          }
          for (const node of nodes) {
            if (node.isDir) {
              queue.push(node.path)
            } else if (this.isMdFile(node)) {
              entries.push({
                path: node.path,
                fileName: node.name,
                relPath: relativeTo(node.path, root)
              })
            }
          }
        }
        if (this.root === root) {
          this.fileIndex = entries
        }
      } finally {
        this.indexing = false
      }
    },

    scheduleTreeRefresh(): void {
      this.treeVersion++
      if (this._indexTimer) {
        clearTimeout(this._indexTimer)
      }
      this._indexTimer = setTimeout(() => {
        void this.rebuildFileIndex()
      }, 400)
    }
  }
})
