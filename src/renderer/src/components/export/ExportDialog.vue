<script setup lang="ts">
import { ref, computed } from 'vue'
import { NModal, NButton, NRadioGroup, NRadioButton, NInput, useMessage } from 'naive-ui'
import type { EditorTab } from '@/stores/tabs.store'
import { buildExportHtml, defaultExportPath } from '@/export/htmlExport'

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
    message.success(`已导出到 ${out}`)
  } catch (err) {
    console.error('[export] failed:', err)
    message.error(`导出失败：${err instanceof Error ? err.message : String(err)}`)
  } finally {
    exporting.value = false
  }
}

defineExpose({ open })
</script>

<template>
  <NModal :show="show" :mask-closable="!exporting" transform-origin="center" @update:show="show = $event">
    <div class="export-dialog">
      <div class="export-title">导出文档</div>
      <div class="export-file">{{ tab?.fileName }}</div>

      <div class="export-field">
        <label class="export-label">格式</label>
        <NRadioGroup :value="format" size="small" @update:value="onFormatChange">
          <NRadioButton value="html">HTML</NRadioButton>
          <NRadioButton value="pdf">PDF</NRadioButton>
        </NRadioGroup>
      </div>

      <div class="export-field">
        <label class="export-label">输出路径</label>
        <div class="export-path-row">
          <NInput v-model:value="outputPath" size="small" :disabled="exporting" placeholder="选择输出位置" />
          <NButton size="small" quaternary :disabled="exporting" @click="browse">浏览…</NButton>
        </div>
      </div>

      <div class="export-hint">
        {{ format === 'pdf' ? 'PDF 导出会等待 Mermaid 图表与代码高亮渲染完成。' : 'HTML 为自包含样式，图片保留相对路径引用。' }}
      </div>

      <div class="export-actions">
        <NButton size="small" quaternary :disabled="exporting" @click="show = false">取消</NButton>
        <NButton size="small" type="primary" :loading="exporting" :disabled="!canConfirm" @click="confirm">
          导出
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
  border: 1px solid var(--kme-border);
  border-radius: 10px;
  padding: 20px 22px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
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
