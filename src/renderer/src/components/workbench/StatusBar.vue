<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useSettingsStore } from '../../stores/settings.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useWorkspaceStore } from '../../stores/workspace.store'

const settings = useSettingsStore()
const tabs = useTabsStore()
const workspace = useWorkspaceStore()
const { t } = useI18n()

const charCount = computed(() => {
  const tab = tabs.activeTab
  if (!tab) return 0
  return tab.markdown.replace(/\s/g, '').length
})

const modeLabel = computed(() => (tabs.activeTab?.mode === 'source' ? t('statusbar.sourceMode') : t('statusbar.wysiwygMode')))
</script>

<template>
  <div class="statusbar">
    <div class="statusbar-left">
      <span v-if="tabs.activeTab" class="statusbar-item" :title="tabs.activeTab.path ?? ''">
        {{ tabs.activeTab.path ?? $t('statusbar.unsaved') }}
        <template v-if="tabs.activeTab.deleted">{{ $t('statusbar.fileDeleted') }}</template>
      </span>
      <span v-else class="statusbar-item">KMDE</span>
      <span v-if="workspace.isOpen" class="statusbar-item" :title="workspace.root ?? ''">
        {{ $t('statusbar.workspace', { name: workspace.rootName }) }}
        <template v-if="workspace.indexing">{{ $t('statusbar.indexing') }}</template>
      </span>
    </div>
    <div class="statusbar-right">
      <span v-if="tabs.activeTab" class="statusbar-item">{{ $t('statusbar.charCount', { count: charCount }) }}</span>
      <span v-if="tabs.activeTab" class="statusbar-item">{{ modeLabel }}</span>
      <button class="statusbar-btn" :title="$t('statusbar.toggleTheme')" @click="settings.toggleTheme()">
        {{ settings.isDark ? $t('statusbar.dark') : $t('statusbar.light') }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.statusbar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 24px;
  padding: 0 10px;
  flex-shrink: 0;
  background: var(--kme-tabbar-bg);
  border-top: 1px solid var(--kme-border-light);
  font-size: 11.5px;
  color: var(--kme-text-3);
  user-select: none;
}

.statusbar-left,
.statusbar-right {
  display: flex;
  align-items: center;
  gap: 14px;
  min-width: 0;
}

.statusbar-item {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 420px;
}

.statusbar-btn {
  border: none;
  background: transparent;
  color: var(--kme-text-3);
  font-size: 11.5px;
  line-height: 1;
  height: 18px;
  padding: 0 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--kme-radius-sm);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.statusbar-btn:hover {
  background: var(--kme-bg-hover);
  color: var(--kme-text-1);
}
</style>
