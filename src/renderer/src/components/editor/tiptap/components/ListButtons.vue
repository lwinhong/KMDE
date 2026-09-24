<template>
  <ToolbarGroup>
    <ToolbarButton
      :is-active="editor?.isActive('bulletList')"
      :title="$t('editor.bulletList')"
      @click="editor?.chain().focus().toggleBulletList().run()"
    >
      <IconListBullet :size="18" />
    </ToolbarButton>
    <ToolbarButton
      :is-active="editor?.isActive('orderedList')"
      :title="$t('editor.orderedList')"
      @click="editor?.chain().focus().toggleOrderedList().run()"
    >
      <IconListOrdered :size="18" />
    </ToolbarButton>
    <ToolbarButton
      :is-active="editor?.isActive('taskList')"
      :title="$t('editor.taskList')"
      @click="editor?.chain().focus().toggleTaskList().run()"
    >
      <IconListTodo :size="18" />
    </ToolbarButton>
  </ToolbarGroup>
</template>

<script setup>
import { ToolbarButton, ToolbarGroup } from './primitives'
import { IconListBullet, IconListOrdered, IconListTodo } from '@/components/icons'

defineProps({ editor: Object })
</script>
