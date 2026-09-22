import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { IpcRendererEvent } from 'electron'
import type {
  AppLocale,
  AppSettings,
  FileNode,
  FsEvent,
  MenuCommand,
  ReadFileResult,
  WriteFileResult
} from '../shared/types'

function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: IpcRendererEvent, payload: T): void => {
    callback(payload)
  }
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api = {
  openFileDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
  openFolderDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder'),
  saveAsDialog: (defaultName: string): Promise<string | null> =>
    ipcRenderer.invoke('dialog:saveAs', defaultName),

  listDir: (dir: string): Promise<FileNode[]> => ipcRenderer.invoke('fs:listDir', dir),
  readFile: (path: string): Promise<ReadFileResult> => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path: string, content: string): Promise<WriteFileResult> =>
    ipcRenderer.invoke('fs:writeFile', path, content),
  writeBinaryFile: (path: string, data: Uint8Array): Promise<string> =>
    ipcRenderer.invoke('fs:writeBinary', path, data),
  createEntry: (
    parentDir: string,
    name: string,
    type: 'file' | 'dir'
  ): Promise<FileNode> => ipcRenderer.invoke('fs:createEntry', parentDir, name, type),
  renameEntry: (oldPath: string, newPath: string): Promise<boolean> =>
    ipcRenderer.invoke('fs:rename', oldPath, newPath),
  removeEntry: (path: string): Promise<boolean> => ipcRenderer.invoke('fs:remove', path),
  exists: (path: string): Promise<boolean> => ipcRenderer.invoke('fs:exists', path),
  watchWorkspace: (root: string): Promise<boolean> => ipcRenderer.invoke('fs:watch', root),
  unwatchWorkspace: (): Promise<boolean> => ipcRenderer.invoke('fs:unwatch'),

  loadSettings: (): Promise<AppSettings> => ipcRenderer.invoke('settings:load'),
  saveSettings: (settings: AppSettings): Promise<boolean> =>
    ipcRenderer.invoke('settings:save', settings),
  setLocale: (locale: AppLocale): Promise<boolean> => ipcRenderer.invoke('app:set-locale', locale),

  exportHtml: (html: string, outPath: string): Promise<string> =>
    ipcRenderer.invoke('export:saveHtml', html, outPath),
  exportPdf: (html: string, outPath: string): Promise<string> =>
    ipcRenderer.invoke('export:pdf', html, outPath),

  onFsEvent: (callback: (event: FsEvent) => void): (() => void) => subscribe<FsEvent>('fs:event', callback),
  onOpenFile: (callback: (path: string) => void): (() => void) => subscribe<string>('app:open-file', callback),
  onMenuCommand: (callback: (command: MenuCommand) => void): (() => void) =>
    subscribe<MenuCommand>('menu:command', callback),

  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  minimizeWindow: (): void => {
    ipcRenderer.send('window:minimize')
  },
  toggleMaximizeWindow: (): void => {
    ipcRenderer.send('window:toggle-maximize')
  },
  closeWindow: (): void => {
    ipcRenderer.send('window:close')
  },
  isWindowMaximized: (): Promise<boolean> => ipcRenderer.invoke('window:is-maximized'),
  onWindowState: (callback: (maximized: boolean) => void): (() => void) =>
    subscribe<boolean>('window:state', callback),
  onAppRequestClose: (callback: () => void): (() => void) => subscribe<void>('app:request-close', callback)
}

contextBridge.exposeInMainWorld('kmde', api)

export type KmdeApi = typeof api
