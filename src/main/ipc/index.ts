import { app, BrowserWindow, dialog, ipcMain, protocol, shell } from 'electron'
import { promises as fs, createReadStream, existsSync, statSync } from 'fs'
import { join, extname, isAbsolute, resolve, dirname } from 'path'
import type { AppSettings, FileNode } from '../../shared/types'
import { WatcherManager } from '../watcher'
import { t } from '../i18n'
import { readSettings, writeSettings } from '../settings'

export function sendToRenderer(channel: string, ...args: unknown[]): void {
  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed())
  if (win) {
    win.webContents.send(channel, ...args)
  }
}

const watcherManager = new WatcherManager((event) => {
  sendToRenderer('fs:event', event)
})

function isIgnoredName(name: string): boolean {
  return name === 'node_modules' || name === '.git' || name === 'dist' || name === 'out' || name === '.hvigor'
}

function validatePath(p: unknown): string {
  if (typeof p !== 'string' || p.length === 0 || p.includes('\0')) {
    throw new Error(t('errors.illegalPath'))
  }
  const resolved = resolve(p)
  if (!isAbsolute(resolved)) {
    throw new Error(t('errors.mustBeAbsolute'))
  }
  return resolved
}

async function listDir(dir: string): Promise<FileNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (const entry of entries) {
    if (entry.name.startsWith('.') || isIgnoredName(entry.name)) continue
    const fullPath = join(dir, entry.name)
    let size = 0
    try {
      if (entry.isFile()) {
        size = (await fs.stat(fullPath)).size
      }
    } catch {
      // file may vanish
    }
    nodes.push({
      name: entry.name,
      path: fullPath,
      isDir: entry.isDirectory(),
      ext: entry.isDirectory() ? '' : extname(entry.name).toLowerCase(),
      size
    })
  }
  nodes.sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
  return nodes
}

function registerFsIpc(): void {
  ipcMain.handle('fs:listDir', (_e, dir: string) => listDir(validatePath(dir)))

  ipcMain.handle(
    'fs:readFile',
    (_e, path: string): Promise<{ content: string; mtimeMs: number }> =>
      (async () => {
        const p = validatePath(path)
        const stats = await fs.stat(p)
        if (!stats.isFile()) throw new Error(t('errors.notAFile'))
        if (stats.size > 64 * 1024 * 1024) throw new Error(t('errors.fileTooLarge'))
        const content = await fs.readFile(p, 'utf-8')
        return { content, mtimeMs: stats.mtimeMs }
      })()
  )

  ipcMain.handle(
    'fs:writeFile',
    (_e, path: string, content: string): Promise<{ mtimeMs: number }> =>
      (async () => {
        const p = validatePath(path)
        await fs.writeFile(p, content, 'utf-8')
        const mtimeMs = (await fs.stat(p)).mtimeMs
        watcherManager.markSelfWrite(p, mtimeMs)
        return { mtimeMs }
      })()
  )

  ipcMain.handle(
    'fs:writeBinary',
    (_e, path: string, data: Uint8Array): Promise<string> =>
      (async () => {
        const p = validatePath(path)
        await fs.mkdir(dirname(p), { recursive: true })
        await fs.writeFile(p, Buffer.from(data))
        return p
      })()
  )

  ipcMain.handle(
    'fs:createEntry',
    (_e, parentDir: string, name: string, type: 'file' | 'dir') =>
      (async () => {
        const dir = validatePath(parentDir)
        if (typeof name !== 'string' || name.length === 0 || /[\\/:*?"<>|]/.test(name)) {
          throw new Error(t('errors.illegalName'))
        }
        const target = join(dir, name)
        if (existsSync(target)) throw new Error(t('errors.entryExists'))
        if (type === 'file') {
          await fs.writeFile(target, '', 'utf-8')
        } else {
          await fs.mkdir(target)
        }
        return { name, path: target, isDir: type === 'dir', ext: type === 'file' ? extname(name).toLowerCase() : '', size: 0 }
      })()
  )

  ipcMain.handle('fs:rename', (_e, oldPath: string, newPath: string) =>
    (async () => {
      const from = validatePath(oldPath)
      const to = validatePath(newPath)
      if (existsSync(to)) throw new Error(t('errors.targetExists'))
      await fs.rename(from, to)
      return true
    })()
  )

  ipcMain.handle('fs:remove', (_e, path: string) =>
    (async () => {
      const p = validatePath(path)
      await shell.trashItem(p)
      return true
    })()
  )

  ipcMain.handle('fs:exists', (_e, path: string) =>
    (async () => {
      try {
        return existsSync(validatePath(path))
      } catch {
        return false
      }
    })()
  )

  ipcMain.handle('fs:watch', (_e, root: string) => {
    watcherManager.watch(validatePath(root))
    return true
  })

  ipcMain.handle('fs:unwatch', () => {
    watcherManager.stop()
    return true
  })

  ipcMain.handle('fs:fileSize', (_e, path: string) =>
    (async () => {
      const stats = await fs.stat(validatePath(path))
      return stats.size
    })()
  )
}

function registerDialogIpc(): void {
  ipcMain.handle('dialog:openFile', async () => {
    const result = await dialog.showOpenDialog({
      title: t('dialog.openMdFile'),
      properties: ['openFile'],
      filters: [
        { name: 'Markdown', extensions: ['md', 'markdown', 'mdown', 'txt'] },
        { name: t('dialog.allFiles'), extensions: ['*'] }
      ]
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:openFolder', async () => {
    const result = await dialog.showOpenDialog({
      title: t('dialog.openFolder'),
      properties: ['openDirectory']
    })
    return result.canceled ? null : result.filePaths[0]
  })

  ipcMain.handle('dialog:saveAs', async (_e, defaultName: string) => {
    const result = await dialog.showSaveDialog({
      title: t('dialog.saveAs'),
      defaultPath: typeof defaultName === 'string' ? defaultName : 'untitled.md',
      filters: [{ name: 'Markdown', extensions: ['md', 'markdown'] }]
    })
    return result.canceled ? null : result.filePath
  })
}

function registerSettingsIpc(): void {
  ipcMain.handle('settings:load', async (): Promise<AppSettings> => readSettings())

  ipcMain.handle('settings:save', async (_e, settings: AppSettings) => {
    await writeSettings(settings)
    return true
  })
}

const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif'
}

function registerProtocolHandler(): void {
  protocol.handle('kmd-file', (request) => {
    try {
      const url = new URL(request.url)
      let filePath = decodeURIComponent(url.pathname)
      if (process.platform === 'win32' && /^\/[a-zA-Z]:/.test(filePath)) {
        filePath = filePath.slice(1)
      }
      const ext = extname(filePath).toLowerCase()
      const mime = IMAGE_MIME[ext]
      if (!mime) {
        return new Response('unsupported type', { status: 400 })
      }
      if (!existsSync(filePath) || !statSync(filePath).isFile()) {
        return new Response('not found', { status: 404 })
      }
      const stream = createReadStream(filePath)
      return new Response(stream as unknown as ReadableStream, {
        headers: { 'Content-Type': mime, 'Cache-Control': 'no-cache' }
      })
    } catch (err) {
      return new Response(`error: ${String(err)}`, { status: 500 })
    }
  })
}

function resolveExportAssetsDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'export-assets')
  }
  return join(app.getAppPath(), 'resources', 'export-assets')
}

