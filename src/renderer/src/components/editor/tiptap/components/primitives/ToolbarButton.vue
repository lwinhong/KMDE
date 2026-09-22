<template>
  <button
    :class="[
      'toolbar-btn',
      isActive && 'is-active',
      disabled && 'is-disabled',
      dropdown && 'toolbar-btn-dropdown',
    ].filter(Boolean).join(' ')"
    :disabled="disabled"
    :title="title"
    @click="$emit('click', $event)"
  >
    <slot />
  </button>
</template>

<script setup>
defineProps({
  isActive: Boolean,
  disabled: Boolean,
  title: String,
  dropdown: Boolean,
})

defineEmits(['click'])
</script>
