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
import { IconBold, IconItalic, IconStrike, IconCode, IconUnderline } from '@/components/icons'

defineProps({
  editor: Object, size: {
    type: Number,
    default: 18
  }
})

const marks = [
  { type: 'bold', icon: IconBold, titleKey: 'editor.bold', command: 'toggleBold' },
  { type: 'italic', icon: IconItalic, titleKey: 'editor.italic', command: 'toggleItalic' },
  { type: 'strike', icon: IconStrike, titleKey: 'editor.strike', command: 'toggleStrike' },
  { type: 'underline', icon: IconUnderline, titleKey: 'editor.underline', command: 'toggleUnderline' },
]
</script>
