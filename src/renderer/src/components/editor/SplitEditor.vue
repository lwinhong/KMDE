<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import type { EditorSelectionState, OutlineItem } from '@shared/types'
import type { EditorTab } from '@/stores/tabs.store'
import TiptapEditor from './tiptap/TiptapEditor.vue'
import SourceEditor from './source/SourceEditor.vue'
import Resizer from '../workbench/Resizer.vue'
import { createScrollSync, type ScrollSyncHandle } from '@/composables/useScrollSync'

interface SearchState {
  total: number
  current: number
}

interface PaneInstance {
  getSelection: () => EditorSelectionState | null
  whenReady: () => Promise<boolean>
  focus: () => void
  getScrollElement: () => HTMLElement | null
  applyExternalContent: (markdown: string) => void
  flush: () => string
  jumpTo: (item: OutlineItem) => void
  emitOutline: () => void
  searchUpdate: (query: string, caseSensitive: boolean) => SearchState
  searchNext: () => SearchState
  searchPrev: () => SearchState
  searchReplace: (replacement: string) => SearchState
  searchReplaceAll: (replacement: string) => SearchState
  searchClear: () => void
  getSelectedText: () => string
}

const props = defineProps<{
  tab: EditorTab
  locked: boolean
}>()

const emit = defineEmits<{
  (e: 'update', markdown: string): void
  (e: 'outline-change', items: OutlineItem[], activeId: string | null): void
  (e: 'toggle-mode'): void
}>()

const rootRef = ref<HTMLElement | null>(null)
const wysPaneRef = ref<HTMLElement | null>(null)
const srcPaneRef = ref<HTMLElement | null>(null)
const wysiwygRef = ref<PaneInstance | null>(null)
const sourceRef = ref<PaneInstance | null>(null)

// 聚焦侧跟随已保存光标的坐标系；无光标时先落在富文本侧。
const activeSide = ref<'wysiwyg' | 'source'>(props.tab.selection?.mode === 'source' ? 'source' : 'wysiwyg')
const leftRatio = ref(0.5)

let scrollSync: ScrollSyncHandle | null = null

onMounted(async () => {
  const [wysOk, srcOk] = await Promise.all([
    wysiwygRef.value?.whenReady() ?? Promise.resolve(false),
    sourceRef.value?.whenReady() ?? Promise.resolve(false)
  ])
  const wysEl = wysOk ? wysiwygRef.value?.getScrollElement() ?? null : null
  const srcEl = srcOk ? sourceRef.value?.getScrollElement() ?? null : null
  // 等待就绪期间组件可能已被卸载或仍在后台页签，此时不挂联动。
  if (rootRef.value?.isConnected && wysEl && srcEl) {
    scrollSync = createScrollSync(wysEl, srcEl)
  }
})

onBeforeUnmount(() => {
  scrollSync?.destroy()
  scrollSync = null
})

// 任一侧编辑都会写回 tab.markdown；编辑侧同步为 no-op，另一侧应用最小差异，
// 程序同步触发的 update 与本 watch 之间不会形成循环。
watch(() => props.tab.markdown, (markdown) => {
  wysiwygRef.value?.applyExternalContent(markdown)
  sourceRef.value?.applyExternalContent(markdown)
})

function paneFor(side: 'wysiwyg' | 'source'): PaneInstance | null {
  return side === 'source' ? sourceRef.value : wysiwygRef.value
}

function activePane(): PaneInstance | null {
  return paneFor(activeSide.value)
}

function onFocusIn(e: FocusEvent): void {
  const target = e.target as Node | null
  if (!target) return
  if (srcPaneRef.value?.contains(target)) activeSide.value = 'source'
  else if (wysPaneRef.value?.contains(target)) activeSide.value = 'wysiwyg'
}

function onPaneResize(deltaPx: number): void {
  const width = rootRef.value?.clientWidth ?? 0
  if (width <= 0) return
  leftRatio.value = Math.min(0.8, Math.max(0.2, leftRatio.value + deltaPx / width))
}

function onEditorUpdate(markdown: string): void {
  emit('update', markdown)
}

// 大纲与后续实例接口都以聚焦侧为准，避免两个面板互相覆盖。
function onWysiwygOutline(items: OutlineItem[], activeId: string | null): void {
  if (activeSide.value === 'wysiwyg') emit('outline-change', items, activeId)
}

