<script setup lang="ts">
import { ref, watch, onMounted, onBeforeUnmount, nextTick } from 'vue'
import { useEditor, EditorContent } from '@tiptap/vue-3'
import { BubbleMenu } from '@tiptap/vue-3/menus'
import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection } from '@tiptap/pm/state'
import { Decoration, DecorationSet } from '@tiptap/pm/view'
import type { EditorSelectionState, OutlineItem } from '@shared/types'
import type { EditorTab } from '@/stores/tabs.store'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { dirname, joinPath } from '@/stores/pathUtils'
import { buildEditorExtensions } from './extensions'
import { buildNodeLineMap, nodeIndexForLine } from '@/utils/blockLines'
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
  locked: boolean
}>()

const emit = defineEmits<{
  (e: 'update', markdown: string): void
  (e: 'outline-change', items: OutlineItem[], activeId: string | null): void
  (e: 'toggle-mode'): void
  (e: 'scroll'): void
}>()

const workspace = useWorkspaceStore()

const wrapperRef = ref<HTMLElement | null>(null)
const editorContentRef = ref<HTMLElement | null>(null)

const tableToolbarVisible = ref(false)
const tableToolbarStyle = ref<{ left: string; top: string }>({ left: '0px', top: '0px' })

let syncTimer: ReturnType<typeof setTimeout> | null = null
let ready = false
let resolveReady!: (ready: boolean) => void
const readyPromise = new Promise<boolean>((resolve) => { resolveReady = resolve })

const searchPluginKey = new PluginKey('kmdeSearch')

const SearchHighlight = Extension.create({
  name: 'kmdeSearchHighlight',
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: searchPluginKey,
        state: {
          init: () => DecorationSet.empty,
          apply(tr, value) {
            const meta = tr.getMeta(searchPluginKey) as DecorationSet | undefined
            if (meta) return meta
            if (tr.docChanged) return value.map(tr.mapping, tr.doc)
            return value
          }
        },
        props: {
          decorations(state) {
            return searchPluginKey.getState(state) as DecorationSet
          }
        }
      })
    ]
  }
})

