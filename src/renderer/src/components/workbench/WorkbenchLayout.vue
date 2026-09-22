<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '../../stores/settings.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import type { MenuCommand, FsEvent, OutlineItem } from '@shared/types'
import type { EditorTab } from '../../stores/tabs.store'
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
import AboutDialog from './AboutDialog.vue'
import Resizer from './Resizer.vue'

const settings = useSettingsStore()
const tabs = useTabsStore()
const workspace = useWorkspaceStore()
const message = useMessage()
const { t } = useI18n()

const editorAreaRef = ref<InstanceType<typeof EditorArea> | null>(null)
const paletteRef = ref<InstanceType<typeof CommandPalette> | null>(null)
const exportRef = ref<InstanceType<typeof ExportDialog> | null>(null)
const aboutRef = ref<InstanceType<typeof AboutDialog> | null>(null)

const outlineItems = ref<OutlineItem[]>([])
const outlineActiveId = ref<string | null>(null)

watch(
  () => tabs.activeTabId,
  () => {
    outlineItems.value = []
    outlineActiveId.value = null
  }
)

const paletteCommands = computed<PaletteCommand[]>(() => [
  { id: 'new-file', title: t('palette.newFile'), shortcut: 'Ctrl+N' },
  { id: 'open-file', title: t('palette.openFile'), shortcut: 'Ctrl+O' },
  { id: 'open-folder', title: t('palette.openFolder'), shortcut: 'Ctrl+K Ctrl+O' },
  { id: 'save', title: t('palette.save'), shortcut: 'Ctrl+S' },
  { id: 'save-as', title: t('palette.saveAs'), shortcut: 'Ctrl+Shift+S' },
  { id: 'export', title: t('palette.export'), shortcut: 'Ctrl+Shift+E' },
  { id: 'toggle-mode', title: t('palette.toggleMode'), shortcut: 'Ctrl+/' },
  { id: 'toggle-sidebar', title: t('palette.toggleSidebar'), shortcut: 'Ctrl+\\' },
  { id: 'toggle-outline', title: t('palette.toggleOutline'), shortcut: 'Ctrl+Shift+U' },
  { id: 'toggle-theme', title: t('palette.toggleTheme'), shortcut: 'F11' },
  { id: 'quick-open', title: t('palette.quickOpen'), shortcut: 'Ctrl+P' },
  { id: 'close-tab', title: t('palette.closeTab'), shortcut: 'Ctrl+W' },
  { id: 'set-language:zh-CN', title: t('palette.switchToZh') },
  { id: 'set-language:en-US', title: t('palette.switchToEn') }
])

function runPaletteCommand(id: string): void {
  void runCommand(id as MenuCommand)
}

// ---------------- file actions ----------------

async function openFileByPath(path: string): Promise<void> {
  try {
    await tabs.openPath(path)
  } catch (err) {
    message.error(t('notify.openFileFailed', { msg: err instanceof Error ? err.message : String(err) }))
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
      message.error(t('notify.openFolderFailed', { msg: err instanceof Error ? err.message : String(err) }))
    }
  }
}

async function openLastWorkspace(): Promise<void> {
  if (settings.lastWorkspace) {
    try {
      await workspace.openFolder(settings.lastWorkspace)
    } catch {
      message.error(t('notify.restoreWorkspaceFailed'))
    }
  }
}

async function newFile(): Promise<void> {
  tabs.newUntitled()
}

// ---------------- command dispatch ----------------

async function runCommand(command: MenuCommand): Promise<void> {
  if (command.startsWith('set-language:')) {
    const locale = command.slice('set-language:'.length)
    if (locale === 'zh-CN' || locale === 'en-US') {
      settings.setLanguage(locale)
    }
    return
  }
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
        message.error(t('notify.saveFailed'))
      } else if (result === 'saved') {
        message.success(t('notify.saved'))
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
          message.success(t('notify.saved'))
        } else if (result === 'error') {
          message.error(t('notify.saveFailed'))
        }
      }
      break
    }
    case 'export': {
      const tab = tabs.activeTab
      if (!tab) {
        message.warning(t('notify.openFileFirst'))
        break
      }
      if (!tab.path) {
        message.warning(t('notify.saveBeforeExport'))
        break
      }
      if (tab.loading) {
        message.warning(t('notify.fileLoading'))
        break
      }
      exportRef.value?.open(tab)
      break
    }
    case 'toggle-mode': {
      const tab = tabs.activeTab
      if (!tab || tab.loading) break
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
      aboutRef.value?.open()
      break
  }
}

