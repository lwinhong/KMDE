import { app, BrowserWindow, ipcMain, protocol, shell, session } from 'electron'
import { join, resolve } from 'path'
import { existsSync, statSync } from 'fs'
import { registerIpcHandlers } from './ipc'
import { createAppMenu } from './menu'
import { readSettings, setCurrentLocale } from './settings'
import { APP_LOCALES } from '../shared/types'
import type { AppLocale } from '../shared/types'

const MD_EXTENSIONS = ['.md', '.markdown', '.mdown']

// isolate dev userData from an installed production KMDE instance
// (they would otherwise fight over the same single-instance lock)
if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'kmde-dev'))
}

let mainWindow: BrowserWindow | null = null
let readyToClose = false
let rendererIsReady = false
let openFileFlushScheduled = false
const pendingOpenFiles: string[] = []

function scheduleOpenFiles(): void {
  if (!rendererIsReady || openFileFlushScheduled) return
  openFileFlushScheduled = true
  // 握手返回后再异步发送，避免渲染端尚未完成会话恢复或监听注册。
  setImmediate(() => {
    openFileFlushScheduled = false
    const win = mainWindow
    if (!rendererIsReady || !win || win.isDestroyed() || win.webContents.isDestroyed()) return
    while (pendingOpenFiles.length > 0) {
      win.webContents.send('app:open-file', pendingOpenFiles[0])
      pendingOpenFiles.shift()
    }
  })
}

function queueOpenFile(path: string): void {
  pendingOpenFiles.push(path)
  scheduleOpenFiles()
}

function extractMdPathFromArgv(argv: string[], workingDirectory = process.cwd()): string | null {
  for (let i = argv.length - 1; i >= 0; i--) {
    const arg = argv[i]
    if (!arg || !arg.endsWith && !arg.toLowerCase) continue
    const lower = arg.toLowerCase()
    if (!MD_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue
    try {
      const path = resolve(workingDirectory, arg)
      if (existsSync(path) && statSync(path).isFile()) {
        return path
      }
    } catch {
      // ignore
    }
  }
  return null
}

function createWindow(): void {
  readyToClose = false
  rendererIsReady = false
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  const win = mainWindow
  win.webContents.on('did-start-loading', () => {
    if (mainWindow === win) rendererIsReady = false
  })
  win.on('closed', () => {
    if (mainWindow === win) {
      mainWindow = null
      rendererIsReady = false
    }
  })

  // intercept native close (Alt+F4 / taskbar) so the renderer can
  // prompt for unsaved tabs before actually quitting
  mainWindow.on('close', (event) => {
    if (readyToClose) return
    if (!mainWindow || mainWindow.isDestroyed()) return
    event.preventDefault()
    mainWindow.webContents.send('app:request-close')
  })

  mainWindow.on('maximize', () => {
    mainWindow?.webContents.send('window:state', true)
  })
  mainWindow.on('unmaximize', () => {
    mainWindow?.webContents.send('window:state', false)
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; img-src 'self' data: blob: kmd-file: https:; font-src 'self' data: https://cdn.jsdelivr.net; connect-src 'self'"
          ]
        }
      })
    })
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

const gotSingleInstanceLock = app.requestSingleInstanceLock()

process.on('uncaughtException', (err) => {
  console.error('[kmde-main] uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  console.error('[kmde-main] unhandledRejection:', reason)
})

if (!gotSingleInstanceLock) {
  app.quit()
} else {
  const initialFile = extractMdPathFromArgv(process.argv)
  if (initialFile) queueOpenFile(initialFile)

  app.on('second-instance', (_event, argv, workingDirectory) => {
    const mdPath = extractMdPathFromArgv(argv, workingDirectory)
    if (mdPath) queueOpenFile(mdPath)
    if (!mainWindow && app.isReady()) createWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'kmd-file',
      privileges: {
        standard: true,
        secure: true,
        supportFetchAPI: true,
        stream: true
      }
    }
  ])

  void app.whenReady().then(async () => {
    registerIpcHandlers()
    ipcMain.handle('app:renderer-ready', (event): void => {
      const win = mainWindow
      if (!win || win.isDestroyed() || event.sender !== win.webContents ||
        event.senderFrame !== win.webContents.mainFrame) {
        throw new Error('仅允许主窗口的主框架声明渲染就绪')
      }
      rendererIsReady = true
      scheduleOpenFiles()
    })
    const settings = await readSettings()
    setCurrentLocale(settings.language)
    createAppMenu()
    if (!mainWindow) createWindow()

    ipcMain.handle('app:set-locale', (_e, locale: unknown): boolean => {
      if (typeof locale === 'string' && (APP_LOCALES as string[]).includes(locale)) {
        setCurrentLocale(locale as AppLocale)
        createAppMenu()
        return true
      }
      return false
    })

    // ---- custom title bar window controls ----
    ipcMain.on('window:minimize', (event) => {
      BrowserWindow.fromWebContents(event.sender)?.minimize()
    })
    ipcMain.on('window:toggle-maximize', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return
      if (win.isMaximized()) {
        win.unmaximize()
      } else {
        win.maximize()
      }
    })
    ipcMain.on('window:close', (event) => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return
      if (win === mainWindow) {
        readyToClose = true
      }
      win.close()
    })
    ipcMain.handle('window:is-maximized', (event): boolean => {
      const win = BrowserWindow.fromWebContents(event.sender)
      return win ? win.isMaximized() : false
    })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow()
      }
    })
  })
}

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
