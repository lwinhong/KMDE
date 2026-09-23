<script setup lang="ts">
import { computed } from 'vue'
import { NConfigProvider, NDialogProvider, NMessageProvider, darkTheme, zhCN, dateZhCN, enUS, dateEnUS } from 'naive-ui'
import type { GlobalTheme } from 'naive-ui'
import { useSettingsStore } from './stores/settings.store'
import WorkbenchLayout from './components/workbench/WorkbenchLayout.vue'

const settings = useSettingsStore()

const naiveLocale = computed(() => (settings.language === 'en-US' ? enUS : zhCN))
const naiveDateLocale = computed(() => (settings.language === 'en-US' ? dateEnUS : dateZhCN))
const naiveTheme = computed<GlobalTheme | null>(() => (settings.isDark ? darkTheme : null))

</script>

<template>
  <n-config-provider
    :theme="naiveTheme"
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
    :theme-overrides="{
      common: {
        primaryColor: settings.isDark ? '#818cf8' : '#6366f1',
        primaryColorHover: settings.isDark ? '#a5b4fc' : '#818cf8',
        primaryColorPressed: settings.isDark ? '#6366f1' : '#4f46e5',
        primaryColorSuppl: settings.isDark ? '#818cf8' : '#6366f1',
        borderRadius: '8px'
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
