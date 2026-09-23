<script setup lang="ts">
import { onMounted, onBeforeUnmount, ref, watch } from 'vue'
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLineGutter,
  highlightSpecialChars,
  drawSelection,
  dropCursor,
  rectangularSelection,
  crosshairCursor,
  highlightActiveLine
} from '@codemirror/view'
import { EditorState, Compartment, EditorSelection, Transaction, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { foldGutter, indentOnInput, bracketMatching, foldKeymap, syntaxHighlighting, defaultHighlightStyle, HighlightStyle } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { tags as t } from '@lezer/highlight'
import { SearchQuery, search, setSearchQuery } from '@codemirror/search'
import type { EditorSelectionState, OutlineItem } from '@shared/types'
import type { EditorTab } from '@/stores/tabs.store'
import { computeTextDiff } from '@/utils/textDiff'
import { useSettingsStore } from '@/stores/settings.store'

const props = defineProps<{
  tab: EditorTab
  locked: boolean
}>()

const emit = defineEmits<{
  (e: 'update', markdown: string): void
  (e: 'outline-change', items: OutlineItem[], activeId: string | null): void
}>()

const settings = useSettingsStore()
const hostRef = ref<HTMLElement | null>(null)
let view: EditorView | null = null
let syncTimer: ReturnType<typeof setTimeout> | null = null

const themeComp = new Compartment()
const editableComp = new Compartment()

const kmdeDarkHighlight = HighlightStyle.define([
  { tag: t.comment, color: '#8b949e', fontStyle: 'italic' },
  { tag: t.lineComment, color: '#8b949e', fontStyle: 'italic' },
  { tag: t.blockComment, color: '#8b949e', fontStyle: 'italic' },
  { tag: t.meta, color: '#8b949e' },
  { tag: t.keyword, color: '#ff7b72' },
  { tag: t.operator, color: '#ff7b72' },
  { tag: t.atom, color: '#79c0ff' },
  { tag: t.bool, color: '#79c0ff' },
  { tag: t.number, color: '#79c0ff' },
  { tag: t.string, color: '#a5d6ff' },
  { tag: t.regexp, color: '#a5d6ff' },
  { tag: t.variableName, color: '#c9d1d9' },
  { tag: t.definition(t.variableName), color: '#79c0ff' },
  { tag: t.function(t.variableName), color: '#d2a8ff' },
  { tag: t.propertyName, color: '#79c0ff' },
  { tag: t.attributeName, color: '#79c0ff' },
  { tag: t.typeName, color: '#d2a8ff' },
  { tag: t.className, color: '#7ee787' },
  { tag: t.tagName, color: '#7ee787' },
  { tag: t.heading, color: '#79c0ff', fontWeight: 'bold' },
  { tag: t.link, color: '#79c0ff' },
  { tag: t.url, color: '#a5d6ff' },
  { tag: t.emphasis, color: '#c9d1d9', fontStyle: 'italic' },
  { tag: t.strong, color: '#c9d1d9', fontWeight: 'bold' },
  { tag: t.list, color: '#ff7b72' },
  { tag: t.quote, color: '#8b949e' },
  { tag: t.separator, color: '#8b949e' },
  { tag: t.invalid, color: '#f85149' },
  { tag: t.content, color: '#c9d1d9' },
  { tag: t.punctuation, color: '#c9d1d9' }
])

watch(() => props.locked, (locked) => {
  view?.dispatch({ effects: editableComp.reconfigure([
    EditorView.editable.of(!locked), EditorState.readOnly.of(locked)
  ]) })
})

const kmdeCmTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '14px',
    backgroundColor: 'var(--kme-bg)',
    color: 'var(--kme-text-1)'
  },
  '.cm-scroller': {
    fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
    lineHeight: '1.7'
  },
  '.cm-content': {
    caretColor: 'var(--kme-primary)',
    padding: '16px 4px 120px'
  },
  '.cm-gutters': {
    backgroundColor: 'var(--kme-bg)',
    color: 'var(--kme-text-3)',
    border: 'none'
  },
  '&.cm-focused': { outline: 'none' },
  '.cm-activeLine': { backgroundColor: 'var(--kme-bg-hover)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--kme-bg-hover)', color: 'var(--kme-text-1)' },
  '.cm-selectionBackground, ::selection': { backgroundColor: 'var(--kme-selection)' },
  '&.cm-focused .cm-selectionBackground': { backgroundColor: 'var(--kme-selection)' },
  '.cm-cursor': { borderLeftColor: 'var(--kme-primary)' },
  '.cm-searchMatch': { backgroundColor: 'var(--kme-search-match)' },
  '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--kme-search-match-active)' }
})

