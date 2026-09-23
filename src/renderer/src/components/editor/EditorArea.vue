<script setup lang="ts">
import { watch, nextTick, onBeforeUnmount, onMounted, ref, computed } from 'vue'
import type { EditorSelectionState, OutlineItem } from '@shared/types'
import { useTabsStore, type EditorTab } from '../../stores/tabs.store'
import TiptapEditor from './tiptap/TiptapEditor.vue'
import SourceEditor from './source/SourceEditor.vue'
import SearchReplaceBar from './SearchReplaceBar.vue'

const props = defineProps<{ locked: boolean }>()

const emit = defineEmits<{
  (e: 'outline-change', items: OutlineItem[], activeId: string | null): void
  (e: 'request-save-as', tabId: string): void
}>()

const tabs = useTabsStore()

interface SearchState {
  total: number
  current: number
}

interface EditorInstance {
  getSelection: () => EditorSelectionState | null
  whenReady: () => Promise<boolean>
  focus: () => void
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

const editorInstances = new Map<string, EditorInstance>()

function setEditorRef(tabId: string, el: unknown): void {
  const inst = el as EditorInstance | null
  if (inst && typeof inst.flush === 'function') {
    editorInstances.set(tabId, inst)
  } else {
    editorInstances.delete(tabId)
  }
}

// switching between already-open tabs reuses resident editor instances,
// so the newly activated editor must re-publish its outline once visible
watch(
  () => tabs.activeTabId,
  (id) => {
    closeSearch()
    if (!id) return
    nextTick(() => {
      editorInstances.get(id)?.emitOutline()
    })
  }
)

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown, true)
  flushAll()
  editorInstances.clear()
})

function flushActive(): string | null {
  const tab = tabs.activeTab
  if (!tab) return null
  return flushTab(tab.id)
}

function flushTab(id: string): string | null {
  const instance = editorInstances.get(id)
  if (!instance) return null
  const markdown = instance.flush()
  // 即使正文未变，也要保存编辑器模型中的光标；未就绪时不覆盖上次位置。
  const selection = instance.getSelection()
  if (selection) tabs.updateTabSelection(id, selection)
  return markdown
}

function flushAll(): void {
  for (const id of editorInstances.keys()) flushTab(id)
}

async function focusActive(): Promise<void> {
  const id = tabs.activeTabId
  await nextTick()
  if (!id) return
  const instance = editorInstances.get(id)
  if (!instance || !await instance.whenReady()) return
  await nextTick()
  // 恢复等待期间切页、关闭或弹出冲突对话框时，不再执行迟到的聚焦。
  if (props.locked || tabs.conflict || tabs.activeTabId !== id || editorInstances.get(id) !== instance) return
  instance.focus()
}

function jumpTo(item: OutlineItem): void {
  const tab = tabs.activeTab
  if (!tab) return
  editorInstances.get(tab.id)?.jumpTo(item)
}

function onEditorUpdate(tab: EditorTab, markdown: string): void {
  tabs.updateTabContent(tab.id, markdown)
}

function onEditorOutline(tab: EditorTab, items: OutlineItem[], activeId: string | null): void {
  if (tab.id === tabs.activeTabId) {
    emit('outline-change', items, activeId)
  }
}

// ---------------- find / replace ----------------

const searchBarRef = ref<InstanceType<typeof SearchReplaceBar> | null>(null)
const searchVisible = ref(false)
const searchOffsetTop = computed(() => (tabs.activeTab?.mode === 'wysiwyg' ? 48 : 8))
const searchTotal = ref(0)
const searchCurrent = ref(0)

function activeInstance(): EditorInstance | undefined {
  const id = tabs.activeTabId
  return id ? editorInstances.get(id) : undefined
}

function applySearchState(state: SearchState | undefined): void {
  if (!state) return
  searchTotal.value = state.total
  searchCurrent.value = state.current
}

function openSearch(): void {
  const tab = tabs.activeTab
  if (!tab || tab.loading) return
  searchVisible.value = true
  nextTick(() => searchBarRef.value?.focus())
}

function onSearchFind(query: string, caseSensitive: boolean): void {
  applySearchState(activeInstance()?.searchUpdate(query, caseSensitive))
}

function onSearchNext(): void {
  applySearchState(activeInstance()?.searchNext())
}

