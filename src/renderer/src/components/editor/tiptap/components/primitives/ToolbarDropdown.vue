<template>
  <div class="dropdown-wrapper" ref="wrapperRef">
    <slot name="trigger" :open="open" :toggle="toggle" />
    <div v-if="open" :class="['dropdown-menu', alignRight && 'table-menu'].filter(Boolean).join(' ')">
      <slot :open="open" :toggle="toggle" :close="close" />
    </div>
  </div>
</template>

<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'

const props = defineProps({
  alignRight: Boolean,
})

const open = ref(false)
const wrapperRef = ref(null)

const toggle = () => { open.value = !open.value }
const close = () => { open.value = false }

const handleClickOutside = (event) => {
  if (wrapperRef.value && !wrapperRef.value.contains(event.target)) {
    close()
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>
