<script setup lang="ts">
import { ref } from 'vue'
import { NModal, NButton } from 'naive-ui'

const show = ref(false)

function open(): void {
  show.value = true
}

defineExpose({ open })
</script>

<template>
  <NModal :show="show" transform-origin="center" @update:show="show = $event">
    <div class="about-dialog">
      <svg class="about-logo" width="56" height="56" viewBox="0 0 256 256" aria-hidden="true">
        <rect x="8" y="8" width="240" height="240" rx="56" style="fill: var(--kme-primary)" />
        <path
          d="M78 72 L78 184 M78 128 L150 72 M78 128 L150 184"
          stroke="#fff" stroke-width="10" stroke-linecap="round" fill="none"
        />
        <path d="M168 72 L168 184" stroke="#fff" stroke-width="12" stroke-linecap="round" />
      </svg>

      <div class="about-name">KMDE</div>
      <div class="about-desc">{{ $t('about.desc') }}</div>
      <div class="about-version">{{ $t('about.version', { version: '0.1.0' }) }}</div>

      <div class="about-divider"></div>

      <div class="about-tech">Electron · Vue 3 · Tiptap · CodeMirror 6</div>
      <div class="about-meta">MIT License · © 2026 liyk</div>

      <div class="about-actions">
        <NButton size="small" type="primary" @click="show = false">{{ $t('common.close') }}</NButton>
      </div>
    </div>
  </NModal>
</template>

<style scoped>
.about-dialog {
  width: 360px;
  max-width: 90vw;
  background: var(--kme-bg-float);
  border: 1px solid var(--kme-border-light);
  border-radius: var(--kme-radius-xl);
  padding: 32px 28px 20px;
  box-shadow: var(--kme-shadow-lg);
  text-align: center;
}

.about-logo {
  filter: drop-shadow(0 6px 16px var(--kme-primary-weak-hover));
}

.about-name {
  margin-top: 14px;
  font-size: 20px;
  font-weight: 700;
  letter-spacing: 0.5px;
  color: var(--kme-text-1);
  line-height: 1.3;
}

.about-desc {
  margin-top: 5px;
  font-size: 12.5px;
  color: var(--kme-text-2);
}

.about-version {
  display: inline-block;
  margin-top: 10px;
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  color: var(--kme-primary);
  background: var(--kme-primary-weak);
  border: 1px solid var(--kme-primary-weak-hover);
  padding: 4px 10px;
  border-radius: var(--kme-radius-full);
}

.about-divider {
  height: 1px;
  margin: 18px -6px 0;
  background: var(--kme-border);
}

.about-tech {
  margin-top: 14px;
  font-size: 11.5px;
  color: var(--kme-text-3);
  letter-spacing: 0.2px;
}

.about-meta {
  margin-top: 5px;
  font-size: 11px;
  color: var(--kme-text-3);
}

.about-actions {
  margin-top: 20px;
  display: flex;
  justify-content: center;
}
</style>
