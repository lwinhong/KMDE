import { app, BrowserWindow, protocol, shell, session } from 'electron'
import { join } from 'path'
import { existsSync, statSync } from 'fs'
import { registerIpcHandlers, sendToRenderer } from './ipc'
import { createAppMenu } from './menu'

const MD_EXTENSIONS = ['.md', '.markdown', '.mdown']

// isolate dev userData from an installed production KMDE instance
// (they would otherwise fight over the same single-instance lock)
if (!app.isPackaged) {
  app.setPath('userData', join(app.getPath('appData'), 'kmde-dev'))
}

let mainWindow: BrowserWindow | null = null

function extractMdPathFromArgv(argv: string[]): string | null {
  for (let i = argv.length - 1; i >= 0; i--) {
    const arg = argv[i]
    if (!arg || !arg.endsWith && !arg.toLowerCase) continue
    const lower = arg.toLowerCase()
    if (!MD_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue
    try {
      if (existsSync(arg) && statSync(arg).isFile()) {
        return arg
      }
    } catch {
      // ignore
    }
  }
  return null
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    autoHideMenuBar: false,
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
  app.on('second-instance', (_event, argv) => {
    const mdPath = extractMdPathFromArgv(argv)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
      if (mdPath) {
        sendToRenderer('app:open-file', mdPath)
      }
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

  void app.whenReady().then(() => {
    registerIpcHandlers()
    createAppMenu()
    createWindow()

    const initialFile = extractMdPathFromArgv(process.argv)
    if (initialFile && mainWindow) {
      const target = initialFile
      mainWindow.webContents.once('did-finish-load', () => {
        sendToRenderer('app:open-file', target)
      })
    }

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
