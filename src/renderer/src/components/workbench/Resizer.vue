<script setup lang="ts">
import { ref } from 'vue'

const props = withDefaults(defineProps<{
  side?: 'left' | 'right'
}>(), {
  side: 'left'
})

const emit = defineEmits<{
  (e: 'resize', deltaPx: number): void
  (e: 'resize-end'): void
}>()

const dragging = ref(false)

function onDown(e: MouseEvent): void {
  e.preventDefault()
  dragging.value = true
  let lastX = e.clientX
  const onMove = (ev: MouseEvent): void => {
    const delta = ev.clientX - lastX
    lastX = ev.clientX
    if (delta !== 0) emit('resize', props.side === 'left' ? delta : -delta)
  }
  const onUp = (): void => {
    dragging.value = false
    window.removeEventListener('mousemove', onMove)
    window.removeEventListener('mouseup', onUp)
    document.body.style.cursor = ''
    document.body.style.userSelect = ''
    emit('resize-end')
  }
  window.addEventListener('mousemove', onMove)
  window.addEventListener('mouseup', onUp)
  document.body.style.cursor = 'col-resize'
  document.body.style.userSelect = 'none'
}
</script>

<template>
  <div
    class="resizer"
    :class="{ 'is-dragging': dragging }"
    @mousedown="onDown"
  ></div>
</template>

<style scoped>
.resizer {
  width: 4px;
  flex-shrink: 0;
  cursor: col-resize;
  background: transparent;
  position: relative;
  z-index: 1;
  transition: background 0.15s;
}

.resizer:hover,
.resizer.is-dragging {
  background: var(--kme-primary);
}
</style>
