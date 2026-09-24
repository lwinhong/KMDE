<template>
  <ToolbarDropdown align-right>
    <template #trigger="{ toggle }">
      <ToolbarButton :is-active="editor?.isActive('link')" :title="$t('editor.link')" @click="handleToggle(toggle)">
        <IconLink :size="size" />
      </ToolbarButton>
    </template>
    <template #default="{ close }">
      <div class="link-popover" @click.stop>
        <div class="link-form-row" v-if="!hasSelection">
          <label class="link-form-label">{{ $t('editor.titleLabel') }}</label>
          <input v-model="linkTitle" type="text" :placeholder="$t('editor.linkTitlePlaceholder')" class="link-form-input" />
        </div>
        <div class="link-form-row">
          <label class="link-form-label">URL</label>
          <input ref="inputRef" v-model="linkUrl" type="url" :placeholder="$t('editor.linkUrlPlaceholder')" class="link-form-input"
            @keydown.enter.prevent="doSetLink(close)" />
        </div>
        <div class="link-form-actions">
          <button v-if="editor?.isActive('link')" class="link-form-btn" :title="$t('editor.openInNewWindow')" @click="openLink">
            <IconExternalLink size="16" />
          </button>
          <button v-if="editor?.isActive('link')" class="link-form-btn danger" :title="$t('editor.removeLink')" @click="removeLink(close)">
            <IconTrash size="16" />
          </button>
          <span class="link-form-divider-v" />
          <button class="link-form-btn" @click="close">{{ $t('common.close') }}</button>
          <button class="link-form-btn confirm" :disabled="!linkUrl.trim()" @click="doSetLink(close)">{{ $t('common.ok') }}</button>
        </div>
      </div>
    </template>
  </ToolbarDropdown>
</template>

<script setup>
import { ref, nextTick, computed } from 'vue'
import { ToolbarButton, ToolbarDropdown } from './primitives'
import { IconLink, IconExternalLink, IconTrash } from '@/components/icons'

const props = defineProps({
  editor: Object,
  size: {
    type: Number,
    default: 18
  }
})

const linkUrl = ref('')
const linkTitle = ref('')
const inputRef = ref(null)

const hasSelection = computed(() => {
  const { selection } = props.editor?.state || {}
  return selection && !selection.empty
})

const handleToggle = (toggleFn) => {
  toggleFn()
  const attrs = props.editor?.getAttributes('link')
  linkUrl.value = attrs?.href || ''
  linkTitle.value = attrs?.title || ''
  nextTick(() => inputRef.value?.focus())
}

const doSetLink = (close) => {
  const url = linkUrl.value.trim()
  if (!url || !props.editor) return

  const { selection } = props.editor.state
  const isEmpty = selection.empty

  let chain = props.editor.chain().focus()

  chain = chain.extendMarkRange('link').setLink({ href: url })

  if (isEmpty) {
    chain = chain.insertContent({ type: 'text', text: url })
  }

  chain.run()

  linkUrl.value = ''
  linkTitle.value = ''
  close()
}

const openLink = () => {
  const href = props.editor?.getAttributes('link')?.href
  if (href) window.open(href, '_blank')
}

const removeLink = (close) => {
  props.editor?.chain().focus().extendMarkRange('link').unsetLink().run()
  linkUrl.value = ''
  linkTitle.value = ''
  close()
}
</script>

<style scoped>
.link-popover {
  min-width: 260px;
  padding: 8px;
}

.link-form-row {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.link-form-label {
  font-size: 12px;
  color: var(--kme-text-3);
  font-weight: 500;
}

.link-form-input {
  width: 100%;
  height: 32px;
  padding: 0 8px;
  border: 1px solid var(--kme-border);
  border-radius: 4px;
  font-size: 13px;
  outline: none;
  transition: border-color 0.15s;
  box-sizing: border-box;
}

.link-form-input:focus {
  border-color: var(--kme-primary);
}

.link-form-input::placeholder {
  color: var(--kme-text-3);
}

.link-form-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.link-form-divider-v {
  width: 1px;
  height: 16px;
  background: var(--kme-border);
}

.link-form-btn {
  height: 28px;
  padding: 0 10px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid var(--kme-border);
  background: #ffffff;
  color: var(--kme-text-2);
  display: inline-flex;
  align-items: center;
}

.link-form-btn:hover {
  border-color: var(--kme-text-3);
}

.link-form-btn.confirm {
  background: var(--kme-primary);
  color: #ffffff;
  border-color: var(--kme-primary);
}

.link-form-btn.confirm:hover {
  background: var(--kme-primary-hover);
}

.link-form-btn.confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.link-form-btn.danger {
  color: var(--kme-danger);
  border-color: var(--kme-danger);
}

.link-form-btn.danger:hover {
  background: rgba(229, 72, 77, 0.08);
}
</style>
