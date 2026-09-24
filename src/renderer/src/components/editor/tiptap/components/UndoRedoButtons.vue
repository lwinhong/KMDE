<template>
  <ToolbarGroup>
    <ToolbarButton
      :disabled="!editor?.can().undo()"
      :title="$t('editor.undo')"
      @click="editor?.chain().focus().undo().run()"
    >
      <IconUndo />
    </ToolbarButton>
    <ToolbarButton
      :disabled="!editor?.can().redo()"
      :title="$t('editor.redo')"
      @click="editor?.chain().focus().redo().run()"
    >
      <IconRedo />
    </ToolbarButton>
  </ToolbarGroup>
</template>

<script setup>
import { ToolbarButton, ToolbarGroup } from './primitives'
import { IconUndo, IconRedo } from '@/components/icons'

defineProps({ editor: Object })
</script>
