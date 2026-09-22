<template>
  <ToolbarGroup>
    <ToolbarButton
      :disabled="!editor?.can().undo()"
      title="撤销 (Ctrl+Z)"
      @click="editor?.chain().focus().undo().run()"
    >
      <UndoIcon />
    </ToolbarButton>
    <ToolbarButton
      :disabled="!editor?.can().redo()"
      title="重做 (Ctrl+Y)"
      @click="editor?.chain().focus().redo().run()"
    >
      <RedoIcon />
    </ToolbarButton>
  </ToolbarGroup>
</template>

<script setup>
import { ToolbarButton, ToolbarGroup } from './primitives'
import { UndoIcon, RedoIcon } from '../icons'

defineProps({ editor: Object })
</script>
