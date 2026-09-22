import { Menu, app, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { sendToRenderer } from './ipc'
import { t } from './i18n'
import { getCurrentLocale } from './settings'
import type { AppLocale, MenuCommand } from '../shared/types'

const isMac = process.platform === 'darwin'

function cmd(command: MenuCommand, label: string, accelerator?: string): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    click: () => sendToRenderer('menu:command', command)
  }
}

function languageItem(locale: AppLocale, label: string): MenuItemConstructorOptions {
  return {
    label,
    type: 'radio',
    checked: getCurrentLocale() === locale,
    click: () => sendToRenderer('menu:command', `set-language:${locale}`)
  }
}

export function createAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: t('menu.file'),
      submenu: [
        cmd('new-file', t('menu.newFile'), 'CmdOrCtrl+N'),
        { type: 'separator' },
        cmd('open-file', t('menu.openFile'), 'CmdOrCtrl+O'),
        cmd('open-folder', t('menu.openFolder'), 'CmdOrCtrl+Shift+O'),
        { type: 'separator' },
        cmd('save', t('menu.save'), 'CmdOrCtrl+S'),
        cmd('save-as', t('menu.saveAs'), 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        cmd('export', t('menu.export'), 'CmdOrCtrl+Shift+E'),
        { type: 'separator' },
        { label: t('menu.quit'), accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    },
    {
      label: t('menu.edit'),
      submenu: [
        { label: t('menu.undo'), accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: t('menu.redo'), accelerator: 'CmdOrCtrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: t('menu.cut'), accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: t('menu.copy'), accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: t('menu.paste'), accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: t('menu.selectAll'), accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
        { type: 'separator' },
        cmd('close-tab', t('menu.closeTab'), 'CmdOrCtrl+W')
      ]
    },
    {
      label: t('menu.view'),
      submenu: [
        cmd('toggle-mode', t('menu.toggleMode'), 'CmdOrCtrl+/'),
        { type: 'separator' },
        cmd('toggle-sidebar', t('menu.toggleSidebar'), 'CmdOrCtrl+\\'),
        cmd('toggle-outline', t('menu.toggleOutline'), 'CmdOrCtrl+Shift+U'),
        cmd('toggle-theme', t('menu.toggleTheme'), 'F11'),
        { type: 'separator' },
        {
          label: t('menu.language'),
          submenu: [
            languageItem('zh-CN', t('settings.languageZh')),
            languageItem('en-US', t('settings.languageEn'))
          ]
        },
        { type: 'separator' },
        cmd('quick-open', t('menu.quickOpen'), 'CmdOrCtrl+P'),
        cmd('command-palette', t('menu.commandPalette'), 'CmdOrCtrl+Shift+P'),
        { type: 'separator' },
        { label: t('menu.reload'), accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: t('menu.devTools'), accelerator: 'F12', role: 'toggleDevTools' },
        { label: t('menu.zoomIn'), accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: t('menu.zoomOut'), accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: t('menu.resetZoom'), accelerator: 'CmdOrCtrl+0', role: 'resetZoom' }
      ]
    },
    {
      label: t('menu.help'),
      submenu: [
        {
          label: t('menu.aboutKmde'),
          click: () => {
            sendToRenderer('menu:command', 'show-settings-info')
          }
        },
        {
          label: t('menu.tiptapSite'),
          click: () => void shell.openExternal('https://tiptap.dev')
        }
      ]
    }
  ]

  if (isMac) {
    template.unshift({
      label: app.name,
      submenu: [
        { label: t('menu.about'), role: 'about' },
        { type: 'separator' },
        { label: t('menu.services'), role: 'services' },
        { type: 'separator' },
        { label: t('menu.hide'), role: 'hide' },
        { label: t('menu.hideOthers'), role: 'hideOthers' },
        { type: 'separator' },
        { label: t('menu.quit'), role: 'quit' }
      ]
    })
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