function buildExtensions(): Extension[] {
  const highlight = settings.isDark
    ? syntaxHighlighting(kmdeDarkHighlight)
    : syntaxHighlighting(defaultHighlightStyle, { fallback: true })
  return [
    lineNumbers(),
    highlightActiveLineGutter(),
    highlightSpecialChars(),
    history(),
    foldGutter(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    rectangularSelection(),
    crosshairCursor(),
    highlightActiveLine(),
    search({ top: true }),
    markdown({ base: markdownLanguage, codeLanguages: languages }),
    EditorView.lineWrapping,
    keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, indentWithTab]),
    themeComp.of(highlight),
    editableComp.of([EditorView.editable.of(!props.locked), EditorState.readOnly.of(props.locked)]),
    kmdeCmTheme,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        scheduleSync()
      } else if (update.selectionSet) {
        emitOutline()
      }
    })
  ]
}

function currentMarkdown(): string {
  return view ? view.state.doc.toString() : props.tab.markdown
}

function getSelection(): EditorSelectionState | null {
  if (!view) return null
  const { anchor, head } = view.state.selection.main
  return { mode: 'source', anchor, head }
}

function whenReady(): Promise<boolean> {
  return Promise.resolve(view !== null)
}

function getScrollElement(): HTMLElement | null {
  return view?.scrollDOM ?? null
}

function applyExternalContent(markdown: string): void {
  if (!view) return
  // 最小差异替换，保住光标与滚动位置；remote 标注避免对侧同步进入撤销历史。
  const change = computeTextDiff(view.state.doc.toString(), markdown)
  if (!change) return
  view.dispatch({ changes: change, annotations: Transaction.remote.of(true) })
}

