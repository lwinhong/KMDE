<template>
  <ToolbarButton :is-active="editor?.isActive('highlight')" title="高亮"
    @click="editor?.chain().focus().toggleHighlight().run()">
    <HighlighterIcon :size="size" />
  </ToolbarButton>
</template>

<script setup>
import { ToolbarButton } from './primitives'
import { HighlighterIcon } from '../icons'

defineProps({
  editor: Object, size: {
    type: Number,
    default: 18
  }
})
</script>
