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
      <div class="welcome-subtitle">{{ $t('welcome.subtitle') }}</div>
      <div class="welcome-hint">{{ $t('welcome.hint') }}</div>
    </div>
    <div class="welcome-actions">
      <button class="welcome-btn primary" @click="$emit('open-file')">{{ $t('welcome.openFile') }}</button>
      <button class="welcome-btn primary" @click="$emit('open-folder')">{{ $t('welcome.openFolder') }}</button>
      <button class="welcome-btn" @click="$emit('new-file')">{{ $t('welcome.newFile') }}</button>
      <button v-if="settings.lastWorkspace" class="welcome-btn" @click="$emit('resume-workspace')">
        {{ $t('welcome.resumeWorkspace') }}
      </button>
    </div>
    <div class="welcome-tips">
      <div class="welcome-tip">{{ $t('welcome.tip1') }}</div>
      <div class="welcome-tip">{{ $t('welcome.tip2') }}</div>
      <div class="welcome-tip">{{ $t('welcome.tip3') }}</div>
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
  background: var(--kme-gradient-text);
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
  border-radius: var(--kme-radius-lg);
  border: 1px solid var(--kme-border);
  background: var(--kme-bg);
  color: var(--kme-text-1);
  cursor: pointer;
  transition: all 0.15s;
}

.welcome-btn:hover {
  border-color: var(--kme-primary);
  color: var(--kme-primary);
  background: var(--kme-primary-weak);
}

.welcome-btn.primary {
  background: var(--kme-gradient-brand);
  border-color: transparent;
  color: #fff;
  box-shadow: var(--kme-shadow-sm);
}

.welcome-btn.primary:hover {
  transform: translateY(-1px);
  box-shadow: var(--kme-shadow-glow);
  border-color: transparent;
  color: #fff;
  background: var(--kme-gradient-brand);
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
