<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, watch, nextTick } from 'vue'
import { useTabsStore } from '../../stores/tabs.store'
import { useWorkspaceStore } from '../../stores/workspace.store'
import { MarkdownIcon } from '../editor/tiptap/icons/index.jsx'

const emit = defineEmits<{
  (e: 'new-file'): void
  (e: 'close-tab', id: string): void
}>()

const tabs = useTabsStore()
const workspace = useWorkspaceStore()

const scrollRef = ref<HTMLElement | null>(null)
const canScrollLeft = ref(false)
const canScrollRight = ref(false)

function updateScrollState(): void {
  const el = scrollRef.value
  if (!el) return
  canScrollLeft.value = el.scrollLeft > 0
  canScrollRight.value = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
}

function onWheel(e: WheelEvent): void {
  const el = scrollRef.value
  if (!el) return
  const delta = e.deltaY || e.deltaX
  if (delta === 0) return
  e.preventDefault()
  el.scrollLeft += delta
  updateScrollState()
}

function scrollBy(delta: number): void {
  scrollRef.value?.scrollBy({ left: delta, behavior: 'smooth' })
}

let resizeObserver: ResizeObserver | null = null

onMounted(() => {
  const el = scrollRef.value
  if (!el) return
  el.addEventListener('wheel', onWheel, { passive: false })
  el.addEventListener('scroll', updateScrollState, { passive: true })
  resizeObserver = new ResizeObserver(updateScrollState)
  resizeObserver.observe(el)
  updateScrollState()
})

onBeforeUnmount(() => {
  const el = scrollRef.value
  if (el) {
    el.removeEventListener('wheel', onWheel)
    el.removeEventListener('scroll', updateScrollState)
  }
  resizeObserver?.disconnect()
})

watch(
  () => tabs.tabs.length,
  () => {
    nextTick(updateScrollState)
  }
)

function onTabClick(id: string): void {
  tabs.activateTab(id)
}

function onTabClose(e: MouseEvent, id: string): void {
  e.stopPropagation()
  emit('close-tab', id)
}

function onAuxClick(e: MouseEvent, id: string): void {
  if (e.button === 1) {
    e.preventDefault()
    emit('close-tab', id)
  }
}
</script>

<template>
  <div class="tabbar">
    <div class="tabbar-tabs" ref="scrollRef" role="tablist">
      <button
        v-if="canScrollLeft"
        class="tabbar-arrow tabbar-arrow-left"
        :title="$t('tabbar.scrollLeft')"
        @click="scrollBy(-200)"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <div
        v-for="tab in tabs.tabs"
        :key="tab.id"
        class="tabbar-tab"
        :class="{ 'is-active': tab.id === tabs.activeTabId }"
        role="tab"
        :title="tab.path ?? tab.fileName"
        @click="onTabClick(tab.id)"
        @auxclick="onAuxClick($event, tab.id)"
      >
        <span class="tabbar-tab-icon"><MarkdownIcon :size="14" /></span>
        <span class="tabbar-tab-label">
          {{ tab.fileName }}
          <span v-if="tab.deleted" class="tabbar-tab-deleted">{{ $t('tabbar.deleted') }}</span>
        </span>
        <span class="tabbar-tab-dot" v-if="tab.dirty" :class="{ 'is-dirty': tab.dirty }" />
        <button class="tabbar-tab-close" :title="$t('common.close')" @click="onTabClose($event, tab.id)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5">
            <path d="M22 2 2 22 M2 2l20 20" />
          </svg>
        </button>
      </div>
      <div class="tabbar-edge-right">
        <button
          v-if="canScrollRight"
          class="tabbar-arrow tabbar-arrow-right"
          :title="$t('tabbar.scrollRight')"
          @click="scrollBy(200)"
        >
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M9 18l6-6-6-6" />
          </svg>
        </button>
        <button class="tabbar-new-btn" :title="$t('tabbar.newFile')" @click="emit('new-file')">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.tabbar {
  display: flex;
  align-items: stretch;
  height: 38px;
  flex-shrink: 0;
  background: var(--kme-tabbar-bg);
  border-bottom: 1px solid var(--kme-border-light);
  user-select: none;
  padding: 0 4px;
}

.tabbar-tabs {
  display: flex;
  align-items: center;
  overflow-x: auto;
  flex: 1;
  min-width: 0;
  scrollbar-width: none;
}

.tabbar-tabs::-webkit-scrollbar {
  display: none;
}

.tabbar-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 4px;
  margin: 5px 3px;
  height: 28px;
  min-width: 120px;
  max-width: 220px;
  border-radius: var(--kme-radius-md);
  color: var(--kme-text-2);
  cursor: pointer;
  position: relative;
  font-size: 12.5px;
  white-space: nowrap;
  transition: background 0.15s ease, color 0.15s ease, box-shadow 0.15s ease;
}

.tabbar-tab:hover {
  background: var(--kme-bg-hover);
}

.tabbar-tab.is-active {
  background: var(--kme-tab-active-bg);
  color: var(--kme-text-1);
  box-shadow: var(--kme-tab-active-shadow);
}

.tabbar-tab.is-active::after {
  content: '';
  position: absolute;
  top: 0px;
  left: 10px;
  right: 10px;
  height: 1px;
  border-radius: var(--kme-radius-full);
  background: var(--kme-tab-active-indicator);
}

.tabbar-tab-icon {
  display: inline-flex;
  color: var(--kme-primary);
  flex-shrink: 0;
}

.tabbar-tab-label {
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}

.tabbar-tab-deleted {
  color: var(--kme-danger);
  font-size: 11px;
}

.tabbar-tab-dot {
  width: 7px;
  height: 7px;
  border-radius: var(--kme-radius-full);
  flex-shrink: 0;
}

.tabbar-tab-dot.is-dirty {
  background: var(--kme-warning);
}

.tabbar-tab-close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: var(--kme-radius-full);
  background: transparent;
  color: var(--kme-text-3);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0;
  transition: background 0.15s, color 0.15s, opacity 0.15s;
}

.tabbar-tab-close svg {
  width: 16px;
  height: 16px;
}

.tabbar-tab:hover .tabbar-tab-close,
.tabbar-tab.is-active .tabbar-tab-close {
  opacity: 1;
}

.tabbar-tab-close:hover {
  background: var(--kme-bg-active);
  color: var(--kme-text-1);
}

.tabbar-new-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  margin: 5px 3px;
  border: none;
  border-radius: var(--kme-radius-md);
  background: transparent;
  color: var(--kme-text-2);
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s, color 0.15s;
}

.tabbar-new-btn:hover {
  background: var(--kme-bg-hover);
  color: var(--kme-text-1);
}

.tabbar-arrow {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 28px;
  margin: 5px 0;
  border: none;
  background: var(--kme-tabbar-bg);
  color: var(--kme-text-2);
  cursor: pointer;
  flex-shrink: 0;
  z-index: 2;
  transition: background 0.15s, color 0.15s;
}

.tabbar-arrow-left {
  position: sticky;
  left: 0;
}

.tabbar-arrow:hover {
  background: var(--kme-bg-hover);
  color: var(--kme-text-1);
}

.tabbar-edge-right {
  position: sticky;
  right: 0;
  display: flex;
  align-items: center;
  flex-shrink: 0;
  background: var(--kme-tabbar-bg);
  z-index: 2;
}

.tabbar-edge-right::before {
  content: '';
  position: absolute;
  right: 100%;
  top: 0;
  bottom: 0;
  width: 12px;
  background: linear-gradient(to right, transparent, var(--kme-tabbar-bg));
  pointer-events: none;
}
</style>
