<template>
  <ToolbarGroup>
    <ToolbarButton v-for="mark in marks" :key="mark.type" :is-active="editor?.isActive(mark.type)" :title="mark.title"
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
  { type: 'bold', icon: BoldIcon, title: '加粗 (Ctrl+B)', command: 'toggleBold' },
  { type: 'italic', icon: ItalicIcon, title: '斜体 (Ctrl+I)', command: 'toggleItalic' },
  { type: 'strike', icon: StrikeIcon, title: '删除线', command: 'toggleStrike' },
  { type: 'underline', icon: UnderlineIcon, title: '下划线 (Ctrl+U)', command: 'toggleUnderline' },
  // { type: 'code', icon: CodeIcon, title: '行内代码', command: 'toggleCode' },
]
</script>
