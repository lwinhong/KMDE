<template>
  <ToolbarGroup>
    <ToolbarButton :is-active="editor?.isActive('blockquote')" title="引用"
      @click="editor?.chain().focus().toggleBlockquote().run()">
      <BlockquoteIcon :size="size" />
    </ToolbarButton>
    <ToolbarButton :is-active="editor?.isActive('codeBlock')" title="代码块"
      @click="editor?.chain().focus().toggleCodeBlock().run()">
      <CodeBlockIcon :size="size" />
    </ToolbarButton>
    <!-- { type: 'code', icon: CodeIcon, title: '行内代码', command: 'toggleCode' }, -->
    <ToolbarButton :is-active="editor?.isActive('code')" title="行内代码"
      @click="editor?.chain().focus().toggleCode().run()">
      <CodeIcon />
    </ToolbarButton>
    <ToolbarButton v-if="showLine" title="分割线" @click="editor?.chain().focus().setHorizontalRule().run()">
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