const editor = useEditor({
  content: props.tab.markdown,
  editable: !props.locked,
  editorProps: {
    attributes: {
      autocomplete: 'off',
      autocorrect: 'off',
      autocapitalize: 'off',
      'aria-label': 'KMDE markdown editor',
      class: 'notion-editor-prosemirror'
    }
  },
  extensions: [...buildEditorExtensions(props.tab.path), SearchHighlight],
  contentType: 'markdown',
  onCreate({ editor: created }) {
    const saved = props.tab.selection
    if (saved?.mode === 'wysiwyg') {
      const doc = created.state.doc
      const clamp = (pos: number): number => Math.max(0, Math.min(pos, doc.content.size))
      const selection = TextSelection.between(doc.resolve(clamp(saved.anchor)), doc.resolve(clamp(saved.head)))
      created.view.dispatch(created.state.tr.setSelection(selection).setMeta('addToHistory', false))
    }
    ready = true
    emitOutline()
    resolveReady(true)
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

watch(() => props.locked, (locked) => editor.value?.setEditable(!locked, false))

function currentMarkdown(): string {
  return editor.value ? editor.value.getMarkdown() : props.tab.markdown
}

function getSelection(): EditorSelectionState | null {
  if (!ready || !editor.value || editor.value.isDestroyed) return null
  const { anchor, head } = editor.value.state.selection
  return { mode: 'wysiwyg', anchor, head }
}

function whenReady(): Promise<boolean> {
  return readyPromise
}

function focus(): void {
  const e = editor.value
  const root = wrapperRef.value
  if (!ready || !e || e.isDestroyed || props.locked || !root?.isConnected || root.closest('[inert]') || !root.getClientRects().length) return
  // 同步聚焦，避免命令内部的延迟帧在切页或关闭后抢走焦点。
  e.view.focus()
  e.view.dispatch(e.state.tr.scrollIntoView())
}

function getScrollElement(): HTMLElement | null {
  return editorContentRef.value
}

function applyExternalContent(markdown: string): void {
  const e = editor.value
  if (!ready || !e || e.isDestroyed || e.getMarkdown() === markdown) return
  // 分屏对侧编辑时的全量替换：查看侧无光标可保，按比例恢复滚动位置避免跳顶。
  const scroller = editorContentRef.value
  const ratio = scroller && scroller.scrollHeight > scroller.clientHeight
    ? scroller.scrollTop / (scroller.scrollHeight - scroller.clientHeight)
    : null
  e.commands.setContent(markdown, { contentType: 'markdown' })
  if (scroller && ratio !== null) {
    scroller.scrollTop = ratio * (scroller.scrollHeight - scroller.clientHeight)
  }
}

function scheduleSync(): void {
  if (syncTimer) return
  syncTimer = setTimeout(() => {
    syncTimer = null
    emit('update', currentMarkdown())
    emitOutline()
  }, 250)
}

function flush(): string {
  if (!syncTimer) return props.tab.markdown
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

// ---------------- find / replace ----------------

let searchQuery = ''
let searchCase = false
let searchMatches: { from: number; to: number }[] = []
let searchIndex = -1

function collectMatches(): { from: number; to: number }[] {
  const e = editor.value
  if (!e || !searchQuery) return []
  const needle = searchCase ? searchQuery : searchQuery.toLowerCase()
  const result: { from: number; to: number }[] = []
  e.state.doc.descendants((node, pos) => {
    if (!node.isText || !node.text) return true
    const text = searchCase ? node.text : node.text.toLowerCase()
    let index = text.indexOf(needle)
    while (index !== -1) {
      result.push({ from: pos + index, to: pos + index + searchQuery.length })
      index = text.indexOf(needle, index + needle.length)
    }
    return true
  })
  return result
}

function applyDecorations(): void {
  const e = editor.value
  if (!e) return
  const decorations = searchMatches.map((match, i) =>
    Decoration.inline(match.from, match.to, {
      class: i === searchIndex ? 'kmde-search-match is-current' : 'kmde-search-match'
    })
  )
  e.view.dispatch(e.state.tr.setMeta(searchPluginKey, DecorationSet.create(e.state.doc, decorations)))
}

function scrollToMatch(): void {
  const e = editor.value
  const match = searchMatches[searchIndex]
  if (!e || !match) return
  const at = e.view.domAtPos(match.from)
  const el = at.node.nodeType === 3 ? (at.node.parentElement as HTMLElement) : (at.node as HTMLElement)
  el?.scrollIntoView({ block: 'center' })
}

function searchState(): { total: number; current: number } {
  return { total: searchMatches.length, current: searchIndex >= 0 ? searchIndex + 1 : 0 }
}

function searchUpdate(query: string, caseSensitive: boolean): { total: number; current: number } {
  searchQuery = query
  searchCase = caseSensitive
  searchMatches = collectMatches()
  searchIndex = searchMatches.length ? 0 : -1
  applyDecorations()
  scrollToMatch()
  return searchState()
}

function searchNext(): { total: number; current: number } {
  if (searchMatches.length) {
    searchIndex = (searchIndex + 1) % searchMatches.length
    applyDecorations()
    scrollToMatch()
  }
  return searchState()
}

function searchPrev(): { total: number; current: number } {
  if (searchMatches.length) {
    searchIndex = (searchIndex - 1 + searchMatches.length) % searchMatches.length
    applyDecorations()
    scrollToMatch()
  }
  return searchState()
}

function searchReplace(replacement: string): { total: number; current: number } {
  const e = editor.value
  const match = searchMatches[searchIndex]
  if (!e || !match) return searchState()
  e.view.dispatch(e.state.tr.insertText(replacement, match.from, match.to))
  searchMatches = collectMatches()
  if (searchIndex >= searchMatches.length) searchIndex = searchMatches.length - 1
  applyDecorations()
  scrollToMatch()
  return searchState()
}

function searchReplaceAll(replacement: string): { total: number; current: number } {
  const e = editor.value
  if (!e || !searchMatches.length) return searchState()
  const tr = e.state.tr
  for (let i = searchMatches.length - 1; i >= 0; i--) {
    tr.insertText(replacement, searchMatches[i].from, searchMatches[i].to)
  }
  e.view.dispatch(tr)
  searchMatches = collectMatches()
  searchIndex = -1
  applyDecorations()
  return searchState()
}

function searchClear(): void {
  searchQuery = ''
  searchMatches = []
  searchIndex = -1
  applyDecorations()
}

function getSelectedText(): string {
  const e = editor.value
  if (!e) return ''
  const { from, to } = e.state.selection
  return e.state.doc.textBetween(from, to, ' ')
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

let scrollEl: HTMLElement | null = null

function handleContentScroll(): void {
  emit('scroll')
}

onMounted(() => {
  window.addEventListener('resize', updateTableToolbar)
  nextTick(() => {
    scrollEl = editorContentRef.value
    wrapperRef.value?.addEventListener('scroll', updateTableToolbar, { passive: true })
    scrollEl?.addEventListener('scroll', updateTableToolbar, { passive: true })
    scrollEl?.addEventListener('scroll', handleContentScroll, { passive: true })
  })
})

onBeforeUnmount(() => {
  flush()
  ready = false
  resolveReady(false)
  if (tableToolbarRaf) cancelAnimationFrame(tableToolbarRaf)
  window.removeEventListener('resize', updateTableToolbar)
  wrapperRef.value?.removeEventListener('scroll', updateTableToolbar)
  scrollEl?.removeEventListener('scroll', updateTableToolbar)
  scrollEl?.removeEventListener('scroll', handleContentScroll)
  scrollEl = null
  editor.value?.destroy()
})

let nodeLineCache: { md: string; map: number[] } = { md: '', map: [] }

// 用当前文档顶级节点的文本内容在 markdown 中顺序定位，得到「节点索引 → 起始行号」映射。
// 映射源必须是 CodeMirror 侧的 markdown（行号以它为准），缓存以它为 key。
function getNodeLineMap(): number[] {
  const e = editor.value
  if (!e || e.isDestroyed) return []
  const md = props.tab.markdown
  if (nodeLineCache.md === md && nodeLineCache.map.length) return nodeLineCache.map
  const doc = e.state.doc
  const texts: string[] = []
  for (let i = 0; i < doc.childCount; i++) texts.push(doc.child(i).textContent)
  const map = buildNodeLineMap(texts, md)
  nodeLineCache = { md, map }
  return map
}

function getScrollLine(): number {
  const content = editorContentRef.value
  const view = editor.value?.view
  if (!content || !view) return 1
  const doc = view.state.doc
  const map = getNodeLineMap()
  if (map.length === 0) return 1
  const contentRect = content.getBoundingClientRect()
  const domRect = view.dom.getBoundingClientRect()

  // 快速路径：探测点取内容区左边缘（跳过 padding）与可见顶部，避开 padding 与行内空白。
  const firstBlock = view.dom.firstElementChild as HTMLElement | null
  const blockTop = firstBlock ? firstBlock.getBoundingClientRect().top : domRect.top
  const left = Math.max(domRect.left, contentRect.left) + 40
  const top = Math.max(blockTop, contentRect.top) + 2
  let pos = view.posAtCoords({ left, top })

  // 回退：posAtCoords 探测落空时，遍历块起始坐标找首个可见块。
  if (pos == null) {
    let off = 0
    for (let i = 0; i < doc.childCount; i++) {
      const c = view.coordsAtPos(Math.min(off + 1, doc.content.size))
      if (c && c.bottom > contentRect.top) {
        pos = off + 1
        break
      }
      off += doc.child(i).nodeSize
    }
  }
  if (pos == null) return 1

  let offset = 0
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i)
    if (pos < offset + child.nodeSize) {
      const startLine = map[i] ?? 1
      const nextLine = map[i + 1]
      // 节点内按 pos 比例插值，避免长节点（如大代码块）只对齐到起始行。
      if (nextLine === undefined || nextLine <= startLine || child.nodeSize <= 0) return startLine
      const ratio = (pos - offset) / child.nodeSize
      return startLine + ratio * (nextLine - startLine)
    }
    offset += child.nodeSize
  }
  return 1
}

function scrollToLine(line: number): void {
  const view = editor.value?.view
  const content = editorContentRef.value
  if (!view || !content) return
  const map = getNodeLineMap()
  if (map.length === 0) return
  const doc = view.state.doc
  const i = Math.min(nodeIndexForLine(map, line), doc.childCount - 1)
  let offset = 0
  for (let k = 0; k < i; k++) offset += doc.child(k).nodeSize
  const startCoords = view.coordsAtPos(Math.min(offset + 1, doc.content.size))
  let targetY = startCoords.top
  const nextLine = map[i + 1]
  if (nextLine !== undefined && nextLine > map[i]) {
    const ratio = Math.min(1, Math.max(0, (line - map[i]) / (nextLine - map[i])))
    const nextCoords = view.coordsAtPos(Math.min(offset + doc.child(i).nodeSize + 1, doc.content.size))
    targetY = startCoords.top + ratio * (nextCoords.top - startCoords.top)
  }
  const contentRect = content.getBoundingClientRect()
  const targetTop = targetY - contentRect.top + content.scrollTop - 2
  content.scrollTo({ top: Math.max(0, targetTop) })
}

defineExpose({
  getSelection,
  whenReady,
  focus,
  getScrollElement,
  applyExternalContent,
  flush,
  jumpTo,
  emitOutline,
  getScrollLine,
  scrollToLine,
  searchUpdate,
  searchNext,
  searchPrev,
  searchReplace,
  searchReplaceAll,
  searchClear,
  getSelectedText
})
</script>

<template>
  <div ref="wrapperRef" class="tiptap-editor-wrapper" :inert="locked">
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
        <div v-if="tableToolbarVisible && editor" class="notion-table-toolbar" :style="tableToolbarStyle" :inert="locked">
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
  max-width: 1080px;
  min-width: 820px;
  padding: 24px 32px 120px;
}
</style>

<style>
.kmde-search-match {
  background: var(--kme-search-match);
  border-radius: 2px;
}

.kmde-search-match.is-current {
  background: var(--kme-search-match-active);
}
</style>
