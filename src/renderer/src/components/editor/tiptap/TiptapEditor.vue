<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import type { OutlineItem } from '@shared/types'
import type { EditorTab } from '@/stores/tabs.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { dirname, joinPath } from '@/stores/pathUtils'
import { buildEditorExtensions } from './extensions'
import {
  AddColumnBeforeIcon,
  AddColumnAfterIcon,
  AddRowBeforeIcon,
  AddRowAfterIcon,
  DeleteColumnIcon,
  DeleteRowIcon,
  DeleteTableIcon
} from './icons/index.jsx'
import MenuBar from './components/MenuBar.vue'
import LinkPopover from './components/LinkPopover.vue'
import MarkButtons from './components/MarkButtons.vue'
import HighlightPicker from './components/HighlightPicker.vue'
import './styles/notion-editor.css'

const props = defineProps<{
  tab: EditorTab
}>()

const emit = defineEmits<{
  (e: 'update', markdown: string): void
  (e: 'outline-change', items: OutlineItem[], activeId: string | null): void
  (e: 'toggle-mode'): void
}>()

const workspace = useWorkspaceStore()

const wrapperRef = ref<HTMLElement | null>(null)
const editorContentRef = ref<HTMLElement | null>(null)

const tableToolbarVisible = ref(false)
const tableToolbarStyle = ref<{ left: string; top: string }>({ left: '0px', top: '0px' })

let syncTimer: ReturnType<typeof setTimeout> | null = null

const editor = useEditor({
  content: props.tab.markdown,
  editable: true,
  editorProps: {
    attributes: {
      autocomplete: 'off',
      autocorrect: 'off',
      autocapitalize: 'off',
      'aria-label': 'KMDE markdown editor',
      class: 'notion-editor-prosemirror'
    }
  },
  extensions: buildEditorExtensions(props.tab.path),
  contentType: 'markdown',
  onCreate() {
    emitOutline()
  },
  onUpdate() {
    scheduleSync()
    updateTableToolbar()
  },
  onSelectionUpdate() {
    updateTableToolbar()
    emitOutline()
  }
})

function currentMarkdown(): string {
  return editor.value ? editor.value.getMarkdown() : props.tab.markdown
}

function scheduleSync(): void {
  if (syncTimer) clearTimeout(syncTimer)
  syncTimer = setTimeout(() => {
    syncTimer = null
    emit('update', currentMarkdown())
    emitOutline()
  }, 250)
}

function flush(): string {
  if (syncTimer) {
    clearTimeout(syncTimer)
    syncTimer = null
  }
  const md = currentMarkdown()
  emit('update', md)
  emitOutline()
  return md
}

function emitOutline(): void {
  if (!editor.value) return
  const items: OutlineItem[] = []
  const head = editor.value.state.selection.head
  let activeId: string | null = null
  editor.value.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      const id = `h-${pos}`
      items.push({
        id,
        level: node.attrs.level as number,
        text: node.textContent,
        pos
      })
      if (pos <= head) {
        activeId = id
      }
    }
    return true
  })
  emit('outline-change', items, activeId)
}

function jumpTo(item: OutlineItem): void {
  if (!editor.value || item.pos === undefined) return
  editor.value
    .chain()
    .focus()
    .setTextSelection(item.pos + 1)
    .scrollIntoView()
    .run()
}

// external reload
watch(
  () => props.tab.reloadToken,
  () => {
    if (!editor.value) return
    editor.value.commands.setContent(props.tab.markdown, { contentType: 'markdown' })
    emitOutline()
  }
)

// ---------------- local image import ----------------

async function importLocalImage(file: File): Promise<{ url: string; alt: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const baseDir = props.tab.path ? dirname(props.tab.path) : workspace.root
  if (baseDir) {
    const assetsDir = joinPath(baseDir, 'assets')
    const safeName = file.name.replace(/[\\/:*?"<>|\s]/g, '_')
    const fileName = `${Date.now()}-${safeName}`
    try {
      await window.kmde.writeBinaryFile(joinPath(assetsDir, fileName), bytes)
      return { url: `assets/${fileName}`, alt: file.name }
    } catch (err) {
      console.error('[image] copy to workspace failed, fallback to data url', err)
    }
  }
  return await new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => resolve({ url: String(reader.result), alt: file.name })
    reader.readAsDataURL(file)
  })
}

const imageUploadFn = async (file: File): Promise<{ url: string; alt: string }> => importLocalImage(file)

// ---------------- floating table toolbar ----------------

let tableToolbarRaf: number | null = null

function updateTableToolbar(): void {
  if (tableToolbarRaf) return
  tableToolbarRaf = requestAnimationFrame(() => {
    tableToolbarRaf = null
    doUpdateTableToolbar()
  })
}

