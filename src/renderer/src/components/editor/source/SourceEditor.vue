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
import { EditorState, Compartment, type Extension } from '@codemirror/state'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { foldGutter, indentOnInput, bracketMatching, foldKeymap, syntaxHighlighting, defaultHighlightStyle } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import { languages } from '@codemirror/language-data'
import { oneDark } from '@codemirror/theme-one-dark'
import { search, searchKeymap } from '@codemirror/search'
import type { OutlineItem } from '@shared/types'
import type { EditorTab } from '@/stores/tabs.store'
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

watch(() => props.locked, (locked) => {
  view?.dispatch({ effects: editableComp.reconfigure([
    EditorView.editable.of(!locked), EditorState.readOnly.of(locked)
  ]) })
})

const kmdeCmTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '13.5px',
    backgroundColor: 'var(--kme-bg)',
    color: 'var(--kme-text-1)'
  },
  '.cm-scroller': {
    fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, 'Courier New', monospace",
    lineHeight: '1.75'
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
  '.cm-cursor': { borderLeftColor: 'var(--kme-primary)' }
})

function buildExtensions(): Extension[] {
  const highlight = settings.isDark ? oneDark : syntaxHighlighting(defaultHighlightStyle, { fallback: true })
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
    keymap.of([...defaultKeymap, ...historyKeymap, ...foldKeymap, ...searchKeymap, indentWithTab]),
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

onMounted(() => {
  if (!hostRef.value) return
  view = new EditorView({
    state: EditorState.create({
      doc: props.tab.markdown,
      extensions: buildExtensions()
    }),
    parent: hostRef.value
  })
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
        isDark ? oneDark : syntaxHighlighting(defaultHighlightStyle, { fallback: true })
      )
    })
  }
)

defineExpose({ flush, jumpTo, emitOutline })
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
