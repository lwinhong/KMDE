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

export type AppLocale = 'zh-CN' | 'en-US'

export const APP_LOCALES: AppLocale[] = ['zh-CN', 'en-US']

export interface AppSettings {
  theme: 'light' | 'dark'
  fontSize: number
  defaultMode: 'wysiwyg' | 'source'
  sidebarVisible: boolean
  outlineVisible: boolean
  sidebarWidth: number
  outlineWidth: number
  lastWorkspace: string | null
  language: AppLocale
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  fontSize: 15,
  defaultMode: 'wysiwyg',
  sidebarVisible: true,
  outlineVisible: true,
  sidebarWidth: 240,
  outlineWidth: 220,
  lastWorkspace: null,
  language: 'zh-CN'
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
  | `set-language:${AppLocale}`

export const MAX_WYSIWYG_FILE_SIZE = 2 * 1024 * 1024

export const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'out', '.hvigor'])
