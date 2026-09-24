<template>
  <ToolbarGroup>
    <ToolbarButton :is-active="editor?.isActive('blockquote')" :title="$t('editor.blockquote')"
      @click="editor?.chain().focus().toggleBlockquote().run()">
      <IconBlockquote :size="size" />
    </ToolbarButton>
    <ToolbarButton :is-active="editor?.isActive('codeBlock')" :title="$t('editor.codeBlock')"
      @click="editor?.chain().focus().toggleCodeBlock().run()">
      <IconCodeBlock :size="size" />
    </ToolbarButton>
    <ToolbarButton :is-active="editor?.isActive('code')" :title="$t('editor.inlineCode')"
      @click="editor?.chain().focus().toggleCode().run()">
      <IconCode />
    </ToolbarButton>
    <ToolbarButton v-if="showLine" :title="$t('editor.horizontalRule')" @click="editor?.chain().focus().setHorizontalRule().run()">
      <IconHorizontalRule :size="size" />
    </ToolbarButton>
  </ToolbarGroup>
</template>

<script setup>
import { ToolbarButton, ToolbarGroup } from './primitives'
import { IconBlockquote, IconCodeBlock, IconHorizontalRule, IconCode } from '@/components/icons'

defineProps({
  editor: Object, size: {
    type: Number,
    default: 18
  },
  showLine: {
    type: Boolean,
    default: true
  }
})
</script>
