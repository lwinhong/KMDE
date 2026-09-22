<script setup lang="ts">
import { useTabsStore } from '../../stores/tabs.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { MarkdownIcon } from '../editor/tiptap/icons/index.jsx'

const emit = defineEmits<{
  (e: 'open-file'): void
  (e: 'open-folder'): void
  (e: 'new-file'): void
  (e: 'close-tab', id: string): void
}>()

const tabs = useTabsStore()
const workspace = useWorkspaceStore()

function onTabClick(id: string): void {
  tabs.activateTab(id)
}

function onTabClose(e: MouseEvent, id: string): void {
  e.stopPropagation()
  emit('close-tab', id)
}

function onAuxClick(e: MouseEvent, id: string): void {
  if (e.button === 1) {
    e.preventDefault()
    emit('close-tab', id)
  }
}
</script>

<template>
  <div class="tabbar">
    <div class="tabbar-tabs" role="tablist">
      <div
        v-for="tab in tabs.tabs"
        :key="tab.id"
        class="tabbar-tab"
        :class="{ 'is-active': tab.id === tabs.activeTabId }"
        role="tab"
        :title="tab.path ?? tab.fileName"
        @click="onTabClick(tab.id)"
        @auxclick="onAuxClick($event, tab.id)"
      >
        <span class="tabbar-tab-icon"><MarkdownIcon :size="13" /></span>
        <span class="tabbar-tab-label">
          {{ tab.fileName }}
          <span v-if="tab.deleted" class="tabbar-tab-deleted">{{ $t('tabbar.deleted') }}</span>
        </span>
        <span class="tabbar-tab-dot" :class="{ 'is-dirty': tab.dirty }" />
        <button class="tabbar-tab-close" :title="$t('common.close')" @click="onTabClose($event, tab.id)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M22 2 2 22 M2 2l20 20" />
          </svg>
        </button>
      </div>
    </div>
    <div class="tabbar-actions">
      <button class="tabbar-action-btn" :title="$t('tabbar.newFile')" @click="emit('new-file')">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <button class="tabbar-action-btn" :title="$t('tabbar.openFile')" @click="emit('open-file')">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 7c0-1.1.9-2 2-2h4l2 2h8c1.1 0 2 .9 2 2v8c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V7z" />
        </svg>
      </button>
      <button class="tabbar-action-btn" :title="$t('tabbar.openFolder')" @click="emit('open-folder')">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v1H3V7z" />
          <path d="M3 10h18l-2 9a2 2 0 0 1-2 1.6H7a2 2 0 0 1-2-1.6L3 10z" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.tabbar {
  display: flex;
  align-items: stretch;
  height: 38px;
  flex-shrink: 0;
  background: var(--kme-tabbar-bg);
  border-bottom: 1px solid var(--kme-border-light);
  user-select: none;
  padding: 0 4px;
}

.tabbar-tabs {
  display: flex;
  align-items: center;
  overflow-x: auto;
  flex: 1;
  min-width: 0;
  scrollbar-width: none;
}

.tabbar-tabs::-webkit-scrollbar {
  display: none;
}

.tabbar-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 10px;
  margin: 5px 2px;
  height: 28px;
  min-width: 120px;
  max-width: 220px;
  border-radius: var(--kme-radius-md);
  color: var(--kme-text-2);
  cursor: pointer;
  position: relative;
  font-size: 12.5px;
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.tabbar-tab:hover {
  background: var(--kme-bg-hover);
}

.tabbar-tab.is-active {
  background: var(--kme-bg);
  color: var(--kme-text-1);
  box-shadow: var(--kme-shadow-xs);
}

.tabbar-tab-icon {
  display: inline-flex;
  color: var(--kme-primary);
  flex-shrink: 0;
}

.tabbar-tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.tabbar-tab-deleted {
  color: var(--kme-danger);
  font-size: 11px;
}

.tabbar-tab-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--kme-radius-full);
  flex-shrink: 0;
}

.tabbar-tab-dot.is-dirty {
  background: var(--kme-warning);
}

.tabbar-tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--kme-radius-full);
  background: transparent;
  color: var(--kme-text-3);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: background 0.15s, color 0.15s, opacity 0.15s;
}

.tabbar-tab-close svg {
  width: 16px;
  height: 16px;
}

.tabbar-tab:hover .tabbar-tab-close,
.tabbar-tab.is-active .tabbar-tab-close {
  opacity: 1;
}

.tabbar-tab-close:hover {
  background: var(--kme-bg-active);
  color: var(--kme-text-1);
}

.tabbar-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 8px;
  flex-shrink: 0;
}

.tabbar-action-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: var(--kme-radius-md);
  background: transparent;
  color: var(--kme-text-2);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.tabbar-action-btn:hover {
  background: var(--kme-bg-active);
  color: var(--kme-text-1);
}
</style>
