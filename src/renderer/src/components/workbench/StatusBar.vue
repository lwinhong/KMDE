<script setup lang="ts">
import { computed } from 'vue'
import { useSettingsStore } from '../../stores/settings.store'
import { useTabsStore } from '../../stores/tabs.store'
import { useWorkspaceStore } from '../../stores/workspace.store'

const settings = useSettingsStore()
const tabs = useTabsStore()
const workspace = useWorkspaceStore()

const charCount = computed(() => {
  const tab = tabs.activeTab
  if (!tab) return 0
  return tab.markdown.replace(/\s/g, '').length
})

const modeLabel = computed(() => (tabs.activeTab?.mode === 'source' ? '源码模式' : '所见即所得'))
</script>

<template>
  <div class="statusbar">
    <div class="statusbar-left">
      <span v-if="tabs.activeTab" class="statusbar-item" :title="tabs.activeTab.path ?? ''">
        {{ tabs.activeTab.path ?? '未保存' }}
        <template v-if="tabs.activeTab.deleted">（文件已删除）</template>
      </span>
      <span v-else class="statusbar-item">KMDE</span>
      <span v-if="workspace.isOpen" class="statusbar-item" :title="workspace.root ?? ''">
        工作区: {{ workspace.rootName }}
        <template v-if="workspace.indexing">（索引中…）</template>
      </span>
    </div>
    <div class="statusbar-right">
      <span v-if="tabs.activeTab" class="statusbar-item">{{ charCount }} 字</span>
      <span v-if="tabs.activeTab" class="statusbar-item">{{ modeLabel }}</span>
      <button class="statusbar-btn" title="切换主题 (F11)" @click="settings.toggleTheme()">
        {{ settings.isDark ? '🌙 深色' : '☀️ 浅色' }}
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
  border-top: 1px solid var(--kme-border);
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
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 4px;
}

.statusbar-btn:hover {
  background: var(--kme-bg-hover);
  color: var(--kme-text-1);
}
</style>
