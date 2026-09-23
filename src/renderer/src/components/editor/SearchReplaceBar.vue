<script setup lang="ts">
import { computed, nextTick, onMounted, ref } from 'vue'

const props = withDefaults(
  defineProps<{
    total: number
    current: number
    offsetTop?: number
  }>(),
  { offsetTop: 8 }
)

const emit = defineEmits<{
  (e: 'find', query: string, caseSensitive: boolean): void
  (e: 'find-next'): void
  (e: 'find-prev'): void
  (e: 'replace', replacement: string): void
  (e: 'replace-all', replacement: string): void
  (e: 'close'): void
}>()

const query = ref('')
const replacement = ref('')
const caseSensitive = ref(false)
const showReplace = ref(false)
const findInputRef = ref<HTMLInputElement | null>(null)
let debounce: ReturnType<typeof setTimeout> | null = null

const countLabel = computed(() => {
  if (!query.value) return ''
  return `${props.current}/${props.total}`
})

function focus(): void {
  nextTick(() => {
    findInputRef.value?.focus()
    findInputRef.value?.select()
  })
}

function emitFind(): void {
  emit('find', query.value, caseSensitive.value)
}

function onQueryInput(): void {
  if (debounce) clearTimeout(debounce)
  debounce = setTimeout(() => {
    debounce = null
    emitFind()
  }, 120)
}

function onEnter(): void {
  if (props.total) emit('find-next')
  else emitFind()
}

function toggleCase(): void {
  caseSensitive.value = !caseSensitive.value
  emitFind()
}

function toggleReplace(): void {
  showReplace.value = !showReplace.value
}

function onReplace(): void {
  if (props.total) emit('replace', replacement.value)
}

function onReplaceAll(): void {
  if (props.total) emit('replace-all', replacement.value)
}

onMounted(() => {
  focus()
})

defineExpose({ focus })
</script>

<template>
  <div class="search-bar" :class="{ 'is-expanded': showReplace }" :style="{ top: `${offsetTop}px` }">
    <div class="search-row">
      <span class="search-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
      </span>
      <input
        ref="findInputRef"
        v-model="query"
        class="search-input"
        type="text"
        spellcheck="false"
        :placeholder="$t('search.findPlaceholder')"
        @input="onQueryInput"
        @keydown.enter.exact.prevent="onEnter"
        @keydown.enter.shift.prevent="emit('find-prev')"
        @keydown.esc.prevent="emit('close')"
      />
      <span class="search-count">{{ countLabel }}</span>
      <button class="search-icon-btn" :disabled="!total" :title="$t('search.prev')" @click="emit('find-prev')">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m18 15-6-6-6 6" />
        </svg>
      </button>
      <button class="search-icon-btn" :disabled="!total" :title="$t('search.next')" @click="emit('find-next')">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      <button
        class="search-icon-btn is-text"
        :class="{ 'is-active': caseSensitive }"
        :title="$t('search.caseSensitive')"
        @click="toggleCase"
      >
        Aa
      </button>
      <button
        class="search-icon-btn is-text"
        :class="{ 'is-active': showReplace }"
        :title="$t('search.toggleReplace')"
        @click="toggleReplace"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 7h11a3 3 0 0 1 3 3v0M17 17H6a3 3 0 0 1-3-3v0" />
          <path d="m14 4 3 3-3 3M7 14l-3 3 3 3" />
        </svg>
      </button>
      <button class="search-icon-btn" :title="$t('common.close')" @click="emit('close')">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6 6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
    <div v-if="showReplace" class="search-row replace-row">
      <span class="search-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M4 7h11a3 3 0 0 1 3 3v0M17 17H6a3 3 0 0 1-3-3v0" />
        </svg>
      </span>
      <input
        v-model="replacement"
        class="search-input"
        type="text"
        spellcheck="false"
        :placeholder="$t('search.replacePlaceholder')"
        @keydown.enter.prevent="onReplace"
        @keydown.esc.prevent="emit('close')"
      />
      <button class="search-action" :disabled="!total" @click="onReplace">{{ $t('search.replace') }}</button>
      <button class="search-action" :disabled="!total" @click="onReplaceAll">{{ $t('search.replaceAll') }}</button>
    </div>
  </div>
</template>

<style scoped>
.search-bar {
  position: absolute;
  right: 18px;
  z-index: 30;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 6px;
  border-radius: var(--kme-radius-md);
  background: var(--kme-popover-bg);
  border: 1px solid var(--kme-border);
  box-shadow: var(--kme-shadow-md);
}

.search-row {
  display: flex;
  align-items: center;
  gap: 4px;
}

.search-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--kme-text-3);
  padding-left: 4px;
}

.search-input {
  width: 190px;
  height: 26px;
  padding: 0 6px;
  border: 1px solid var(--kme-border);
  border-radius: var(--kme-radius-sm);
  background: var(--kme-bg);
  color: var(--kme-text-1);
  font-size: 12.5px;
  outline: none;
}

.search-input:focus {
  border-color: var(--kme-primary);
  box-shadow: var(--kme-shadow-glow);
}

.search-count {
  min-width: 40px;
  text-align: center;
  font-size: 11.5px;
  color: var(--kme-text-3);
  font-variant-numeric: tabular-nums;
}

.search-icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border: none;
  border-radius: var(--kme-radius-sm);
  background: transparent;
  color: var(--kme-text-2);
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}

.search-icon-btn.is-text {
  font-size: 11.5px;
  font-weight: 600;
}

.search-icon-btn:hover:not(:disabled) {
  background: var(--kme-bg-hover);
  color: var(--kme-text-1);
}

.search-icon-btn.is-active {
  background: var(--kme-primary-weak);
  color: var(--kme-primary);
}

.search-icon-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.replace-row .search-input {
  width: 190px;
}

.search-action {
  height: 24px;
  padding: 0 10px;
  border: 1px solid var(--kme-border);
  border-radius: var(--kme-radius-sm);
  background: var(--kme-bg);
  color: var(--kme-text-1);
  font-size: 11.5px;
  cursor: pointer;
  white-space: nowrap;
  transition: background 0.15s, color 0.15s, border-color 0.15s;
}

.search-action:hover:not(:disabled) {
  background: var(--kme-bg-hover);
  border-color: var(--kme-border-strong);
}

.search-action:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