function onSearchPrev(): void {
  applySearchState(activeInstance()?.searchPrev())
}

function onSearchReplace(replacement: string): void {
  applySearchState(activeInstance()?.searchReplace(replacement))
}

function onSearchReplaceAll(replacement: string): void {
  applySearchState(activeInstance()?.searchReplaceAll(replacement))
}

function closeSearch(): void {
  activeInstance()?.searchClear()
  searchVisible.value = false
  searchTotal.value = 0
  searchCurrent.value = 0
}

function onGlobalKeydown(e: KeyboardEvent): void {
  if ((e.ctrlKey || e.metaKey) && !e.altKey && (e.key === 'f' || e.key === 'F')) {
    const tag = (e.target as HTMLElement | null)?.tagName
    if (tag === 'INPUT' || tag === 'TEXTAREA') return
    if (!tabs.activeTab || tabs.activeTab.loading) return
    e.preventDefault()
    openSearch()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onGlobalKeydown, true)
})

function onToggleMode(): void {
  const tab = tabs.activeTab
  if (!tab) return
  closeSearch()
  flushActive()
  tabs.toggleMode(tab.id)
}

defineExpose({ flushActive, flushTab, flushAll, jumpTo, focusActive })
</script>

<template>
  <div class="editor-area">
    <SearchReplaceBar
      v-if="searchVisible"
      ref="searchBarRef"
      :total="searchTotal"
      :current="searchCurrent"
      :offset-top="searchOffsetTop"
      @find="onSearchFind"
      @find-next="onSearchNext"
      @find-prev="onSearchPrev"
      @replace="onSearchReplace"
      @replace-all="onSearchReplaceAll"
      @close="closeSearch"
    />
    <template v-for="tab in tabs.tabs" :key="tab.id">
      <TiptapEditor
        v-if="!tab.loading && tab.mode === 'wysiwyg'"
        v-show="tab.id === tabs.activeTabId"
        :ref="(el) => setEditorRef(tab.id, el as EditorInstance | null)"
        :tab="tab"
        :locked="locked"
        @update="(md: string) => onEditorUpdate(tab, md)"
        @outline-change="(items: OutlineItem[], activeId: string | null) => onEditorOutline(tab, items, activeId)"
        @toggle-mode="onToggleMode"
      />
      <SourceEditor
        v-else-if="!tab.loading && tab.mode !== 'wysiwyg'"
        v-show="tab.id === tabs.activeTabId"
        :ref="(el) => setEditorRef(tab.id, el as EditorInstance | null)"
        :tab="tab"
        :locked="locked"
        @update="(md: string) => onEditorUpdate(tab, md)"
        @outline-change="(items: OutlineItem[], activeId: string | null) => onEditorOutline(tab, items, activeId)"
      />
      <div
        v-else
        v-show="tab.id === tabs.activeTabId"
        class="editor-skeleton"
      >
        <div class="editor-skeleton-page">
          <div class="skeleton-line is-title"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
          <div class="skeleton-line"></div>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.editor-area {
  flex: 1;
  min-width: 0;
  position: relative;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  background: var(--kme-bg);
}

.editor-skeleton {
  flex: 1;
  display: flex;
  justify-content: center;
  overflow: hidden;
  background: var(--kme-bg);
}

.editor-skeleton-page {
  width: 100%;
  max-width: 820px;
  padding: 32px 32px 120px;
}

.skeleton-line {
  height: 14px;
  margin-top: 18px;
  border-radius: 6px;
  background: var(--kme-bg-hover);
  animation: skeleton-pulse 1.4s ease-in-out infinite;
}

.skeleton-line.is-title {
  height: 26px;
  width: 42%;
  margin-top: 6px;
  border-radius: 8px;
}

.skeleton-line:nth-child(2) { width: 92%; }
.skeleton-line:nth-child(3) { width: 78%; }
.skeleton-line:nth-child(4) { width: 96%; }
.skeleton-line:nth-child(5) { width: 64%; }
.skeleton-line:nth-child(6) { width: 88%; animation-delay: 0.15s; }
.skeleton-line:nth-child(7) { width: 84%; animation-delay: 0.3s; }
.skeleton-line:nth-child(8) { width: 55%; animation-delay: 0.45s; }

@keyframes skeleton-pulse {
  50% {
    opacity: 0.45;
  }
}
</style>