function focus(): void {
  const root = hostRef.value
  if (!view || props.locked || !root?.isConnected || root.closest('[inert]') || !root.getClientRects().length) return
  view.focus()
  view.dispatch({ effects: EditorView.scrollIntoView(view.state.selection.main.head, { y: 'center' }) })
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
  if (!view) return
  const doc = view.state.doc
  const cursorLine = doc.lineAt(view.state.selection.main.head).number
  const items: OutlineItem[] = []
  let activeId: string | null = null
  for (let i = 1; i <= doc.lines; i++) {
    const line = doc.line(i)
    const match = /^(#{1,6})\s+(.*)/.exec(line.text)
    if (match) {
      const id = `l-${i}`
      items.push({
        id,
        level: match[1].length,
        text: match[2].trim(),
        line: i
      })
      if (i <= cursorLine) {
        activeId = id
      }
    }
  }
  emit('outline-change', items, activeId)
}

function jumpTo(item: OutlineItem): void {
  if (!view || item.line === undefined) return
  const line = view.state.doc.line(Math.min(Math.max(item.line, 1), view.state.doc.lines))
  view.dispatch({
    selection: { anchor: line.from },
    effects: EditorView.scrollIntoView(line.from, { y: 'center' })
  })
  view.focus()
}

// ---------------- find / replace ----------------

let searchQuery = ''
let searchCase = false
let searchMatches: { from: number; to: number }[] = []
let searchIndex = -1

function buildSearchQuery(): SearchQuery {
  return new SearchQuery({ search: searchQuery, caseSensitive: searchCase })
}

function collectMatches(): { from: number; to: number }[] {
  if (!view || !searchQuery) return []
  const cursor = buildSearchQuery().getCursor(view.state.doc)
  const result: { from: number; to: number }[] = []
  for (let next = cursor.next(); !next.done; next = cursor.next()) {
    result.push({ from: next.value.from, to: next.value.to })
  }
  return result
}

function highlightMatches(): void {
  if (!view) return
  view.dispatch({
    effects: setSearchQuery.of(searchQuery ? buildSearchQuery() : new SearchQuery({ search: '' }))
  })
}

function gotoCurrentMatch(): void {
  const match = searchMatches[searchIndex]
  if (!view || !match) return
  view.dispatch({
    selection: EditorSelection.single(match.from, match.to),
    effects: EditorView.scrollIntoView(match.from, { y: 'center' })
  })
}

function searchState(): { total: number; current: number } {
  return { total: searchMatches.length, current: searchIndex >= 0 ? searchIndex + 1 : 0 }
}

function searchUpdate(query: string, caseSensitive: boolean): { total: number; current: number } {
  searchQuery = query
  searchCase = caseSensitive
  searchMatches = collectMatches()
  searchIndex = searchMatches.length ? 0 : -1
  highlightMatches()
  gotoCurrentMatch()
  return searchState()
}

function searchNext(): { total: number; current: number } {
  if (searchMatches.length) {
    searchIndex = (searchIndex + 1) % searchMatches.length
    gotoCurrentMatch()
  }
  return searchState()
}

function searchPrev(): { total: number; current: number } {
  if (searchMatches.length) {
    searchIndex = (searchIndex - 1 + searchMatches.length) % searchMatches.length
    gotoCurrentMatch()
  }
  return searchState()
}

function searchReplace(replacement: string): { total: number; current: number } {
  const match = searchMatches[searchIndex]
  if (!view || !match) return searchState()
  view.dispatch({ changes: { from: match.from, to: match.to, insert: replacement } })
  searchMatches = collectMatches()
  if (searchIndex >= searchMatches.length) searchIndex = searchMatches.length - 1
  highlightMatches()
  gotoCurrentMatch()
  return searchState()
}

function searchReplaceAll(replacement: string): { total: number; current: number } {
  if (!view || !searchMatches.length) return searchState()
  view.dispatch({ changes: searchMatches.map((m) => ({ from: m.from, to: m.to, insert: replacement })) })
  searchMatches = collectMatches()
  searchIndex = -1
  highlightMatches()
  return searchState()
}

function searchClear(): void {
  searchQuery = ''
  searchMatches = []
  searchIndex = -1
  if (view) view.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: '' })) })
}

function getSelectedText(): string {
  if (!view) return ''
  const { from, to } = view.state.selection.main
  return view.state.sliceDoc(from, to)
}

onMounted(() => {
  if (!hostRef.value) return
  view = new EditorView({
    state: EditorState.create({
      doc: props.tab.markdown,
      extensions: buildExtensions()
    }),
    parent: hostRef.value
  })
  const saved = props.tab.selection
  if (saved?.mode === 'source') {
    const clamp = (pos: number): number => Math.max(0, Math.min(pos, view!.state.doc.length))
    view.dispatch({ selection: { anchor: clamp(saved.anchor), head: clamp(saved.head) } })
  }
  emitOutline()
})

onBeforeUnmount(() => {
  flush()
  view?.destroy()
  view = null
})

// external reload
watch(
  () => props.tab.reloadToken,
  () => {
    if (!view) return
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: props.tab.markdown }
    })
    emitOutline()
  }
)

// theme switching
watch(
  () => settings.isDark,
  (isDark) => {
    if (!view) return
    view.dispatch({
      effects: themeComp.reconfigure(
        isDark
          ? syntaxHighlighting(kmdeDarkHighlight)
          : syntaxHighlighting(defaultHighlightStyle, { fallback: true })
      )
    })
  }
)

defineExpose({
  getSelection,
  whenReady,
  focus,
  getScrollElement,
  applyExternalContent,
  flush,
  jumpTo,
  emitOutline,
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
  <div ref="hostRef" class="source-editor"></div>
</template>

<style scoped>
.source-editor {
  height: 100%;
  overflow: hidden;
  background: var(--kme-bg);
}

.source-editor :deep(.cm-editor) {
  height: 100%;
}
</style>