function onSourceOutline(items: OutlineItem[], activeId: string | null): void {
  if (activeSide.value === 'source') emit('outline-change', items, activeId)
}

// ---------------- 对外实例接口（与单视图编辑器保持一致） ----------------

function getSelection(): EditorSelectionState | null {
  return activePane()?.getSelection() ?? null
}

async function whenReady(): Promise<boolean> {
  const [wysOk, srcOk] = await Promise.all([
    wysiwygRef.value?.whenReady() ?? Promise.resolve(false),
    sourceRef.value?.whenReady() ?? Promise.resolve(false)
  ])
  return wysOk && srcOk
}

function focus(): void {
  activePane()?.focus()
}

function flush(): string {
  const active = activePane()
  const inactive = paneFor(activeSide.value === 'source' ? 'wysiwyg' : 'source')
  inactive?.flush()
  return active?.flush() ?? props.tab.markdown
}

function jumpTo(item: OutlineItem): void {
  activePane()?.jumpTo(item)
}

function emitOutline(): void {
  activePane()?.emitOutline()
}

function searchUpdate(query: string, caseSensitive: boolean): SearchState {
  return activePane()?.searchUpdate(query, caseSensitive) ?? { total: 0, current: 0 }
}

function searchNext(): SearchState {
  return activePane()?.searchNext() ?? { total: 0, current: 0 }
}

function searchPrev(): SearchState {
  return activePane()?.searchPrev() ?? { total: 0, current: 0 }
}

function searchReplace(replacement: string): SearchState {
  return activePane()?.searchReplace(replacement) ?? { total: 0, current: 0 }
}

function searchReplaceAll(replacement: string): SearchState {
  return activePane()?.searchReplaceAll(replacement) ?? { total: 0, current: 0 }
}

function searchClear(): void {
  activePane()?.searchClear()
}

function getSelectedText(): string {
  return activePane()?.getSelectedText() ?? ''
}

defineExpose({
  getSelection,
  whenReady,
  focus,
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
  <div ref="rootRef" class="split-editor" @focusin.capture="onFocusIn">
    <div ref="wysPaneRef" class="split-pane" :style="{ width: `${leftRatio * 100}%` }">
      <TiptapEditor
        ref="wysiwygRef"
        :tab="tab"
        :locked="locked"
        @update="onEditorUpdate"
        @outline-change="onWysiwygOutline"
        @toggle-mode="emit('toggle-mode')"
      />
    </div>
    <Resizer side="left" @resize="onPaneResize" />
    <div ref="srcPaneRef" class="split-pane split-pane-source">
      <div class="split-source-header"></div>
      <SourceEditor
        ref="sourceRef"
        :tab="tab"
        :locked="locked"
        @update="onEditorUpdate"
        @outline-change="onSourceOutline"
      />
    </div>
  </div>
</template>

<style scoped>
.split-editor {
  height: 100%;
  display: flex;
  min-width: 0;
  overflow: hidden;
  background: var(--kme-bg);
}

.split-pane {
  min-width: 0;
  overflow: hidden;
  flex: none;
}

/* 右侧源码区与左侧工具栏（40px）对齐，两侧内容起点一致。 */
.split-pane-source {
  flex: 1 1 0;
  display: flex;
  flex-direction: column;
}

.split-source-header {
  flex-shrink: 0;
  height: 40px;
  background: var(--kme-glass-bg);
  backdrop-filter: blur(var(--kme-blur)) saturate(1.4);
  -webkit-backdrop-filter: blur(var(--kme-blur)) saturate(1.4);
  box-shadow: var(--kme-shadow-sm);
  z-index: 50;
}

.split-pane-source :deep(.source-editor) {
  flex: 1;
  min-height: 0;
}

/* 分屏中间可见分割线，参考侧边栏竖线样式 */
.split-editor :deep(.resizer)::before {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: 50%;
  width: 1px;
  transform: translateX(-50%);
  background: var(--kme-border-light);
  transition: background 0.15s;
}

.split-editor :deep(.resizer:hover)::before,
.split-editor :deep(.resizer.is-dragging)::before {
  background: transparent;
}
</style>
