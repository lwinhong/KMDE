export interface FileNode {
  name: string
  path: string
  isDir: boolean
  ext: string
  size: number
}

export interface ReadFileResult {
  content: string
  mtimeMs: number
}

export interface WriteFileResult {
  mtimeMs: number
}

export type FsEventType = 'add' | 'change' | 'unlink' | 'addDir' | 'unlinkDir'

export interface FsEvent {
  type: FsEventType
  path: string
  mtimeMs?: number
}

export interface AppSettings {
  theme: 'light' | 'dark'
  fontSize: number
  defaultMode: 'wysiwyg' | 'source'
  sidebarVisible: boolean
  outlineVisible: boolean
  lastWorkspace: string | null
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  fontSize: 15,
  defaultMode: 'wysiwyg',
  sidebarVisible: true,
  outlineVisible: true,
  lastWorkspace: null
}

export interface OutlineItem {
  id: string
  level: number
  text: string
  pos?: number
  line?: number
}

export type EditorMode = 'wysiwyg' | 'source'

export type MenuCommand =
  | 'new-file'
  | 'open-file'
  | 'open-folder'
  | 'save'
  | 'save-as'
  | 'export'
  | 'toggle-mode'
  | 'toggle-sidebar'
  | 'toggle-outline'
  | 'toggle-theme'
  | 'quick-open'
  | 'command-palette'
  | 'close-tab'
  | 'show-settings-info'

export const MAX_WYSIWYG_FILE_SIZE = 2 * 1024 * 1024

export const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'out', '.hvigor'])
