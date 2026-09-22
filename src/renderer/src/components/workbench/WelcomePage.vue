<script setup lang="ts">
import { useSettingsStore } from '../../stores/settings.store'

const settings = useSettingsStore()

defineEmits<{
  (e: 'open-file'): void
  (e: 'open-folder'): void
  (e: 'new-file'): void
  (e: 'resume-workspace'): void
}>()
</script>

<template>
  <div class="welcome">
    <div class="welcome-hero">
      <div class="welcome-logo">KMDE</div>
      <div class="welcome-subtitle">Knowledge Markdown Editor</div>
      <div class="welcome-hint">所见即所得 · 源码模式 · 文件关联</div>
    </div>
    <div class="welcome-actions">
      <button class="welcome-btn primary" @click="$emit('open-file')">打开文件</button>
      <button class="welcome-btn primary" @click="$emit('open-folder')">打开文件夹</button>
      <button class="welcome-btn" @click="$emit('new-file')">新建文件</button>
      <button v-if="settings.lastWorkspace" class="welcome-btn" @click="$emit('resume-workspace')">
        恢复上次工作区
      </button>
    </div>
    <div class="welcome-tips">
      <div class="welcome-tip">提示：安装后双击 .md 文件可直接用 KMDE 打开</div>
      <div class="welcome-tip">Ctrl+P 快速打开文件 · Ctrl+/ 切换源码模式 · Ctrl+Shift+P 命令面板</div>
      <div class="welcome-tip">也可以直接把 .md 文件拖入窗口</div>
    </div>
  </div>
</template>

<style scoped>
.welcome {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 36px;
  background: var(--kme-bg);
  min-width: 0;
}

.welcome-hero {
  text-align: center;
}

.welcome-logo {
  font-size: 44px;
  font-weight: 800;
  letter-spacing: 2px;
  background: linear-gradient(120deg, var(--kme-primary), #a855f7);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.welcome-subtitle {
  margin-top: 8px;
  color: var(--kme-text-2);
  font-size: 15px;
}

.welcome-hint {
  margin-top: 6px;
  color: var(--kme-text-3);
  font-size: 12.5px;
}

.welcome-actions {
  display: flex;
  gap: 12px;
}

.welcome-btn {
  padding: 9px 22px;
  font-size: 14px;
  border-radius: 8px;
  border: 1px solid var(--kme-border);
  background: var(--kme-bg);
  color: var(--kme-text-1);
  cursor: pointer;
  transition: all 0.15s;
}

.welcome-btn:hover {
  border-color: var(--kme-primary);
  color: var(--kme-primary);
}

.welcome-btn.primary {
  background: var(--kme-primary);
  border-color: var(--kme-primary);
  color: #fff;
}

.welcome-btn.primary:hover {
  background: var(--kme-primary-hover);
  border-color: var(--kme-primary-hover);
  color: #fff;
}

.welcome-tips {
  display: flex;
  flex-direction: column;
  gap: 6px;
  align-items: center;
}

.welcome-tip {
  color: var(--kme-text-3);
  font-size: 12px;
}
</style>
