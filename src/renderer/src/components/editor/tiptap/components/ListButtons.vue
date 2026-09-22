<template>
  <ToolbarGroup>
    <ToolbarButton
      :is-active="editor?.isActive('bulletList')"
      :title="$t('editor.bulletList')"
      @click="editor?.chain().focus().toggleBulletList().run()"
    >
      <ListBulletIcon :size="18" />
    </ToolbarButton>
    <ToolbarButton
      :is-active="editor?.isActive('orderedList')"
      :title="$t('editor.orderedList')"
      @click="editor?.chain().focus().toggleOrderedList().run()"
    >
      <ListOrderedIcon :size="18" />
    </ToolbarButton>
    <ToolbarButton
      :is-active="editor?.isActive('taskList')"
      :title="$t('editor.taskList')"
      @click="editor?.chain().focus().toggleTaskList().run()"
    >
      <ListTodoIcon :size="18" />
    </ToolbarButton>
  </ToolbarGroup>
</template>

<script setup>
import { ToolbarButton, ToolbarGroup } from './primitives'
import { ListBulletIcon, ListOrderedIcon, ListTodoIcon } from '../icons'

defineProps({ editor: Object })
</script>
