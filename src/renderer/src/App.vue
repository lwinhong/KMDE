<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { NConfigProvider, NDialogProvider, NMessageProvider, darkTheme, zhCN, dateZhCN, enUS, dateEnUS } from 'naive-ui'
import type { GlobalTheme } from 'naive-ui'
import { useSettingsStore } from './stores/settings.store'
import WorkbenchLayout from './components/workbench/WorkbenchLayout.vue'

const settings = useSettingsStore()

const naiveLocale = computed(() => (settings.language === 'en-US' ? enUS : zhCN))
const naiveDateLocale = computed(() => (settings.language === 'en-US' ? dateEnUS : dateZhCN))
const naiveTheme = computed<GlobalTheme | null>(() => (settings.isDark ? darkTheme : null))

onMounted(() => {
  void settings.load()
})
</script>

<template>
  <n-config-provider
    :theme="naiveTheme"
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
    :theme-overrides="{
      common: {
        primaryColor: settings.isDark ? '#60a5fa' : '#2563eb',
        primaryColorHover: settings.isDark ? '#93c5fd' : '#3b82f6',
        primaryColorPressed: settings.isDark ? '#3b82f6' : '#1d4ed8',
        borderRadius: '6px'
      }
    }"
    style="height: 100%"
  >
    <n-dialog-provider>
      <n-message-provider>
        <WorkbenchLayout />
      </n-message-provider>
    </n-dialog-provider>
  </n-config-provider>
</template>
