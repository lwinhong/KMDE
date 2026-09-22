<script setup lang="ts">
import { computed, onMounted, provide, reactive, ref, watch } from 'vue'
import { NDropdown, NModal, NInput, NButton, useMessage } from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { FileNode } from '@shared/types'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { dirname, joinPath } from '../../stores/pathUtils'
import FileTreeNode, { type TreeController } from './FileTreeNode.vue'

const emit = defineEmits<{
  (e: 'open-file', path: string): void
}>()

const workspace = useWorkspaceStore()
const message = useMessage()
const { t } = useI18n()

const rootChildren = ref<FileNode[]>([])
const expandedDirs = reactive(new Set<string>())
const loadingDirs = reactive(new Set<string>())
const childrenCache = reactive(new Map<string, FileNode[]>())

const controller: TreeController = {
  expandedDirs,
  loadingDirs,
  childrenCache,
  toggleNode: async (node: FileNode): Promise<void> => {
    if (!node.isDir) return
    if (expandedDirs.has(node.path)) {
      expandedDirs.delete(node.path)
      return
    }
    expandedDirs.add(node.path)
    if (!childrenCache.has(node.path)) {
      loadingDirs.add(node.path)
      try {
        const nodes = await window.kmde.listDir(node.path)
        childrenCache.set(node.path, nodes)
      } catch (err) {
        message.error(t('sidebar.readDirFailed', { msg: err instanceof Error ? err.message : String(err) }))
        expandedDirs.delete(node.path)
      } finally {
        loadingDirs.delete(node.path)
      }
    }
  }
}
provide('fileTreeController', controller)

async function refreshRoot(): Promise<void> {
  if (!workspace.root) {
    rootChildren.value = []
    return
  }
  childrenCache.clear()
  try {
    rootChildren.value = await window.kmde.listDir(workspace.root)
  } catch {
    rootChildren.value = []
  }
  // reload children of every expanded dir
  for (const dir of [...expandedDirs]) {
    try {
      const nodes = await window.kmde.listDir(dir)
      childrenCache.set(dir, nodes)
    } catch {
      expandedDirs.delete(dir)
    }
  }
}

async function openNode(node: FileNode): Promise<void> {
  if (node.isDir) return
  if (workspace.isMdFile(node)) {
    emit('open-file', node.path)
  } else {
    message.warning(t('sidebar.mdOnly'))
  }
}

// ------- context menu -------
const ctxVisible = ref(false)
const ctxX = ref(0)
const ctxY = ref(0)
const ctxNode = ref<FileNode | null>(null)

function onContextMenu(node: FileNode, x: number, y: number): void {
  ctxNode.value = node
  ctxX.value = x
  ctxY.value = y
  ctxVisible.value = true
}

const ctxOptions = computed<DropdownOption[]>(() => {
  const node = ctxNode.value
  if (!node) return []
  const options: DropdownOption[] = []
  if (node.isDir) {
    options.push({ label: t('sidebar.newFile'), key: 'new-file' })
    options.push({ label: t('sidebar.newFolder'), key: 'new-dir' })
  }
  options.push({ label: t('common.rename'), key: 'rename' })
  options.push({ label: t('sidebar.removeToTrash'), key: 'remove' })
  return options
})

async function onCtxSelect(key: string | number): Promise<void> {
  ctxVisible.value = false
  const node = ctxNode.value
  if (!node) return

  if (key === 'new-file' || key === 'new-dir') {
    openNameDialog(key === 'new-file' ? t('sidebar.newFile') : t('sidebar.newFolder'), '', key, node)
  } else if (key === 'rename') {
    openNameDialog(t('common.rename'), node.name, 'rename', node)
  } else if (key === 'remove') {
    const ok = window.confirm(t('sidebar.deleteConfirm', { name: node.name }))
    if (!ok) return
    try {
      await window.kmde.removeEntry(node.path)
      await refreshRoot()
    } catch (err) {
      message.error(t('sidebar.deleteFailed', { msg: err instanceof Error ? err.message : String(err) }))
    }
  }
}

// ------- name dialog -------
const nameDialog = reactive({
  visible: false,
  title: '',
  value: '',
  mode: 'new-file' as 'new-file' | 'new-dir' | 'rename',
  target: null as FileNode | null,
  busy: false
})
const nameInputRef = ref<InstanceType<typeof NInput> | null>(null)

function openNameDialog(
  title: string,
  value: string,
  mode: 'new-file' | 'new-dir' | 'rename',
  target: FileNode
): void {
  nameDialog.title = title
  nameDialog.value = value
  nameDialog.mode = mode
  nameDialog.target = target
  nameDialog.visible = true
  nameDialog.busy = false
  setTimeout(() => nameInputRef.value?.focus(), 80)
}

