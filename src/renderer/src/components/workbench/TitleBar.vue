<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, computed, h } from 'vue'
import { NDropdown } from 'naive-ui'
import type { DropdownOption } from 'naive-ui'
import { useI18n } from 'vue-i18n'
import type { MenuCommand, AppLocale } from '@shared/types'
import { useTabsStore } from '@/stores/tabs.store'
import { useSettingsStore } from '@/stores/settings.store'
import {
  IconLogo,
  IconPanelOutline,
  IconPanelSidebar,
  IconWindowClose,
  IconWindowMaximize,
  IconWindowMinimize,
  IconWindowRestore
} from '@/components/icons'

const emit = defineEmits<{
  (e: 'command', command: MenuCommand): void
  (e: 'request-close'): void
}>()

const tabs = useTabsStore()
const settings = useSettingsStore()
const { t } = useI18n()

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
  if (!shortcut) {
    return { key, label }
  }
  return {
    key,
    // label accepts a render function: text left, shortcut right-aligned & dimmed
    label: () =>
      h('div', { class: 'titlebar-menu-row' }, [
        h('span', { class: 'titlebar-menu-text' }, label),
        h('span', { class: 'titlebar-menu-key' }, shortcut)
      ])
  }
}

function languageItem(locale: AppLocale, label: string): DropdownOption {
  return { key: `set-language:${locale}`, label: settings.language === locale ? `✓ ${label}` : label }
}

const menus = computed<DropdownOption[]>(() => [
  {
    key: 'file',
    label: t('menu.file'),
    children: [
      item('new-file', t('menu.newFile'), 'Ctrl+N'),
      div('f1'),
      item('open-file', t('menu.openFile'), 'Ctrl+O'),
      item('open-folder', t('menu.openFolder'), 'Ctrl+Shift+O'),
      item('close-folder', t('sidebar.closeWorkspace')),
      div('f2'),
      item('save', t('menu.save'), 'Ctrl+S'),
      item('save-as', t('menu.saveAs'), 'Ctrl+Shift+S'),
      div('f3'),
      item('export', t('menu.export'), 'Ctrl+Shift+E'),
      div('f4'),
      item('quit', t('menu.quit'), 'Ctrl+Q')
    ]
  },
  {
    key: 'edit',
    label: t('menu.edit'),
    children: [
      item('close-tab', t('menu.closeTab'), 'Ctrl+W'),
      div('e1'),
      item('command-palette', t('menu.commandPalette'), 'Ctrl+Shift+P'),
      item('quick-open', t('menu.quickOpen'), 'Ctrl+P')
    ]
  },
  {
    key: 'view',
    label: t('menu.view'),
    children: [
      item('toggle-mode', t('menu.toggleMode'), 'Ctrl+/'),
      div('v1'),
      item('toggle-sidebar', t('workbench.sidebar'), 'Ctrl+\\'),
      item('toggle-outline', t('workbench.outlinePanel'), 'Ctrl+Shift+U'),
      item('toggle-theme', t('workbench.theme'), 'F11'),
      div('v2'),
      {
        key: 'language',
        label: t('menu.language'),
        children: [languageItem('zh-CN', t('settings.languageZh')), languageItem('en-US', t('settings.languageEn'))]
      },
      div('v3'),
      item('reload', t('menu.reload'), 'Ctrl+R')
    ]
  },
  {
    key: 'help',
    label: t('menu.help'),
    children: [item('about', t('menu.aboutKmde'))]
  }
])

function onMenuSelect(key: string | number): void {
  switch (key) {
    case 'quit':
      requestClose()
      break
    case 'reload':
      emit('command', 'reload')
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
        <IconLogo :size="16" />
      </div>
      <NDropdown
        v-for="menu in menus"
        :key="menu.key"
        size="small"
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

    <div class="title-bar-toggles">
      <button
        class="title-bar-toggle"
        :class="{ active: settings.sidebarVisible }"
        :title="settings.sidebarVisible ? t('sidebar.collapse') : t('sidebar.expand')"
        @click="settings.toggleSidebar()"
      >
        <IconPanelSidebar />
      </button>
      <button
        class="title-bar-toggle"
        :class="{ active: settings.outlineVisible }"
        :title="settings.outlineVisible ? t('outline.collapse') : t('outline.expand')"
        @click="settings.toggleOutline()"
      >
        <IconPanelOutline />
      </button>
    </div>

    <div class="title-bar-controls">
      <button class="title-bar-ctl" :title="$t('workbench.minimize')" @click="minimize">
        <IconWindowMinimize />
      </button>
      <button class="title-bar-ctl" :title="maximized ? $t('workbench.restore') : $t('workbench.maximize')" @click="toggleMaximize">
        <IconWindowMaximize v-if="!maximized" />
        <IconWindowRestore v-else />
      </button>
      <button class="title-bar-ctl title-bar-close" :title="$t('common.close')" @click="requestClose">
        <IconWindowClose />
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
  border-bottom: 1px solid var(--kme-border-light);
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

.title-bar-left :deep(.n-dropdown) {
  display: inline-flex;
  align-items: center;
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
  font-size: 12px;
  line-height: 1;
  height: 24px;
  padding: 0 10px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--kme-radius-sm);
  cursor: default;
  transition: background 0.15s, color 0.15s;
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

.title-bar-toggles {
  display: flex;
  align-items: center;
  justify-content: center;
  padding-right: 8px;
  margin-right: 8px;
  gap: 4px;
  -webkit-app-region: no-drag;
  position: relative;
}

.title-bar-toggles::after {
  content: '';
  position: absolute;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  width: 1px;
  height: 16px;
  background: var(--kme-border-light);
}

.title-bar-toggle {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--kme-text-2);
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: default;
  border-radius: var(--kme-radius-sm);
  /* margin: 4px 1px; */
  transition: background 0.15s, color 0.15s;
}

.title-bar-toggle:hover {
  background: var(--kme-bg-hover);
  color: var(--kme-text-1);
}

.title-bar-toggle.active {
  color: var(--kme-text-1);
  background: var(--kme-bg-hover);
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
  background: var(--kme-danger-close);
  color: #ffffff;
}
</style>

<style>
.titlebar-menu-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 40px;
  width: 100%;
}

.titlebar-menu-text {
  flex-shrink: 0;
  color: inherit;
}

.titlebar-menu-key {
  flex-shrink: 0;
  font-size: 11.5px;
  letter-spacing: 0.2px;
  color: var(--kme-text-3);
}
</style>
