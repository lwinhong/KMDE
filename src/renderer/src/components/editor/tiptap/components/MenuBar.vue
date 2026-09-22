<template>
  <div class="tiptap-toolbar" :class="{ 'source-mode': sourceMode }">
    <UndoRedoButtons :editor="editor" />
    <ToolbarSeparator />
    <HeadingDropdown :editor="editor" />
    <ListButtons :editor="editor" />
    <BlockButtons :editor="editor" />
    <ToolbarSeparator />
    <MarkButtons :editor="editor" />
    <ToolbarSeparator />
    <LinkPopover :editor="editor" />
    <HighlightPicker :editor="editor" />
    <ToolbarSeparator />
    <ImageInsert :editor="editor" :upload-fn="imageUploadFn" />
    <TableMenu :editor="editor" />
    <template v-if="useSourceMode">
      <ToolbarSeparator />
      <ToolbarButton class="md-toggle-btn" :title="sourceMode ? '返回编辑器' : '查看 Markdown 源码'"
        :class="{ 'is-active': sourceMode }" @click="$emit('toggle-source')">
        <MarkdownIcon :size="18" />
      </ToolbarButton>
    </template>
  </div>
</template>

<script setup>
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
import { MarkdownIcon } from '../icons'
import './toolbar.css'

defineProps({
  editor: {
    type: Object,
    required: true
  },
  sourceMode: {
    type: Boolean,
    default: false,
  },
  useSourceMode: {
    type: Boolean,
    default: false,
  },
  imageUploadFn: {
    type: Function,
    default: null,
  }
})

defineEmits(['toggle-source'])
</script>
