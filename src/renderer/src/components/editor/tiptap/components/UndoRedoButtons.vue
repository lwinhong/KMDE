<template>
  <ToolbarGroup>
    <ToolbarButton
      :disabled="!editor?.can().undo()"
      :title="$t('editor.undo')"
      @click="editor?.chain().focus().undo().run()"
    >
      <UndoIcon />
    </ToolbarButton>
    <ToolbarButton
      :disabled="!editor?.can().redo()"
      :title="$t('editor.redo')"
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
