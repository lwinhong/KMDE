<script setup lang="ts">
import { computed } from 'vue'
import { NModal, NButton } from 'naive-ui'
import { useTabsStore } from '@/stores/tabs.store'
import { basename } from '@/stores/pathUtils'

const tabs = useTabsStore()

const show = computed(() => tabs.conflict !== null)

const fileName = computed(() => (tabs.conflict ? basename(tabs.conflict.path) : ''))

const diskPreview = computed(() => {
  const content = tabs.conflict?.diskContent ?? ''
  return content.length > 500 ? `${content.slice(0, 500)}…` : content
})

function resolve(action: 'load-disk' | 'keep'): void {
  tabs.resolveConflict(action)
}
</script>

<template>
  <NModal
    :show="show"
    :mask-closable="false"
    :close-on-esc="false"
    transform-origin="center"
  >
    <div class="conflict-dialog">
      <div class="conflict-title">文件已在磁盘上被修改</div>
      <div class="conflict-file">{{ fileName }}</div>
      <div class="conflict-desc">
        此文件在编辑器中有未保存的修改，同时磁盘上的版本也发生了变化。请选择要保留的版本。
      </div>
      <div class="conflict-section-label">磁盘上的内容（预览）</div>
      <pre class="conflict-preview">{{ diskPreview }}</pre>
      <div class="conflict-actions">
        <NButton size="small" quaternary @click="resolve('keep')">保留我的修改</NButton>
        <NButton size="small" type="primary" @click="resolve('load-disk')">加载磁盘版本</NButton>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.conflict-dialog {
  width: 520px;
  max-width: 90vw;
  background: var(--kme-bg-float);
  border: 1px solid var(--kme-border);
  border-radius: 10px;
  padding: 20px 22px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
}

.conflict-title {
  font-size: 15px;
  font-weight: 600;
  color: var(--kme-text-1);
}

.conflict-file {
  margin-top: 6px;
  font-size: 12.5px;
  color: var(--kme-primary);
  font-family: Consolas, monospace;
  word-break: break-all;
}

.conflict-desc {
  margin-top: 10px;
  font-size: 12.5px;
  color: var(--kme-text-2);
  line-height: 1.7;
}

.conflict-section-label {
  margin-top: 14px;
  font-size: 11.5px;
  color: var(--kme-text-3);
}

.conflict-preview {
  margin-top: 6px;
  max-height: 180px;
  overflow: auto;
  background: var(--kme-bg);
  border: 1px solid var(--kme-border);
  border-radius: 6px;
  padding: 10px 12px;
  font-size: 12px;
  line-height: 1.6;
  color: var(--kme-text-2);
  white-space: pre-wrap;
  word-break: break-all;
  font-family: Consolas, 'Courier New', monospace;
}

.conflict-actions {
  margin-top: 16px;
  display: flex;
  justify-content: flex-end;
  gap: 10px;
}
</style>
