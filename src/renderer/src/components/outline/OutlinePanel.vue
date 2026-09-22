<script setup lang="ts">
import { computed } from 'vue'
import type { OutlineItem } from '@shared/types'

const props = defineProps<{
  items: OutlineItem[]
  activeId: string | null
}>()

const emit = defineEmits<{
  (e: 'jump', item: OutlineItem): void
}>()

const visibleItems = computed(() => props.items.slice(0, 200))

function levelIndent(level: number): string {
  return `${(level - 1) * 12 + 8}px`
}
</script>

<template>
  <aside class="outline-panel">
    <div class="outline-header">大纲</div>
    <div class="outline-body">
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
          <span class="outline-text">{{ item.text || '(空标题)' }}</span>
        </div>
      </template>
      <div v-else class="outline-empty">暂无标题<br />使用 # 号创建标题</div>
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
  border-left: 1px solid var(--kme-border);
  min-height: 0;
}

.outline-header {
  padding: 8px 10px;
  font-size: 11.5px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--kme-text-3);
  user-select: none;
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
  font-size: 12.5px;
  color: var(--kme-text-2);
  cursor: pointer;
  user-select: none;
  white-space: nowrap;
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