async function closeTab(id: string): Promise<void> {
  const tab = tabs.tabs.find((t) => t.id === id)
  if (!tab) return
  if (tab.dirty && !isPristineUntitled(tab)) {
    // naive-ui dialog via window.confirm would be ugly; use a lightweight confirm
    const ok = window.confirm(t('notify.unsavedCloseConfirm', { name: tab.fileName }))
    if (ok) {
      const saved = await tabs.flushSave(id)
      if (!saved) return
    }
  }
  tabs.removeTab(id)
}

function isPristineUntitled(tab: EditorTab): boolean {
  return tab.path === null && tab.markdown === '' && !tab.deleted
}

async function requestCloseApp(): Promise<void> {
  for (const tab of [...tabs.tabs]) {
    if ((tab.dirty || tab.deleted) && !isPristineUntitled(tab)) {
      const ok = window.confirm(t('notify.unsavedCloseConfirm', { name: tab.fileName }))
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
          message.info(t('notify.fileReloaded', { name: tab.fileName }))
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

function onSidebarResize(delta: number): void {
  settings.sidebarWidth = Math.min(600, Math.max(160, settings.sidebarWidth + delta))
}

function onOutlineResize(delta: number): void {
  settings.outlineWidth = Math.min(600, Math.max(160, settings.outlineWidth + delta))
}
</script>

<template>
  <div class="workbench" @dragover.prevent @drop.prevent="handleDrop">
    <TitleBar @command="runCommand" @request-close="requestCloseApp" />
    <TabBar
      v-if="tabs.activeTab"
      @open-file="openFilePicker"
      @open-folder="openFolderPicker"
      @new-file="newFile()"
      @close-tab="closeTab"
    />
    <div class="workbench-main">
      <div
        v-if="!settings.sidebarVisible"
        class="panel-edge edge-left"
        :title="t('sidebar.expand')"
        @click="settings.toggleSidebar()"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </div>
      <FileTree v-if="settings.sidebarVisible" @open-file="openFileByPath" />
      <Resizer
        v-if="settings.sidebarVisible"
        side="left"
        @resize="onSidebarResize"
        @resize-end="settings.persist()"
      />
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
      <Resizer
        v-if="settings.outlineVisible && tabs.activeTab"
        side="right"
        @resize="onOutlineResize"
        @resize-end="settings.persist()"
      />
      <OutlinePanel
        v-if="settings.outlineVisible && tabs.activeTab"
        :items="outlineItems"
        :active-id="outlineActiveId"
        @jump="handleOutlineJump"
      />
      <div
        v-if="!settings.outlineVisible && tabs.activeTab"
        class="panel-edge edge-right"
        :title="t('outline.expand')"
        @click="settings.toggleOutline()"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </div>
    </div>
    <StatusBar />
    <CommandPalette ref="paletteRef" :commands="paletteCommands" @run-command="runPaletteCommand" @open-file="openFileByPath" />
    <ConflictDialog />
    <ExportDialog ref="exportRef" />
    <AboutDialog ref="aboutRef" />
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

.panel-edge {
  width: 28px;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--kme-bg-sidebar);
  color: var(--kme-text-3);
  cursor: pointer;
  user-select: none;
}

.panel-edge.edge-left {
  border-right: 1px solid var(--kme-border-light);
}

.panel-edge.edge-right {
  border-left: 1px solid var(--kme-border-light);
}

.panel-edge:hover {
  background: var(--kme-bg-hover);
  color: var(--kme-text-1);
}
</style>
