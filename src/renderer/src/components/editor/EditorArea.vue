<script setup lang="ts">
import { computed, ref, watch, nextTick, onBeforeUnmount } from 'vue'
import { useMessage } from 'naive-ui'
import type { OutlineItem } from '@shared/types'
import { useTabsStore } from '../../stores/tabs.store'
import { t } from '@/i18n'
import TiptapEditor from './tiptap/TiptapEditor.vue'
import SourceEditor from './source/SourceEditor.vue'

const emit = defineEmits<{
  (e: 'outline-change', items: OutlineItem[], activeId: string | null): void
  (e: 'request-save-as', tabId: string): void
}>()

const tabs = useTabsStore()
const message = useMessage()

const activeTab = computed(() => tabs.activeTab)

interface EditorInstance {
  flush: () => string
  jumpTo: (item: OutlineItem) => void
  emitOutline: () => void
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

const AUTOSAVE_DELAY = 800
let autosaveTimer: ReturnType<typeof setTimeout> | null = null

function cancelAutosave(): void {
  if (autosaveTimer) {
    clearTimeout(autosaveTimer)
    autosaveTimer = null
  }
}

watch(
  () => {
    const tab = tabs.activeTab
    return tab ? `${tab.id}:${tab.dirty}` : ''
  },
  (value) => {
    cancelAutosave()
    if (!value.endsWith(':true')) return
    const tab = tabs.activeTab
    if (!tab || !tab.path || tab.deleted) {
      // untitled/deleted tabs need an explicit save-as, never autosave
      return
    }
    const id = tab.id
    autosaveTimer = setTimeout(async () => {
      const result = await tabs.saveTab(id)
      if (result === 'error') {
        message.error(t('editor.autosaveFailed'))
      }
    }, AUTOSAVE_DELAY)
  }
)

// switching between already-open tabs reuses resident editor instances,
// so the newly activated editor must re-publish its outline once visible
watch(
  () => tabs.activeTabId,
  (id) => {
    if (!id) return
    nextTick(() => {
      editorInstances.get(id)?.emitOutline()
    })
  }
)

onBeforeUnmount(() => {
  cancelAutosave()
  editorInstances.clear()
})

function flushActive(): string | null {
  const tab = tabs.activeTab
  if (!tab) return null
  return editorInstances.get(tab.id)?.flush() ?? null
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

function onToggleMode(): void {
  const tab = tabs.activeTab
  if (!tab) return
  flushActive()
  tabs.toggleMode(tab.id)
}

defineExpose({ flushActive, jumpTo })
</script>

<template>
  <div class="editor-area">
    <template v-for="tab in tabs.tabs" :key="tab.id">
      <TiptapEditor
        v-if="!tab.loading && tab.mode === 'wysiwyg'"
        v-show="tab.id === tabs.activeTabId"
        :ref="(el) => setEditorRef(tab.id, el as EditorInstance | null)"
        :tab="tab"
        @update="(md: string) => onEditorUpdate(tab, md)"
        @outline-change="(items: OutlineItem[], activeId: string | null) => onEditorOutline(tab, items, activeId)"
        @toggle-mode="onToggleMode"
      />
      <SourceEditor
        v-else-if="!tab.loading && tab.mode !== 'wysiwyg'"
        v-show="tab.id === tabs.activeTabId"
        :ref="(el) => setEditorRef(tab.id, el as EditorInstance | null)"
        :tab="tab"
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
