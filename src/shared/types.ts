export interface FileNode {
  name: string
  path: string
  isDir: boolean
  ext: string
  size?: number
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
  defaultMode: EditorMode
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

export type EditorMode = 'wysiwyg' | 'source' | 'split'

/** 单侧编辑面板的坐标系；分屏模式下左右面板各属其一，光标坐标不能互换。 */
export type EditorPaneMode = 'wysiwyg' | 'source'

export interface EditorSelectionState {
  mode: EditorPaneMode
  anchor: number
  head: number
}

export interface SessionTab {
  id: string
  path: string | null
  fileName: string
  markdown: string
  dirty: boolean
  mode: EditorMode
  savedMtimeMs: number
  deleted: boolean
  selection?: EditorSelectionState
}

export interface EditorSession {
  version: 1
  tabs: SessionTab[]
  activeTabId: string | null
  untitledSeq: number
}

export interface SessionSaveOptions {
  discardDraftIds?: string[]
}

export interface SessionSaveResult {
  cleanupPending: boolean
}

export type MenuCommand =
  | 'new-file'
  | 'open-file'
  | 'open-folder'
  | 'close-folder'
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
  | 'reload'
  | `set-language:${AppLocale}`

export const MAX_WYSIWYG_FILE_SIZE = 2 * 1024 * 1024

export const SUPPORTED_DOCUMENT_EXTENSIONS: ReadonlySet<string> = new Set(['.md', '.markdown', '.mdown', '.txt'])

export const IGNORED_DIR_NAMES = new Set(['node_modules', '.git', 'dist', 'out', '.hvigor'])

/** 快速打开索引条目（主进程构建，渲染进程只读） */
export interface QuickOpenEntry {
  path: string
  fileName: string
  relPath: string
}

/** 工作区索引分块：主进程流式推送，done=true 表示本次扫描结束 */
export interface WorkspaceIndexChunk {
  generation: number
  entries: QuickOpenEntry[]
  done: boolean
}
