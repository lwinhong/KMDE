<template>
  <ToolbarGroup>
    <ToolbarButton
      :is-active="editor?.isActive('bulletList')"
      title="无序列表"
      @click="editor?.chain().focus().toggleBulletList().run()"
    >
      <ListBulletIcon :size="18" />
    </ToolbarButton>
    <ToolbarButton
      :is-active="editor?.isActive('orderedList')"
      title="有序列表"
      @click="editor?.chain().focus().toggleOrderedList().run()"
    >
      <ListOrderedIcon :size="18" />
    </ToolbarButton>
    <ToolbarButton
      :is-active="editor?.isActive('taskList')"
      title="任务列表"
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