function doUpdateTableToolbar(): void {
  if (!editor.value) {
    tableToolbarVisible.value = false
    return
  }
  const e = editor.value
  if (!e.isActive('table')) {
    tableToolbarVisible.value = false
    return
  }
  const { from, to } = e.state.selection
  if (from !== to) {
    tableToolbarVisible.value = false
    return
  }
  const node = e.view.domAtPos(from).node
  const el = node.nodeType === 3 ? (node.parentElement as HTMLElement) : (node as HTMLElement)
  const table = el.closest('table')
  if (!table) {
    tableToolbarVisible.value = false
    return
  }
  const tableRect = table.getBoundingClientRect()
  const scrollEl = wrapperRef.value
  if (!scrollEl) {
    tableToolbarVisible.value = false
    return
  }
  const containerRect = scrollEl.getBoundingClientRect()
  const toolbarHeight = 44
  const visibleTop = containerRect.top
  const visibleBottom = containerRect.bottom
  if (tableRect.bottom < visibleTop || tableRect.top > visibleBottom) {
    tableToolbarVisible.value = false
    return
  }
  let topPos = tableRect.top - toolbarHeight
  if (topPos < visibleTop) {
    topPos = visibleTop
  }
  if (topPos + toolbarHeight > tableRect.bottom) {
    tableToolbarVisible.value = false
    return
  }
  tableToolbarVisible.value = true
  tableToolbarStyle.value = {
    left: `${tableRect.left}px`,
    top: `${topPos}px`
  }
}

onMounted(() => {
  window.addEventListener('resize', updateTableToolbar)
  nextTick(() => {
    wrapperRef.value?.addEventListener('scroll', updateTableToolbar, { passive: true })
    editorContentRef.value?.addEventListener('scroll', updateTableToolbar, { passive: true })
  })
})

onBeforeUnmount(() => {
  if (syncTimer) clearTimeout(syncTimer)
  if (tableToolbarRaf) cancelAnimationFrame(tableToolbarRaf)
  window.removeEventListener('resize', updateTableToolbar)
  wrapperRef.value?.removeEventListener('scroll', updateTableToolbar)
  editorContentRef.value?.removeEventListener('scroll', updateTableToolbar)
  editor.value?.destroy()
})

defineExpose({ flush, jumpTo, emitOutline })
</script>

<template>
  <div ref="wrapperRef" class="tiptap-editor-wrapper">
    <MenuBar v-if="editor" :editor="editor" :source-mode="false" :use-source-mode="true" :upload-fn="imageUploadFn"
      @toggle-source="emit('toggle-mode')" />
    <div v-show="editor" ref="editorContentRef" class="notion-editor-content">
      <BubbleMenu v-if="editor" :editor="editor" :tippy-options="{ duration: 100, maxWidth: 'none' }">
        <div class="notion-bubble-toolbar">
          <MarkButtons :editor="editor" :size="16" />
          <div class="notion-bubble-sep" />
          <LinkPopover :editor="editor" :size="16" />
          <HighlightPicker :editor="editor" :size="16" />
        </div>
      </BubbleMenu>
      <Teleport to="body">
        <div v-if="tableToolbarVisible && editor" class="notion-table-toolbar" :style="tableToolbarStyle">
          <button class="ntb-btn" :title="$t('editor.addColBefore')"
            @click="editor.chain().focus().addColumnBefore().run()">
            <AddColumnBeforeIcon :size="18" />
          </button>
          <button class="ntb-btn" :title="$t('editor.addColAfter')"
            @click="editor.chain().focus().addColumnAfter().run()">
            <AddColumnAfterIcon :size="18" />
          </button>
          <div class="ntb-divider" />
          <button class="ntb-btn" :title="$t('editor.addRowAbove')"
            @click="editor.chain().focus().addRowBefore().run()">
            <AddRowBeforeIcon :size="18" />
          </button>
          <button class="ntb-btn" :title="$t('editor.addRowBelow')" @click="editor.chain().focus().addRowAfter().run()">
            <AddRowAfterIcon :size="18" />
          </button>
          <div class="ntb-divider" />
          <button class="ntb-btn" :disabled="!editor.can().deleteColumn()" :title="$t('editor.deleteColumn')"
            @click="editor.chain().focus().deleteColumn().run()">
            <DeleteColumnIcon :size="18" />
          </button>
          <button class="ntb-btn" :disabled="!editor.can().deleteRow()" :title="$t('editor.deleteRow')"
            @click="editor.chain().focus().deleteRow().run()">
            <DeleteRowIcon :size="18" />
          </button>
          <div class="ntb-divider" />
          <button class="ntb-btn ntb-danger" :title="$t('editor.deleteTable')"
            @click="editor.chain().focus().deleteTable().run()">
            <DeleteTableIcon :size="18" />
          </button>
        </div>
      </Teleport>
      <div class="tiptap-editor-page">
        <EditorContent :editor="editor" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.tiptap-editor-wrapper {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--kme-bg);
}

.notion-editor-content {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}

.tiptap-editor-page {
  margin: 0 auto;
  max-width: 880px;
  min-width: 820px;
  padding: 24px 32px 120px;
}
</style>
