<template>
  <ToolbarGroup>
    <ToolbarDropdown>
      <template #trigger="{ toggle }">
        <ToolbarButton :is-active="isActive" :title="$t('editor.heading')" dropdown @click="toggle">
          <IconHeading size="16" />
          <IconChevronDownSolid class="dropdown-arrow" />
        </ToolbarButton>
      </template>
      <template #default="{ close }">
        <button
          v-for="level in [1, 2, 3, 4]"
          :key="level"
          :class="['dropdown-item', editor?.isActive('heading', { level }) && 'is-active']"
          @click="toggleHeading(level); close()"
        >
          <span :class="`dropdown-item-heading h${level}`">H{{ level }}</span>
          <span class="dropdown-item-label">{{ $t('editor.headingN', { level }) }}</span>
        </button>
        <button
          :class="['dropdown-item', editor?.isActive('paragraph') && !isActive && 'is-active']"
          @click="setParagraph(); close()"
        >
          <span class="dropdown-item-heading h0">¶</span>
          <span class="dropdown-item-label">{{ $t('editor.paragraph') }}</span>
        </button>
      </template>
    </ToolbarDropdown>
  </ToolbarGroup>
</template>

<script setup>
import { computed } from 'vue'
import { ToolbarButton, ToolbarGroup, ToolbarDropdown } from './primitives'
import { IconHeading, IconChevronDownSolid } from '@/components/icons'

const props = defineProps({ editor: Object })

// eslint-disable-next-line no-useless-assignment
const isActive = computed(() => {
  if (!props.editor) return false
  return [1, 2, 3, 4].some(l => props.editor.isActive('heading', { level: l }))
})

// eslint-disable-next-line no-useless-assignment
const toggleHeading = (level) => {
  props.editor.chain().focus().toggleHeading({ level }).run()
}

// eslint-disable-next-line no-useless-assignment
const setParagraph = () => {
  props.editor.chain().focus().setParagraph().run()
}
</script>
