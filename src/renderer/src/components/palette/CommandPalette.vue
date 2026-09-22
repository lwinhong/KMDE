<script lang="ts">
export interface PaletteCommand {
  id: string
  title: string
  shortcut?: string
}

export type PaletteMode = 'files' | 'commands'
</script>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue'
import { useWorkspaceStore } from '@/stores/workspace.store'
import { fuzzyMatch } from '@/utils/fuzzyMatch'

const props = defineProps<{
  commands: PaletteCommand[]
}>()

const emit = defineEmits<{
  (e: 'run-command', id: string): void
  (e: 'open-file', path: string): void
}>()

const workspace = useWorkspaceStore()

const visible = ref(false)
const mode = ref<PaletteMode>('files')
const query = ref('')
const selectedIndex = ref(0)
const inputRef = ref<HTMLInputElement | null>(null)

interface PaletteEntry {
  kind: 'file' | 'command'
  id: string
  title: string
  detail: string
  shortcut?: string
}

const results = computed<PaletteEntry[]>((): PaletteEntry[] => {
  const q = query.value.trim()
  if (mode.value === 'commands') {
    const scored: Array<{ entry: PaletteEntry; score: number }> = []
    for (const cmd of props.commands) {
      const m = fuzzyMatch(q, cmd.title)
      if (m) {
        scored.push({ entry: { kind: 'command', id: cmd.id, title: cmd.title, detail: '', shortcut: cmd.shortcut }, score: m.score })
      }
    }
    scored.sort((a, b) => b.score - a.score)
    return scored.slice(0, 12).map((s) => s.entry)
  }
  const scored: Array<{ entry: PaletteEntry; score: number }> = []
  for (const file of workspace.fileIndex) {
    const nameResult = fuzzyMatch(q, file.fileName)
    const pathResult = q ? fuzzyMatch(q, file.relPath) : null
    const best = nameResult && pathResult ? Math.max(nameResult.score + 15, pathResult.score) : nameResult ? nameResult.score + 15 : pathResult ? pathResult.score : null
    if (best !== null) {
      scored.push({ entry: { kind: 'file', id: file.path, title: file.fileName, detail: file.relPath }, score: best })
    }
  }
  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, 20).map((s) => s.entry)
})

function open(newMode: PaletteMode): void {
  mode.value = newMode
  query.value = ''
  selectedIndex.value = 0
  visible.value = true
  void nextTick(() => {
    inputRef.value?.focus()
  })
}

function close(): void {
  visible.value = false
  query.value = ''
}

function choose(entry: PaletteEntry): void {
  close()
  if (entry.kind === 'file') {
    emit('open-file', entry.id)
  } else {
    emit('run-command', entry.id)
  }
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault()
    close()
  } else if (event.key === 'ArrowDown') {
    event.preventDefault()
    if (results.value.length > 0) {
      selectedIndex.value = (selectedIndex.value + 1) % results.value.length
    }
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    if (results.value.length > 0) {
      selectedIndex.value = (selectedIndex.value - 1 + results.value.length) % results.value.length
    }
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const entry = results.value[selectedIndex.value]
    if (entry) {
      choose(entry)
    }
  }
}

watch(query, () => {
  selectedIndex.value = 0
})

watch(visible, (v) => {
  if (v) {
    window.addEventListener('keydown', onGlobalKeydown, true)
  } else {
    window.removeEventListener('keydown', onGlobalKeydown, true)
  }
})

function onGlobalKeydown(event: KeyboardEvent): void {
  if (visible.value && event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    close()
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onGlobalKeydown, true)
})

defineExpose({ open, close })
</script>

