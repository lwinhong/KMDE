<script setup lang="ts">
import { computed, onMounted, onBeforeUnmount, ref, shallowRef, reactive, watch } from 'vue'
import { useMessage } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '../../stores/settings.store'
import { useTabsStore, MAX_TABS } from '../../stores/tabs.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import type { MenuCommand, FsEvent, OutlineItem } from '@shared/types'
import { useDocumentPersistence } from '../../composables/useDocumentPersistence'
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
const persistence = useDocumentPersistence(() => {
  if (!tabs.sessionError) message.error(t('editor.autosaveFailed'))
})
const initializing = shallowRef(true)
const closingApp = shallowRef(false)
const closingTabs = reactive(new Set<string>())
let saveDialogOpen = false

let sessionErrorNotice: ReturnType<typeof message.error> | undefined

function notifySessionError(): void {
  if (sessionErrorNotice) return
  sessionErrorNotice = message.error(t('notify.sessionSaveFailed'), {
    onAfterLeave: () => { sessionErrorNotice = undefined }
  })
}

watch(() => tabs.sessionError, (failed) => {
  if (failed) notifySessionError()
})

watch(() => tabs.cleanupPending, (pending) => {
  if (pending) message.warning(t('notify.draftCleanupPending'))
})

watch(
  () => tabs.sessionReady ? tabs.tabs.flatMap((tab) => tab.path ? [tab.path] : []) : null,
  (paths) => {
    if (paths === null) return
    void window.kmde.watchOpenFiles(paths).catch((error) => {
      console.error('[watcher] 文件监听失败:', error)
      message.warning(t('notify.fileWatchFailed'))
    })
  }
)

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
  { id: 'open-folder', title: t('palette.openFolder'), shortcut: 'Ctrl+Shift+O' },
  { id: 'close-folder', title: t('sidebar.closeWorkspace') },
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
  if (!tabs.sessionReady || closingApp.value || closingTabs.size) return
  try {
    const result = await tabs.openPath(path)
    if (!result) {
      message.warning(t('notify.tabLimitReached', { limit: MAX_TABS }))
    }
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

async function closeWorkspace(): Promise<void> {
  if (!tabs.sessionReady || closingApp.value || closingTabs.size) return
  try {
    await workspace.closeFolder()
  } catch (err) {
    message.error(t('notify.closeWorkspaceFailed', { msg: err instanceof Error ? err.message : String(err) }))
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
  if (!tabs.sessionReady || closingApp.value || closingTabs.size) return
  const result = tabs.newUntitled()
  if (!result) {
    message.warning(t('notify.tabLimitReached', { limit: MAX_TABS }))
  } else {
    // 空草稿也立即请求独立本地文件，后续编辑继续周期备份。
    if (!await persistence.flush()) notifySessionError()
  }
}

// ---------------- command dispatch ----------------

async function runCommand(command: MenuCommand): Promise<void> {
  if (!tabs.sessionReady || closingApp.value || closingTabs.size) return
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
    case 'close-folder':
      await closeWorkspace()
      break
    case 'save': {
      const tab = tabs.activeTab
      if (!tab) break
      editorAreaRef.value?.flushTab(tab.id)
      const result = await tabs.saveTab(tab.id)
      if (result === 'need-path') {
        await saveAsTab(tab.id)
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
      await saveAsTab(tab.id)
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
      editorAreaRef.value?.flushTab(tab.id)
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
    case 'reload':
      await requestCloseApp(true)
      break
  }
}

async function saveAsTab(id: string): Promise<void> {
  const tab = tabs.tabs.find((item) => item.id === id)
  if (!tab || tab.loading || saveDialogOpen) return
  saveDialogOpen = true
  try {
    const target = await window.kmde.saveAsDialog(tab.path ?? tab.fileName)
    if (!target) return
    editorAreaRef.value?.flushTab(id)
    const result = await tabs.saveTabAs(id, target)
    if (result === 'saved') message.success(t('notify.saved'))
    else if (result === 'error') message.error(t('notify.saveFailed'))
  } finally {
    saveDialogOpen = false
  }
}

async function closeTab(id: string): Promise<void> {
  const tab = tabs.tabs.find((item) => item.id === id)
  if (!tab || closingApp.value || closingTabs.size || saveDialogOpen || !tabs.sessionReady) return
  closingTabs.add(id)
  persistence.pause()
  try {
    editorAreaRef.value?.flushTab(id)
    await tabs.waitForSaves()
    editorAreaRef.value?.flushTab(id)
    if (tab.path && (tab.dirty || tab.deleted)) {
      const ok = window.confirm(t('notify.unsavedCloseConfirm', { name: tab.fileName }))
      if (ok && !await tabs.flushSave(id)) return
    }
    // 主动关闭临时标签是丢弃草稿；会话提交失败则留在原页供重试。
    if (!await tabs.closePersistedTab(id)) notifySessionError()
  } finally {
    closingTabs.delete(id)
    if (!closingTabs.size) persistence.resume()
  }
}

async function closeTabs(mode: 'all' | 'others' | 'left' | 'right', id: string): Promise<void> {
  const index = tabs.tabs.findIndex((tab) => tab.id === id)
  if (index < 0) return
  const targets = tabs.tabs
    .filter((tab, i) => {
      if (mode === 'all') return true
      if (mode === 'others') return tab.id !== id
      if (mode === 'left') return i < index
      return i > index
    })
    .map((tab) => tab.id)
  for (const targetId of targets) await closeTab(targetId)
}

function revealTab(id: string): void {
  const tab = tabs.tabs.find((item) => item.id === id)
  if (!tab?.path) return
  void window.kmde.showItemInFolder(tab.path).catch(() => {
    message.error(t('notify.revealFailed'))
  })
}

async function requestCloseApp(reload = false): Promise<void> {
  if (closingApp.value) return
  if (initializing.value || saveDialogOpen || closingTabs.size || tabs.tabs.some((tab) => tab.loading)) {
    message.warning(t('notify.fileLoading'))
    return
  }
  // 恢复失败时允许退出，但绝不以空会话覆盖原文件。
  if (!tabs.sessionReady) {
    if (reload) location.reload()
    else window.kmde.closeWindow()
    return
  }
  closingApp.value = true
  persistence.pause()
  let committed = false
  try {
    editorAreaRef.value?.flushAll()
    await tabs.waitForSaves()
    editorAreaRef.value?.flushAll()
    if (!await persistence.flush()) {
      notifySessionError()
      return
    }
    committed = true
    if (reload) location.reload()
    else window.kmde.closeWindow()
  } finally {
    if (!committed) {
      closingApp.value = false
      persistence.resume()
    }
  }
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

  try {
    await settings.load()
    await tabs.restoreSession()
    // 文档恢复决定编辑就绪；工作区读取和索引不再占用启动屏障。
    initializing.value = false
    void openLastWorkspace()
    await window.kmde.rendererReady()
  } catch (error) {
    console.error('[session] 恢复失败:', error)
    message.error(t('notify.sessionRestoreFailed'), { duration: 0, closable: true })
  } finally {
    initializing.value = false
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
    <TitleBar @command="runCommand" @request-close="requestCloseApp()" />
    <TabBar
      v-if="tabs.activeTab"
      :inert="closingApp || closingTabs.size > 0 || !tabs.sessionReady"
      @new-file="newFile()"
      @close-tab="closeTab"
      @close-tabs="closeTabs"
      @reveal-tab="revealTab"
    />
    <div class="workbench-main" :inert="closingApp || closingTabs.size > 0 || !tabs.sessionReady">
      <FileTree v-if="settings.sidebarVisible" @open-file="openFileByPath" @close-folder="closeWorkspace" />
      <Resizer
        v-if="settings.sidebarVisible"
        side="left"
        @resize="onSidebarResize"
        @resize-end="settings.persist()"
      />
      <EditorArea
        v-if="tabs.activeTab"
        ref="editorAreaRef"
        :locked="closingApp || closingTabs.size > 0"
        @outline-change="handleOutlineChange"
        @request-save-as="saveAsTab"
      />
      <WelcomePage
        v-else
        @open-file="openFilePicker"
        @open-folder="openFolderPicker"
        @new-file="newFile()"
        @resume-workspace="openLastWorkspace"
      />
      <Resizer
        v-if="settings.outlineVisible"
        side="right"
        @resize="onOutlineResize"
        @resize-end="settings.persist()"
      />
      <OutlinePanel
        v-if="settings.outlineVisible"
        :items="outlineItems"
        :has-document="!!tabs.activeTab"
        :active-id="outlineActiveId"
        @jump="handleOutlineJump"
      />
    </div>
    <StatusBar @toggle-mode="runCommand('toggle-mode')" />
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
</style>
