<script setup lang="ts">
import { ref, computed } from 'vue'
import { NModal, NButton, NRadioGroup, NRadioButton, NInput, useMessage } from 'naive-ui'
import type { EditorTab } from '@/stores/tabs.store'
import { buildExportHtml, defaultExportPath } from '@/export/htmlExport'
import { t } from '@/i18n'

const message = useMessage()

const show = ref(false)
const tab = ref<EditorTab | null>(null)
const format = ref<'html' | 'pdf'>('html')
const outputPath = ref('')
const exporting = ref(false)

const canConfirm = computed(() => !!tab.value && outputPath.value.trim().length > 0 && !exporting.value)

function open(target: EditorTab): void {
  tab.value = target
  format.value = 'html'
  outputPath.value = defaultExportPath(target.path, target.fileName, 'html')
  show.value = true
}

function onFormatChange(value: 'html' | 'pdf'): void {
  format.value = value
  if (tab.value) {
    outputPath.value = defaultExportPath(tab.value.path, tab.value.fileName, value)
  }
}

async function browse(): Promise<void> {
  const current = outputPath.value.trim()
  const picked = await window.kmde.saveAsDialog(current || 'export.html')
  if (picked) {
    outputPath.value = picked
  }
}

async function confirm(): Promise<void> {
  const target = tab.value
  if (!target || !canConfirm.value) return
  exporting.value = true
  try {
    const html = buildExportHtml({
      title: target.fileName,
      markdown: target.markdown,
      docPath: target.path
    })
    const out = outputPath.value.trim()
    if (format.value === 'html') {
      await window.kmde.exportHtml(html, out)
    } else {
      await window.kmde.exportPdf(html, out)
    }
    show.value = false
    message.success(t('export.exportedTo', { path: out }))
  } catch (err) {
    console.error('[export] failed:', err)
    message.error(t('export.failed', { msg: err instanceof Error ? err.message : String(err) }))
  } finally {
    exporting.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <NModal :show="show" :mask-closable="!exporting" transform-origin="center" @update:show="show = $event">
    <div class="export-dialog">
      <div class="export-title">{{ $t('export.title') }}</div>
      <div class="export-file">{{ tab?.fileName }}</div>

      <div class="export-field">
        <label class="export-label">{{ $t('export.format') }}</label>
        <NRadioGroup :value="format" size="small" @update:value="onFormatChange">
          <NRadioButton value="html">HTML</NRadioButton>
          <NRadioButton value="pdf">PDF</NRadioButton>
        </NRadioGroup>
      </div>

      <div class="export-field">
        <label class="export-label">{{ $t('export.outputPath') }}</label>
        <div class="export-path-row">
          <NInput v-model:value="outputPath" size="small" :disabled="exporting" :placeholder="$t('export.chooseOutput')" />
          <NButton size="small" quaternary :disabled="exporting" @click="browse">{{ $t('export.browse') }}</NButton>
        </div>
      </div>

      <div class="export-hint">
        {{ format === 'pdf' ? $t('export.pdfHint') : $t('export.htmlHint') }}
      </div>

      <div class="export-actions">
        <NButton size="small" quaternary :disabled="exporting" @click="show = false">{{ $t('common.cancel') }}</NButton>
        <NButton size="small" type="primary" :loading="exporting" :disabled="!canConfirm" @click="confirm">
          {{ $t('export.confirm') }}
        </NButton>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.export-dialog {
  width: 520px;
  max-width: 90vw;
  background: var(--kme-bg-float);
  border: 1px solid var(--kme-border-light);
  border-radius: var(--kme-radius-xl);
  padding: 20px 22px;
  box-shadow: var(--kme-shadow-lg);
}

.export-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--kme-text-1);
}

.export-file {
  margin-top: 4px;
  font-size: 12.5px;
  color: var(--kme-primary);
  font-family: Consolas, monospace;
  word-break: break-all;
}

.export-field {
  margin-top: 16px;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.export-label {
  font-size: 12px;
  color: var(--kme-text-2);
}

.export-path-row {
  display: flex;
  gap: 8px;
}

.export-hint {
  margin-top: 14px;
  font-size: 11.5px;
  color: var(--kme-text-3);
  line-height: 1.6;
}

.export-actions {
  margin-top: 18px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
