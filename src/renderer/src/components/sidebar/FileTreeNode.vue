<script setup lang="ts">
import { computed, inject } from 'vue'
import type { FileNode } from '@shared/types'
import { MarkdownIcon } from '../editor/tiptap/icons'
import { IconChevronRight, IconFolder } from '@/components/icons'
import FileTreeNode from './FileTreeNode.vue'

const props = defineProps<{
  node: FileNode
  depth: number
}>()

const emit = defineEmits<{
  (e: 'open', node: FileNode): void
  (e: 'contextmenu', node: FileNode, x: number, y: number): void
}>()

const controller = inject<TreeController>('fileTreeController')!

const expanded = computed(() => controller.expandedDirs.has(props.node.path))
const loading = computed(() => controller.loadingDirs.has(props.node.path))
const children = computed(() =>
  expanded.value ? controller.childrenCache.get(props.node.path) ?? null : null
)

async function onClick(): Promise<void> {
  if (props.node.isDir) {
    await controller.toggleNode(props.node)
  } else {
    emit('open', props.node)
  }
}

function onChildOpen(node: FileNode): void {
  emit('open', node)
}

function onChildContext(node: FileNode, x: number, y: number): void {
  emit('contextmenu', node, x, y)
}
</script>

<template>
  <div>
    <div
      class="ft-node"
      :style="{ paddingLeft: `${depth * 14 + 8}px` }"
      @click="onClick"
      @contextmenu.prevent="emit('contextmenu', node, $event.clientX, $event.clientY)"
    >
      <span v-if="node.isDir" class="ft-arrow" :class="{ 'is-open': expanded }">
        <IconChevronRight :size="12" :stroke-width="2.5" />
      </span>
      <span v-else class="ft-arrow-spacer" />
      <span v-if="node.isDir" class="ft-icon dir">
        <IconFolder :size="14" />
      </span>
      <span v-else class="ft-icon file">
        <MarkdownIcon :size="14" />
      </span>
      <span class="ft-label" :title="node.name">{{ node.name }}</span>
      <span v-if="loading" class="ft-loading">…</span>
    </div>
    <template v-if="children">
      <FileTreeNode
        v-for="child in children"
        :key="child.path"
        :node="child"
        :depth="depth + 1"
        @open="onChildOpen"
        @contextmenu="onChildContext"
      />
    </template>
  </div>
</template>

<script lang="ts">
export interface TreeController {
  expandedDirs: Set<string>
  loadingDirs: Set<string>
  childrenCache: Map<string, import('@shared/types').FileNode[]>
  toggleNode: (node: import('@shared/types').FileNode) => Promise<void>
}

export default { name: 'FileTreeNode' }
</script>

<style scoped>
.ft-node {
  display: flex;
  align-items: center;
  gap: 5px;
  height: 26px;
  margin: 1px 6px;
  padding-right: 8px;
  border-radius: var(--kme-radius-sm);
  cursor: pointer;
  color: var(--kme-text-2);
  font-size: 13px;
  user-select: none;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s;
}

.ft-node:hover {
  background: var(--kme-bg-hover);
  color: var(--kme-text-1);
}

.ft-arrow {
  display: inline-flex;
  align-items: center;
  width: 14px;
  color: var(--kme-text-3);
  transition: transform 0.12s;
  flex-shrink: 0;
}

.ft-arrow.is-open {
  transform: rotate(90deg);
}

.ft-arrow-spacer {
  width: 14px;
  flex-shrink: 0;
}

.ft-icon {
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
}

.ft-icon.file {
  color: var(--kme-primary);
}

.ft-label {
  overflow: hidden;
  text-overflow: ellipsis;
}

.ft-loading {
  color: var(--kme-text-3);
  font-size: 11px;
}
</style>
