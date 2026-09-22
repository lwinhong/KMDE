<template>
  <div class="tiptap-toolbar" :class="{ 'source-mode': sourceMode }" ref="toolbarRef">
    <!-- Visible items -->
    <div
      v-for="(item, index) in visibleItems"
      :key="item.key"
      :class="['toolbar-item', item.isSourceToggle && 'is-source-toggle']"
    >
      <component :is="item.component" v-bind="item.props" />
      <ToolbarSeparator v-if="item.separatorAfter" />
    </div>

    <NPopover
      v-if="overflowItems.length"
      trigger="click"
      placement="bottom-end"
      :show-arrow="false"
    >
      <template #trigger>
        <ToolbarButton class="more-btn" :title="$t('editor.more')">
          <MoreIcon :size="18" />
        </ToolbarButton>
      </template>
      <div class="toolbar-overflow-menu" :class="{ 'source-mode': sourceMode }" @click.stop>
        <div
          v-for="item in overflowItems"
          :key="'ov-' + item.key"
          :class="['overflow-item', item.isSourceToggle && 'is-source-toggle']"
        >
          <component :is="item.component" v-bind="item.props" />
          <div v-if="item.separatorAfter" class="overflow-divider" />
        </div>
      </div>
    </NPopover>

    <!-- Hidden measurement layer: always renders all items for width calculation -->
    <div class="toolbar-measure-layer" aria-hidden="true">
      <div
        v-for="(item, index) in items"
        :key="'m-' + item.key"
        class="toolbar-measure-item"
        :ref="el => setItemRef(el, index)"
      >
        <component :is="item.component" v-bind="item.props" />
        <ToolbarSeparator v-if="item.separatorAfter" />
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick, watch, h } from 'vue'
import { NPopover } from 'naive-ui'
import { ToolbarButton, ToolbarSeparator } from './primitives'
import UndoRedoButtons from './UndoRedoButtons.vue'
import HeadingDropdown from './HeadingDropdown.vue'
import ListButtons from './ListButtons.vue'
import BlockButtons from './BlockButtons.vue'
import MarkButtons from './MarkButtons.vue'
import LinkPopover from './LinkPopover.vue'
import ImageInsert from './ImageInsert.vue'
import TableMenu from './TableMenu.vue'
import HighlightPicker from './HighlightPicker.vue'
import { MoreIcon, MarkdownIcon } from '../icons'
import { t } from '@/i18n'
import './toolbar.css'

const props = defineProps({
  editor: { type: Object, required: true },
  sourceMode: { type: Boolean, default: false },
  useSourceMode: { type: Boolean, default: false },
  imageUploadFn: { type: Function, default: null }
})

const emit = defineEmits(['toggle-source'])

/** Functional component for the source/markdown toggle button. */
const SourceToggle = (itemProps) =>
  h(
    ToolbarButton,
    {
      class: ['md-toggle-btn', { 'is-active': itemProps.active }],
      title: itemProps.title,
      onClick: itemProps.onToggle
    },
    { default: () => h(MarkdownIcon, { size: 18 }) }
  )
SourceToggle.props = ['active', 'title', 'onToggle']

const toolbarRef = ref(null)
const itemRefs = ref([])
const visibleCount = ref(Infinity)

const GAP = 4
const MORE_BTN_WIDTH = 40

const setItemRef = (el, index) => {
  itemRefs.value[index] = el
}

const items = computed(() => {
  const list = [
    { key: 'undo-redo', component: UndoRedoButtons, props: { editor: props.editor }, separatorAfter: true },
    { key: 'heading', component: HeadingDropdown, props: { editor: props.editor } },
    { key: 'list', component: ListButtons, props: { editor: props.editor } },
    { key: 'block', component: BlockButtons, props: { editor: props.editor }, separatorAfter: true },
    { key: 'mark', component: MarkButtons, props: { editor: props.editor }, separatorAfter: true },
    { key: 'link', component: LinkPopover, props: { editor: props.editor } },
    { key: 'highlight', component: HighlightPicker, props: { editor: props.editor }, separatorAfter: true },
    { key: 'image', component: ImageInsert, props: { editor: props.editor, uploadFn: props.imageUploadFn } },
    { key: 'table', component: TableMenu, props: { editor: props.editor }, separatorAfter: props.useSourceMode }
  ]
  if (props.useSourceMode) {
    list.push({
      key: 'md-toggle',
      component: SourceToggle,
      isSourceToggle: true,
      props: {
        active: props.sourceMode,
        title: props.sourceMode ? t('editor.backToEditor') : t('editor.viewSource'),
        onToggle: () => emit('toggle-source')
      }
    })
  }
  return list
})

const visibleItems = computed(() => items.value.slice(0, visibleCount.value))
const overflowItems = computed(() => items.value.slice(visibleCount.value))

const computeVisibleCount = () => {
  const container = toolbarRef.value
  if (!container) return
  const containerWidth = container.clientWidth
  const widths = itemRefs.value.map((ref) => ref?.offsetWidth || 0)
  if (widths.length === 0) return

  const totalWidth = widths.reduce((a, b) => a + b, 0) + (widths.length - 1) * GAP
  if (totalWidth <= containerWidth) {
    visibleCount.value = widths.length
    return
  }

  let used = 0
  let count = 0
  for (let i = 0; i < widths.length; i++) {
    const withGap = count > 0 ? GAP : 0
    if (used + widths[i] + withGap <= containerWidth - MORE_BTN_WIDTH - GAP) {
      used += widths[i] + withGap
      count = i + 1
    } else {
      break
    }
  }
  visibleCount.value = count
}

let rafId = null
const measure = () => {
  if (rafId) cancelAnimationFrame(rafId)
  rafId = requestAnimationFrame(() => {
    rafId = null
    computeVisibleCount()
  })
}

let ro = null
onMounted(() => {
  computeVisibleCount()
  ro = new ResizeObserver(measure)
  if (toolbarRef.value) ro.observe(toolbarRef.value)
})

onBeforeUnmount(() => {
  ro?.disconnect()
  if (rafId) cancelAnimationFrame(rafId)
})

watch(() => items.value.length, () => nextTick(measure))
</script>
