<template>
  <ToolbarGroup>
    <ToolbarButton v-for="mark in marks" :key="mark.type" :is-active="editor?.isActive(mark.type)" :title="$t(mark.titleKey)"
      @click="editor?.chain().focus()[mark.command]().run()">
      <component :is="mark.icon" :size="size" />
    </ToolbarButton>
  </ToolbarGroup>
</template>

<script setup>
import { ToolbarButton, ToolbarGroup } from './primitives'
import { BoldIcon, ItalicIcon, StrikeIcon, CodeIcon, UnderlineIcon } from '../icons'

defineProps({
  editor: Object, size: {
    type: Number,
    default: 18
  }
})

const marks = [
  { type: 'bold', icon: BoldIcon, titleKey: 'editor.bold', command: 'toggleBold' },
  { type: 'italic', icon: ItalicIcon, titleKey: 'editor.italic', command: 'toggleItalic' },
  { type: 'strike', icon: StrikeIcon, titleKey: 'editor.strike', command: 'toggleStrike' },
  { type: 'underline', icon: UnderlineIcon, titleKey: 'editor.underline', command: 'toggleUnderline' },
]
</script>
