import { Menu, app, shell } from 'electron'
import type { MenuItemConstructorOptions } from 'electron'
import { sendToRenderer } from './ipc'
import type { MenuCommand } from '../shared/types'

const isMac = process.platform === 'darwin'

function cmd(command: MenuCommand, label: string, accelerator?: string): MenuItemConstructorOptions {
  return {
    label,
    accelerator,
    click: () => sendToRenderer('menu:command', command)
  }
}

export function createAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: '文件',
      submenu: [
        cmd('new-file', '新建文件', 'CmdOrCtrl+N'),
        { type: 'separator' },
        cmd('open-file', '打开文件...', 'CmdOrCtrl+O'),
        cmd('open-folder', '打开文件夹...', 'CmdOrCtrl+Shift+O'),
        { type: 'separator' },
        cmd('save', '保存', 'CmdOrCtrl+S'),
        cmd('save-as', '另存为...', 'CmdOrCtrl+Shift+S'),
        { type: 'separator' },
        cmd('export', '导出...', 'CmdOrCtrl+Shift+E'),
        { type: 'separator' },
        { label: '退出', accelerator: 'CmdOrCtrl+Q', role: 'quit' }
      ]
    },
    {
      label: '编辑',
      submenu: [
        { label: '撤销', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: '重做', accelerator: 'CmdOrCtrl+Y', role: 'redo' },
        { type: 'separator' },
        { label: '剪切', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: '复制', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: '粘贴', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: '全选', accelerator: 'CmdOrCtrl+A', role: 'selectAll' },
        { type: 'separator' },
        cmd('close-tab', '关闭标签页', 'CmdOrCtrl+W')
      ]
    },
    {
      label: '视图',
      submenu: [
        cmd('toggle-mode', '切换 源码/所见即所得 模式', 'CmdOrCtrl+/'),
        { type: 'separator' },
        cmd('toggle-sidebar', '切换侧边栏', 'CmdOrCtrl+\\'),
        cmd('toggle-outline', '切换大纲面板', 'CmdOrCtrl+Shift+U'),
        cmd('toggle-theme', '切换深色/浅色主题', 'F11'),
        { type: 'separator' },
        cmd('quick-open', '快速打开文件', 'CmdOrCtrl+P'),
        cmd('command-palette', '命令面板', 'CmdOrCtrl+Shift+P'),
        { type: 'separator' },
        { label: '重新加载', accelerator: 'CmdOrCtrl+R', role: 'reload' },
        { label: '开发者工具', accelerator: 'F12', role: 'toggleDevTools' },
        { label: '放大', accelerator: 'CmdOrCtrl+=', role: 'zoomIn' },
        { label: '缩小', accelerator: 'CmdOrCtrl+-', role: 'zoomOut' },
        { label: '重置缩放', accelerator: 'CmdOrCtrl+0', role: 'resetZoom' }
      ]
    },
    {
      label: '帮助',
      submenu: [
        {
          label: '关于 KMDE',
          click: () => {
            sendToRenderer('menu:command', 'show-settings-info')
          }
        },
        {
          label: 'Tiptap 官网',
          click: () => void shell.openExternal('https://tiptap.dev')
        }
      ]
    }
  ]

  if (isMac) {
    template.unshift({
      label: app.name,
      submenu: [
        { label: '关于', role: 'about' },
        { type: 'separator' },
        { label: '服务', role: 'services' },
        { type: 'separator' },
        { label: '隐藏', role: 'hide' },
        { label: '隐藏其他', role: 'hideOthers' },
        { type: 'separator' },
        { label: '退出', role: 'quit' }
      ]
    })
  }

  const menu = Menu.buildFromTemplate(template)
  Menu.setApplicationMenu(menu)
}
