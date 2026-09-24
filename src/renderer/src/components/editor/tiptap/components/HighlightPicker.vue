<template>
  <ToolbarButton :is-active="editor?.isActive('highlight')" :title="$t('editor.highlight')"
    @click="editor?.chain().focus().toggleHighlight().run()">
    <IconHighlighter :size="size" />
  </ToolbarButton>
</template>

<script setup>
import { ToolbarButton } from './primitives'
import { IconHighlighter } from '@/components/icons'

defineProps({
  editor: Object, size: {
    type: Number,
    default: 18
  }
})
</script>
