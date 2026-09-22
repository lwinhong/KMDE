<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref } from 'vue'
import { useMessage } from 'naive-ui'
import { useSettingsStore } from '../../stores/settings.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import type { MenuCommand, FsEvent, OutlineItem } from '@shared/types'
import TabBar from './TabBar.vue'
import TitleBar from './TitleBar.vue'
import StatusBar from './StatusBar.vue'
import WelcomePage from './WelcomePage.vue'
import FileTree from '../sidebar/FileTree.vue'
import OutlinePanel from '../outline/OutlinePanel.vue'
import EditorArea from '../editor/EditorArea.vue'
import CommandPalette, { type PaletteCommand } from '../palette/CommandPalette.vue'
import ConflictDialog from '../conflict/ConflictDialog.vue'
import ExportDialog from '../export/ExportDialog.vue'

const settings = useSettingsStore()
const tabs = useTabsStore()
const workspace = useWorkspaceStore()
const message = useMessage()

const editorAreaRef = ref<InstanceType<typeof EditorArea> | null>(null)
const paletteRef = ref<InstanceType<typeof CommandPalette> | null>(null)
const exportRef = ref<InstanceType<typeof ExportDialog> | null>(null)

const outlineItems = ref<OutlineItem[]>([])
const outlineActiveId = ref<string | null>(null)

const paletteCommands: PaletteCommand[] = [
  { id: 'new-file', title: '新建文件', shortcut: 'Ctrl+N' },
  { id: 'open-file', title: '打开文件…', shortcut: 'Ctrl+O' },
  { id: 'open-folder', title: '打开文件夹…', shortcut: 'Ctrl+K Ctrl+O' },
  { id: 'save', title: '保存', shortcut: 'Ctrl+S' },
  { id: 'save-as', title: '另存为…', shortcut: 'Ctrl+Shift+S' },
  { id: 'export', title: '导出 HTML / PDF…', shortcut: 'Ctrl+Shift+E' },
  { id: 'toggle-mode', title: '切换 源码 / 所见即所得 模式', shortcut: 'Ctrl+/' },
  { id: 'toggle-sidebar', title: '显示 / 隐藏 侧边栏', shortcut: 'Ctrl+\\' },
  { id: 'toggle-outline', title: '显示 / 隐藏 大纲面板', shortcut: 'Ctrl+Shift+U' },
  { id: 'toggle-theme', title: '切换 明亮 / 暗黑 主题', shortcut: 'F11' },
  { id: 'quick-open', title: '快速打开文件…', shortcut: 'Ctrl+P' },
  { id: 'close-tab', title: '关闭当前标签页', shortcut: 'Ctrl+W' }
]

function runPaletteCommand(id: string): void {
  void runCommand(id as MenuCommand)
}

// ---------------- file actions ----------------

