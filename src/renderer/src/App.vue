<script setup lang="ts">
import { onMounted } from 'vue'
import { NConfigProvider, NDialogProvider, NMessageProvider, darkTheme, zhCN, dateZhCN } from 'naive-ui'
import { useSettingsStore } from './stores/settings.store'
import WorkbenchLayout from './components/workbench/WorkbenchLayout.vue'

const settings = useSettingsStore()

onMounted(() => {
  void settings.load()
})
</script>

<template>
  <n-config-provider
    :theme="settings.isDark ? darkTheme : null"
    :locale="zhCN"
    :date-locale="dateZhCN"
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
