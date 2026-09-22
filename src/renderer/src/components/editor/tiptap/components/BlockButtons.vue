<template>
  <ToolbarGroup>
    <ToolbarButton :is-active="editor?.isActive('blockquote')" :title="$t('editor.blockquote')"
      @click="editor?.chain().focus().toggleBlockquote().run()">
      <BlockquoteIcon :size="size" />
    </ToolbarButton>
    <ToolbarButton :is-active="editor?.isActive('codeBlock')" :title="$t('editor.codeBlock')"
      @click="editor?.chain().focus().toggleCodeBlock().run()">
      <CodeBlockIcon :size="size" />
    </ToolbarButton>
    <ToolbarButton :is-active="editor?.isActive('code')" :title="$t('editor.inlineCode')"
      @click="editor?.chain().focus().toggleCode().run()">
      <CodeIcon />
    </ToolbarButton>
    <ToolbarButton v-if="showLine" :title="$t('editor.horizontalRule')" @click="editor?.chain().focus().setHorizontalRule().run()">
      <HorizontalRuleIcon :size="size" />
    </ToolbarButton>
  </ToolbarGroup>
</template>

<script setup>
import { ToolbarButton, ToolbarGroup } from './primitives'
import { BlockquoteIcon, CodeBlockIcon, HorizontalRuleIcon, CodeIcon } from '../icons'

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