async function copyExportAssets(targetAssetsDir: string): Promise<void> {
  const src = resolveExportAssetsDir()
  try {
    await fs.access(src)
  } catch {
    throw new Error(t('errors.exportAssetsMissing'))
  }
  await fs.cp(src, targetAssetsDir, { recursive: true })
}

function registerExportIpc(): void {
  ipcMain.handle('export:saveHtml', async (_e, html: string, outPath: string) => {
    const p = validatePath(outPath)
    await fs.writeFile(p, html, 'utf-8')
    await copyExportAssets(join(dirname(p), 'KMDE-assets'))
    return p
  })

  ipcMain.handle('export:pdf', async (_e, html: string, outPath: string): Promise<string> => {
    const p = validatePath(outPath)
    const tmpDir = join(process.env['TEMP'] ?? process.cwd(), `kmde-export-${Date.now()}`)
    await fs.mkdir(tmpDir, { recursive: true })
    const tmpHtml = join(tmpDir, 'index.html')
    await fs.writeFile(tmpHtml, html, 'utf-8')
    await copyExportAssets(join(tmpDir, 'KMDE-assets'))
    const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } })
    try {
      await win.loadFile(tmpHtml)
      // wait for mermaid async render if present
      const deadline = Date.now() + 10000
      for (;;) {
        const ready = await win.webContents.executeJavaScript('window.__exportReady === true')
        if (ready || Date.now() > deadline) break
        await new Promise((r) => setTimeout(r, 200))
      }
      const pdfBuffer = await win.webContents.printToPDF({
        printBackground: true,
        preferCSSPageSize: true
      })
      await fs.writeFile(p, pdfBuffer)
      return p
    } finally {
      win.destroy()
      await fs.rm(tmpDir, { recursive: true, force: true })
    }
  })
}

export function registerIpcHandlers(): void {
  registerProtocolHandler()
  registerFsIpc()
  registerDialogIpc()
  registerSettingsIpc()
  registerExportIpc()
}
