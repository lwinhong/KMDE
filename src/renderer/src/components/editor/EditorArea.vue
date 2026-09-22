<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from 'vue'
import { useMessage } from 'naive-ui'
import type { OutlineItem } from '@shared/types'
import { useTabsStore } from '../../stores/tabs.store'
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
}

const editorRef = ref<EditorInstance | null>(null)

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
        message.error('自动保存失败')
      }
    }, AUTOSAVE_DELAY)
  }
)

onBeforeUnmount(() => {
  cancelAutosave()
})

function flushActive(): string | null {
  return editorRef.value ? editorRef.value.flush() : null
}

function jumpTo(item: OutlineItem): void {
  editorRef.value?.jumpTo(item)
}

function onUpdate(markdown: string): void {
  const tab = tabs.activeTab
  if (tab) {
    tabs.updateTabContent(tab.id, markdown)
  }
}

function onOutlineChange(items: OutlineItem[], activeId: string | null): void {
  emit('outline-change', items, activeId)
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
    <TiptapEditor
      v-if="activeTab && activeTab.mode === 'wysiwyg'"
      :key="activeTab.id"
      ref="editorRef"
      :tab="activeTab"
      @update="onUpdate"
      @outline-change="onOutlineChange"
      @toggle-mode="onToggleMode"
    />
    <SourceEditor
      v-else-if="activeTab"
      :key="activeTab.id"
      ref="editorRef"
      :tab="activeTab"
      @update="onUpdate"
      @outline-change="onOutlineChange"
    />
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
</style>