<template>
  <Teleport to="body">
    <div v-if="visible" class="palette-backdrop" @mousedown.self="close">
      <div class="palette-panel">
        <div class="palette-input-wrap">
          <span class="palette-mode-tag">{{ mode === 'files' ? $t('palette.modeFiles') : $t('palette.modeCommands') }}</span>
          <input
            ref="inputRef"
            v-model="query"
            class="palette-input"
            type="text"
            :placeholder="mode === 'files' ? $t('palette.filesPlaceholder') : $t('palette.commandsPlaceholder')"
            spellcheck="false"
            @keydown="onKeydown"
          />
          <span class="palette-esc">{{ $t('palette.escToClose') }}</span>
        </div>
        <div class="palette-list">
          <template v-if="results.length > 0">
            <div
              v-for="(entry, index) in results"
              :key="entry.kind + entry.id"
              class="palette-item"
              :class="{ 'is-selected': index === selectedIndex }"
              @mouseenter="selectedIndex = index"
              @click="choose(entry)"
            >
              <span class="palette-item-icon">{{ entry.kind === 'file' ? 'MD' : '⌘' }}</span>
              <span class="palette-item-title">{{ entry.title }}</span>
              <span v-if="entry.detail" class="palette-item-detail">{{ entry.detail }}</span>
              <span v-if="entry.shortcut" class="palette-item-shortcut">{{ entry.shortcut }}</span>
            </div>
          </template>
          <div v-else class="palette-empty">
            {{ mode === 'files' ? (workspace.isOpen ? $t('palette.noFiles') : $t('palette.noWorkspace')) : $t('palette.noCommands') }}
          </div>
        </div>
        <div class="palette-footer">
          <span>{{ $t('palette.footerSelect') }}</span>
          <span>{{ $t('palette.footerConfirm') }}</span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.palette-backdrop {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.35);
  z-index: 3000;
  display: flex;
  justify-content: center;
  align-items: flex-start;
  padding-top: 12vh;
}

.palette-panel {
  width: 560px;
  max-width: 90vw;
  background: var(--kme-bg-float);
  border: 1px solid var(--kme-border);
  border-radius: 10px;
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.palette-input-wrap {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px 14px;
}

.palette-mode-tag {
  flex-shrink: 0;
  font-size: 11px;
  font-weight: 600;
  color: var(--kme-primary);
  background: var(--kme-primary-weak);
  border-radius: 4px;
  padding: 2px 6px;
}

.palette-input {
  flex: 1;
  border: none;
  outline: none;
  background: transparent;
  color: var(--kme-text-1);
  font-size: 14px;
}

.palette-input::placeholder {
  color: var(--kme-text-3);
}

.palette-esc {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--kme-text-3);
}

.palette-list {
  max-height: 340px;
  overflow-y: auto;
  padding: 4px 6px;
  border-top: 1px solid var(--kme-border);
}

.palette-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 6px;
  cursor: pointer;
  user-select: none;
}

.palette-item.is-selected {
  background: var(--kme-primary-weak);
}

.palette-item-icon {
  flex-shrink: 0;
  width: 26px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  font-weight: 700;
  color: var(--kme-text-3);
  border: 1px solid var(--kme-border);
  border-radius: 4px;
}

.palette-item.is-selected .palette-item-icon {
  color: var(--kme-primary);
  border-color: var(--kme-primary);
}

.palette-item-title {
  color: var(--kme-text-1);
  font-size: 13px;
  white-space: nowrap;
}

.palette-item-detail {
  flex: 1;
  color: var(--kme-text-3);
  font-size: 11.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
}

.palette-item-shortcut {
  flex-shrink: 0;
  font-size: 11px;
  color: var(--kme-text-3);
  border: 1px solid var(--kme-border);
  border-radius: 4px;
  padding: 1px 5px;
}

.palette-empty {
  padding: 26px 0;
  text-align: center;
  color: var(--kme-text-3);
  font-size: 12.5px;
}

.palette-footer {
  display: flex;
  gap: 14px;
  padding: 8px 14px;
  border-top: 1px solid var(--kme-border);
  font-size: 11px;
  color: var(--kme-text-3);
}
</style>