async function openFileByPath(path: string): Promise<void> {
  try {
    await tabs.openPath(path)
  } catch (err) {
    message.error(`打开文件失败: ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function openFilePicker(): Promise<void> {
  const path = await window.kmde.openFileDialog()
  if (path) {
    await openFileByPath(path)
  }
}

async function openFolderPicker(): Promise<void> {
  const path = await window.kmde.openFolderDialog()
  if (path) {
    try {
      await workspace.openFolder(path)
    } catch (err) {
      message.error(`打开文件夹失败: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
}

async function openLastWorkspace(): Promise<void> {
  if (settings.lastWorkspace) {
    try {
      await workspace.openFolder(settings.lastWorkspace)
    } catch {
      message.error('无法恢复上次的工作区')
    }
  }
}

async function newFile(): Promise<void> {
  tabs.newUntitled()
}

// ---------------- command dispatch ----------------

async function runCommand(command: MenuCommand): Promise<void> {
  switch (command) {
    case 'new-file':
      await newFile()
      break
    case 'open-file':
      await openFilePicker()
      break
    case 'open-folder':
      await openFolderPicker()
      break
    case 'save': {
      const tab = tabs.activeTab
      if (!tab) break
      const result = await tabs.saveTab(tab.id)
      if (result === 'need-path') {
        await runCommand('save-as')
      } else if (result === 'error') {
        message.error('保存失败')
      } else {
        message.success('已保存')
      }
      break
    }
    case 'save-as': {
      const tab = tabs.activeTab
      if (!tab) break
      const target = await window.kmde.saveAsDialog(tab.fileName.endsWith('.md') ? tab.fileName : `${tab.fileName}.md`)
      if (target) {
        const result = await tabs.saveTabAs(tab.id, target)
        if (result === 'saved') {
          message.success('已保存')
        } else {
          message.error('保存失败')
        }
      }
      break
    }
    case 'export': {
      const tab = tabs.activeTab
      if (!tab) {
        message.warning('请先打开一个文件')
        break
      }
      if (!tab.path) {
        message.warning('请先保存文件后再导出')
        break
      }
      exportRef.value?.open(tab)
      break
    }
    case 'toggle-mode': {
      const tab = tabs.activeTab
      if (!tab) break
      editorAreaRef.value?.flushActive()
      tabs.toggleMode(tab.id)
      break
    }
    case 'toggle-sidebar':
      settings.toggleSidebar()
      break
    case 'toggle-outline':
      settings.toggleOutline()
      break
    case 'toggle-theme':
      settings.toggleTheme()
      break
    case 'quick-open':
      paletteRef.value?.open('files')
      break
    case 'command-palette':
      paletteRef.value?.open('commands')
      break
    case 'close-tab': {
      const tab = tabs.activeTab
      if (!tab) break
      await closeTab(tab.id)
      break
    }
    case 'show-settings-info':
      message.info(`KMDE v0.1.0 — Electron + Vue 3 + Tiptap + CodeMirror 6`)
      break
  }
}

async function closeTab(id: string): Promise<void> {
  const tab = tabs.tabs.find((t) => t.id === id)
  if (!tab) return
  if (tab.dirty) {
    // naive-ui dialog via window.confirm would be ugly; use a lightweight confirm
    const ok = window.confirm(`「${tab.fileName}」有未保存的修改，是否保存并关闭？`)
    if (ok) {
      const saved = await tabs.flushSave(id)
      if (!saved) return
    }
  }
  tabs.removeTab(id)
}

async function requestCloseApp(): Promise<void> {
  for (const tab of [...tabs.tabs]) {
    if (tab.dirty || tab.deleted) {
      const ok = window.confirm(`「${tab.fileName}」有未保存的修改，是否保存并关闭？`)
      if (ok) {
        const saved = await tabs.flushSave(tab.id)
        if (!saved) return
      }
    }
  }
  window.kmde.closeWindow()
}

// ---------------- external events ----------------

let unsubs: Array<() => void> = []

async function handleFsEvent(ev: FsEvent): Promise<void> {
  switch (ev.type) {
    case 'add':
    case 'addDir':
    case 'unlinkDir':
      workspace.scheduleTreeRefresh()
      break
    case 'unlink':
      workspace.scheduleTreeRefresh()
      tabs.handleExternalDelete(ev.path)
      break
    case 'change': {
      const tab = tabs.byPath(ev.path)
      if (!tab) break
      try {
        const { content, mtimeMs } = await window.kmde.readFile(ev.path)
        const result = tabs.handleExternalContent(ev.path, content, mtimeMs)
        if (result === 'reloaded' && tabs.activeTabId === tab.id) {
          message.info(`「${tab.fileName}」已在磁盘上被修改，已重新加载`)
        }
      } catch {
        // file may be mid-write; ignore
      }
      break
    }
  }
}

function handleDrop(e: DragEvent): void {
  const files = e.dataTransfer?.files
  if (!files || files.length === 0) return
  for (let i = 0; i < Math.min(files.length, 5); i++) {
    const path = window.kmde.getPathForFile(files[i])
    if (path && /\.(md|markdown|mdown|txt)$/i.test(path)) {
      void openFileByPath(path)
      return
    }
  }
}

onMounted(async () => {
  unsubs.push(
    window.kmde.onFsEvent((ev) => {
      void handleFsEvent(ev)
    }),
    window.kmde.onOpenFile((path) => {
      void openFileByPath(path)
    }),
    window.kmde.onMenuCommand((command) => {
      void runCommand(command)
    }),
    window.kmde.onAppRequestClose(() => {
      void requestCloseApp()
    })
  )

  // restore last workspace automatically
  if (settings.lastWorkspace) {
    try {
      const exists = await window.kmde.exists(settings.lastWorkspace)
      if (exists) {
        await workspace.openFolder(settings.lastWorkspace)
      }
    } catch {
      // ignore
    }
  }
})

onBeforeUnmount(() => {
  for (const unsub of unsubs) unsub()
  unsubs = []
})

function handleOutlineChange(items: OutlineItem[], activeId: string | null): void {
  outlineItems.value = items
  outlineActiveId.value = activeId
}

function handleOutlineJump(item: OutlineItem): void {
  editorAreaRef.value?.jumpTo(item)
}
</script>

<template>
  <div class="workbench" @dragover.prevent @drop.prevent="handleDrop">
    <TitleBar @command="runCommand" @request-close="requestCloseApp" />
    <TabBar @open-file="openFilePicker" @open-folder="openFolderPicker" @new-file="newFile()" @close-tab="closeTab" />
    <div class="workbench-main">
      <FileTree v-if="settings.sidebarVisible" @open-file="openFileByPath" />
      <EditorArea
        v-if="tabs.activeTab"
        ref="editorAreaRef"
        @outline-change="handleOutlineChange"
        @request-save="(id: string) => runCommand('save')"
        @request-save-as="(id: string) => runCommand('save-as')"
      />
      <WelcomePage
        v-else
        @open-file="openFilePicker"
        @open-folder="openFolderPicker"
        @new-file="newFile()"
        @resume-workspace="openLastWorkspace"
      />
      <OutlinePanel
        v-if="settings.outlineVisible && tabs.activeTab"
        :items="outlineItems"
        :active-id="outlineActiveId"
        @jump="handleOutlineJump"
      />
    </div>
    <StatusBar />
    <CommandPalette ref="paletteRef" :commands="paletteCommands" @run-command="runPaletteCommand" @open-file="openFileByPath" />
    <ConflictDialog />
    <ExportDialog ref="exportRef" />
  </div>
</template>

<style scoped>
.workbench {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--kme-bg);
  overflow: hidden;
}

.workbench-main {
  flex: 1;
  display: flex;
  min-height: 0;
  overflow: hidden;
}
</style>
