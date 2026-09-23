<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import type { OutlineItem } from '@shared/types'
import { useSettingsStore } from '../../stores/settings.store'

const props = defineProps<{
  items: OutlineItem[]
  hasDocument: boolean
  activeId: string | null
}>()

const emit = defineEmits<{
  (e: 'jump', item: OutlineItem): void
}>()

const settings = useSettingsStore()

const visibleItems = computed(() => props.items.slice(0, 200))

function levelIndent(level: number): string {
  return `${(level - 1) * 12 + 8}px`
}

const bodyRef = ref<HTMLElement | null>(null)

watch(
  () => props.activeId,
  () => {
    if (!props.activeId || !bodyRef.value) return
    nextTick(() => {
      const el = bodyRef.value?.querySelector<HTMLElement>('.outline-item.is-active')
      el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    })
  },
)
</script>

<template>
  <aside class="outline-panel" :style="{ width: settings.outlineWidth + 'px' }">
    <div class="outline-header">
      <span class="outline-header-title">{{ $t('outline.title') }}</span>
      <button class="outline-collapse" :title="$t('outline.collapse')" @click="settings.toggleOutline()">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M9 18l6-6-6-6" />
        </svg>
      </button>
    </div>
    <div ref="bodyRef" class="outline-body">
      <template v-if="visibleItems.length > 0">
        <div
          v-for="item in visibleItems"
          :key="item.id"
          class="outline-item"
          :class="[`is-h${item.level}`, { 'is-active': item.id === activeId }]"
          :style="{ paddingLeft: levelIndent(item.level) }"
          :title="item.text"
          @click="emit('jump', item)"
        >
          <span class="outline-marker">H{{ item.level }}</span>
          <span class="outline-text">{{ item.text || $t('outline.emptyTitle') }}</span>
        </div>
      </template>
      <div v-else class="outline-empty">
        {{ $t(hasDocument ? 'outline.empty1' : 'outline.noDocument') }}<br />
        {{ $t(hasDocument ? 'outline.empty2' : 'outline.noDocumentHint') }}
      </div>
    </div>
  </aside>
</template>

<style scoped>
.outline-panel {
  width: 220px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--kme-bg-sidebar);
  border-left: 1px solid var(--kme-border-light);
  min-height: 0;
}

.outline-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  color: var(--kme-text-3);
  user-select: none;
}

.outline-header-title {
  flex: 1;
}

.outline-collapse {
  appearance: none;
  border: none;
  background: transparent;
  color: var(--kme-text-3);
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 4px;
  text-transform: none;
  letter-spacing: 0;
}

.outline-collapse:hover {
  background: var(--kme-bg-hover);
  color: var(--kme-text-1);
}

.outline-body {
  flex: 1;
  overflow-y: auto;
  padding-bottom: 12px;
}

.outline-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-top: 4px;
  padding-bottom: 4px;
  padding-right: 8px;
  margin: 1px 6px;
  border-radius: var(--kme-radius-sm);
  font-size: 12.5px;
  color: var(--kme-text-2);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}

.outline-item:hover {
  background: var(--kme-bg-hover);
  color: var(--kme-text-1);
}

.outline-item.is-active {
  color: var(--kme-primary);
  background: var(--kme-primary-weak);
}

.outline-item.is-h1 {
  font-weight: 600;
  color: var(--kme-text-1);
}

.outline-item.is-h1 .outline-marker {
  color: var(--kme-primary);
}

.outline-marker {
  font-size: 10px;
  font-weight: 700;
  color: var(--kme-text-3);
  flex-shrink: 0;
  width: 20px;
}

.outline-text {
  overflow: hidden;
  text-overflow: ellipsis;
}

.outline-empty {
  padding: 18px 12px;
  color: var(--kme-text-3);
  font-size: 12px;
  text-align: center;
  line-height: 1.9;
}
</style>