function newFileAtRoot(): void {
  if (!workspace.root) return
  openNameDialog(t('sidebar.newFile'), '', 'new-file', {
    path: workspace.root,
    name: workspace.rootName,
    isDir: true,
    ext: '',
    size: 0
  })
}

async function confirmNameDialog(): Promise<void> {
  const { mode, target, value } = nameDialog
  const name = value.trim()
  if (!name || !target) return
  if (/[\\/:*?"<>|]/.test(name)) {
    message.error(t('sidebar.illegalNameChars', { chars: '\\ / : * ? " < > |' }))
    return
  }
  nameDialog.busy = true
  try {
    if (mode === 'new-file' || mode === 'new-dir') {
      const parentDir = target.isDir ? target.path : dirname(target.path)
      await window.kmde.createEntry(parentDir, name, mode === 'new-file' ? 'file' : 'dir')
      expandedDirs.add(parentDir)
      await refreshRoot()
    } else {
      const parentDir = dirname(target.path)
      const newPath = joinPath(parentDir, name)
      if (newPath !== target.path) {
        await window.kmde.renameEntry(target.path, newPath)
        await refreshRoot()
      }
    }
    nameDialog.visible = false
  } catch (err) {
    message.error(t('sidebar.operationFailed', { msg: err instanceof Error ? err.message : String(err) }))
  } finally {
    nameDialog.busy = false
  }
}

watch(
  () => workspace.treeVersion,
  () => {
    void refreshRoot()
  }
)

watch(
  () => workspace.root,
  () => {
    expandedDirs.clear()
    childrenCache.clear()
    void refreshRoot()
  }
)

onMounted(() => {
  void refreshRoot()
})
</script>

<template>
  <aside class="filetree">
    <div class="filetree-header">
      <span class="filetree-title" :title="workspace.root ?? ''">{{ workspace.rootName || $t('sidebar.explorer') }}</span>
      <span class="filetree-actions">
        <button class="filetree-action" :title="$t('sidebar.newFile')" @click="newFileAtRoot">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
        <button class="filetree-action" :title="$t('sidebar.refresh')" @click="refreshRoot">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
          </svg>
        </button>
      </span>
    </div>
    <div class="filetree-body">
      <template v-if="workspace.root">
        <FileTreeNode
          v-for="node in rootChildren"
          :key="node.path"
          :node="node"
          :depth="0"
          @open="openNode"
          @contextmenu="onContextMenu"
        />
        <div v-if="rootChildren.length === 0" class="filetree-empty">{{ $t('sidebar.emptyFolder') }}</div>
      </template>
      <div v-else class="filetree-empty">{{ $t('sidebar.noWorkspace') }}<br />{{ $t('sidebar.noWorkspaceHint') }}</div>
    </div>

    <n-dropdown
      trigger="manual"
      placement="bottom-start"
      :show="ctxVisible"
      :x="ctxX"
      :y="ctxY"
      :options="ctxOptions"
      @clickoutside="ctxVisible = false"
      @select="onCtxSelect"
    />

    <n-modal
      v-model:show="nameDialog.visible"
      preset="card"
      :title="nameDialog.title"
      style="width: 380px"
      :mask-closable="false"
    >
      <n-input
        ref="nameInputRef"
        v-model:value="nameDialog.value"
        :placeholder="$t('sidebar.inputName')"
        @keydown.enter="confirmNameDialog"
      />
      <template #footer>
        <div class="name-dialog-footer">
          <n-button size="small" @click="nameDialog.visible = false">{{ $t('common.cancel') }}</n-button>
          <n-button size="small" type="primary" :loading="nameDialog.busy" @click="confirmNameDialog">{{ $t('common.ok') }}</n-button>
        </div>
      </template>
    </n-modal>
  </aside>
</template>

<style scoped>
.filetree {
  width: 240px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--kme-bg-sidebar);
  border-right: 1px solid var(--kme-border-light);
  min-height: 0;
}

.filetree-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--kme-text-3);
  user-select: none;
}

.filetree-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.filetree-actions {
  display: inline-flex;
  gap: 2px;
}

.filetree-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border: none;
  border-radius: var(--kme-radius-sm);
  background: transparent;
  color: var(--kme-text-3);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.filetree-action:hover {
  background: var(--kme-bg-hover);
  color: var(--kme-text-1);
}

.filetree-body {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
  padding-bottom: 10px;
}

.filetree-empty {
  padding: 16px 12px;
  color: var(--kme-text-3);
  font-size: 12.5px;
  text-align: center;
  line-height: 1.8;
}

.name-dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
