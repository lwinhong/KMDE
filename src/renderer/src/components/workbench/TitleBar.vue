<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed } from 'vue'
import { NDropdown } from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import type { MenuCommand } from '@shared/types'
import { useTabsStore } from '@/stores/tabs.store'

const emit = defineEmits<{
  (e: 'command', command: MenuCommand): void
  (e: 'request-close'): void
}>()

const tabs = useTabsStore()

const title = computed(() => {
  const tab = tabs.activeTab
  if (!tab) return 'KMDE'
  return `${tab.dirty ? '● ' : ''}${tab.fileName} - KMDE`
})

// ---------------- window controls ----------------

const maximized = ref(false)
let unsubState: (() => void) | null = null

onMounted(async () => {
  maximized.value = await window.kmde.isWindowMaximized()
  unsubState = window.kmde.onWindowState((value) => {
    maximized.value = value
  })
})

onBeforeUnmount(() => {
  unsubState?.()
})

function minimize(): void {
  window.kmde.minimizeWindow()
}

function toggleMaximize(): void {
  window.kmde.toggleMaximizeWindow()
}

function requestClose(): void {
  emit('request-close')
}

// ---------------- menus ----------------

interface MenuDef {
  label: string
  options: DropdownOption[]
}

const div = (key: string): DropdownOption => ({ type: 'divider', key })

function item(key: MenuCommand | 'quit' | 'reload' | 'tiptap-site', label: string, shortcut?: string): DropdownOption {
  return { key, label: shortcut ? `${label}    ${shortcut}` : label }
}

const menus = computed<DropdownOption[]>(() => [
  {
    key: 'file',
    label: '文件',
    children: [
      item('new-file', '新建文件', 'Ctrl+N'),
      div('f1'),
      item('open-file', '打开文件…', 'Ctrl+O'),
      item('open-folder', '打开文件夹…', 'Ctrl+Shift+O'),
      div('f2'),
      item('save', '保存', 'Ctrl+S'),
      item('save-as', '另存为…', 'Ctrl+Shift+S'),
      div('f3'),
      item('export', '导出…', 'Ctrl+Shift+E'),
      div('f4'),
      item('quit', '退出', 'Ctrl+Q')
    ]
  },
  {
    key: 'edit',
    label: '编辑',
    children: [
      item('close-tab', '关闭标签页', 'Ctrl+W'),
      div('e1'),
      item('command-palette', '命令面板', 'Ctrl+Shift+P'),
      item('quick-open', '快速打开文件…', 'Ctrl+P')
    ]
  },
  {
    key: 'view',
    label: '视图',
    children: [
      item('toggle-mode', '切换 源码/所见即所得 模式', 'Ctrl+/'),
      div('v1'),
      item('toggle-sidebar', '侧边栏', 'Ctrl+\\'),
      item('toggle-outline', '大纲面板', 'Ctrl+Shift+U'),
      item('toggle-theme', '深色/浅色主题', 'F11'),
      div('v2'),
      item('reload', '重新加载', 'Ctrl+R')
    ]
  },
  {
    key: 'help',
    label: '帮助',
    children: [item('about', '关于 KMDE'), item('tiptap-site', 'Tiptap 官网')]
  }
])

function onMenuSelect(key: string | number): void {
  switch (key) {
    case 'quit':
      requestClose()
      break
    case 'reload':
      location.reload()
      break
    case 'tiptap-site':
      window.open('https://tiptap.dev', '_blank', 'noopener')
      break
    case 'about':
      emit('command', 'show-settings-info')
      break
    default:
      emit('command', key as MenuCommand)
  }
}
</script>

<template>
  <div class="title-bar" :class="{ 'is-maximized': maximized }">
    <div class="title-bar-left">
      <div class="title-bar-logo">
        <svg width="16" height="16" viewBox="0 0 256 256" aria-hidden="true">
          <rect x="8" y="8" width="240" height="240" rx="56" fill="#2563eb" />
          <path d="M78 72 L78 184 M78 128 L150 72 M78 128 L150 184"
            stroke="#fff" stroke-width="10" stroke-linecap="round" fill="none" />
          <path d="M168 72 L168 184" stroke="#ffd60a" stroke-width="12" stroke-linecap="round" />
        </svg>
      </div>
      <NDropdown
        v-for="menu in menus"
        :key="menu.key"
        trigger="click"
        :options="(menu as DropdownOption).children"
        placement="bottom-start"
        :show-arrow="false"
        @select="onMenuSelect"
      >
        <button class="title-bar-menu-btn">{{ (menu as DropdownOption).label }}</button>
      </NDropdown>
    </div>

    <div class="title-bar-title" :title="title">{{ title }}</div>

    <div class="title-bar-controls">
      <button class="title-bar-ctl" title="最小化" @click="minimize">
        <svg width="11" height="11" viewBox="0 0 11 11"><path d="M1 5.5 h9" stroke="currentColor" stroke-width="1" /></svg>
      </button>
      <button class="title-bar-ctl" :title="maximized ? '还原' : '最大化'" @click="toggleMaximize">
        <svg v-if="!maximized" width="11" height="11" viewBox="0 0 11 11">
          <rect x="1.5" y="1.5" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1" />
        </svg>
        <svg v-else width="11" height="11" viewBox="0 0 11 11">
          <rect x="1.5" y="3.5" width="6" height="6" fill="none" stroke="currentColor" stroke-width="1" />
          <path d="M3.5 3.5 V1.5 h6 v6 h-2" fill="none" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
      <button class="title-bar-ctl title-bar-close" title="关闭" @click="requestClose">
        <svg width="11" height="11" viewBox="0 0 11 11">
          <path d="M1.5 1.5 L9.5 9.5 M9.5 1.5 L1.5 9.5" stroke="currentColor" stroke-width="1.1" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.title-bar {
  height: 34px;
  flex-shrink: 0;
  display: flex;
  align-items: stretch;
  background: var(--kme-bg-sidebar);
  border-bottom: 1px solid var(--kme-border);
  user-select: none;
  -webkit-app-region: drag;
}

.title-bar.is-maximized {
  border-top: none;
}

.title-bar-left {
  display: flex;
  align-items: center;
  gap: 2px;
  padding-left: 8px;
  -webkit-app-region: no-drag;
}

.title-bar-logo {
  display: flex;
  align-items: center;
  padding: 0 8px 0 4px;
}

.title-bar-menu-btn {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--kme-text-2);
  font-size: 12.5px;
  padding: 5px 10px;
  border-radius: 5px;
  cursor: default;
  line-height: 1.4;
}

.title-bar-menu-btn:hover {
  background: var(--kme-bg-hover);
  color: var(--kme-text-1);
}

.title-bar-title {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  color: var(--kme-text-3);
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  padding: 0 12px;
}

.title-bar-controls {
  display: flex;
  align-items: stretch;
  -webkit-app-region: no-drag;
}

.title-bar-ctl {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--kme-text-2);
  width: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
}

.title-bar-ctl:hover {
  background: var(--kme-bg-hover);
  color: var(--kme-text-1);
}

.title-bar-close:hover {
  background: #e81123;
  color: #ffffff;
}
</style>
