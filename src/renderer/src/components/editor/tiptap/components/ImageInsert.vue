<template>
  <ToolbarDropdown align-right>
    <template #trigger="{ toggle }">
      <ToolbarButton :title="$t('editor.insertImage')" @click="toggle">
        <IconImagePlus />
      </ToolbarButton>
    </template>
    <template #default="{ close }">
      <div class="image-popover" @click.stop>
        <div class="image-form">
          <div class="image-form-row">
            <label class="image-form-label">{{ $t('editor.titleLabel') }}</label>
            <input
              v-model="imageTitle"
              type="text"
              :placeholder="$t('editor.imageTitlePlaceholder')"
              class="image-form-input"
            />
          </div>
          <div class="image-form-row">
            <label class="image-form-label">URL</label>
            <input
              v-model="imageUrl"
              type="url"
              :placeholder="$t('editor.imageUrlPlaceholder')"
              class="image-form-input"
              @keydown.enter.prevent="doConfirm(close)"
            />
          </div>
          <template v-if="uploadFn">
            <div class="image-form-divider">
              <span class="image-form-divider-text">{{ $t('editor.or') }}</span>
            </div>
            <div class="image-form-row">
              <button class="image-form-upload-btn" :disabled="uploading" @click="triggerFileInput">
                {{ uploading ? $t('editor.processing') : $t('editor.chooseLocalImage') }}
              </button>
              <input
                ref="fileInputRef"
                type="file"
                accept="image/*"
                style="display: none"
                @change="handleFileChange"
              />
            </div>
          </template>
          <div class="image-form-actions">
            <button class="image-form-btn" @click="close">{{ $t('common.cancel') }}</button>
            <button class="image-form-btn confirm" :disabled="!imageUrl.trim()" @click="doConfirm(close)">{{ $t('common.ok') }}</button>
          </div>
        </div>
      </div>
    </template>
  </ToolbarDropdown>
</template>

<script setup>
import { ref } from 'vue'
import { ToolbarButton, ToolbarDropdown } from './primitives'
import { IconImagePlus } from '@/components/icons'

const props = defineProps({
  editor: Object,
  uploadFn: Function,
})

const imageTitle = ref('')
const imageUrl = ref('')
const fileInputRef = ref(null)
const uploading = ref(false)

const triggerFileInput = () => {
  fileInputRef.value?.click()
}

const handleFileChange = async (e) => {
  const file = e.target.files?.[0]
  if (!file) return

  if (!props.uploadFn) {
    const reader = new FileReader()
    reader.onload = () => {
      const attrs = { src: reader.result, alt: file.name, title: file.name }
      props.editor?.chain().focus().setImage(attrs).run()
    }
    reader.readAsDataURL(file)
    fileInputRef.value.value = ''
    return
  }

  uploading.value = true
  try {
    const result = await props.uploadFn(file)
    const attrs = { src: result.url, alt: result.alt || file.name, title: result.alt || file.name }
    props.editor?.chain().focus().setImage(attrs).run()
  } catch (err) {
    console.error('图片上传失败:', err)
  } finally {
    uploading.value = false
    fileInputRef.value.value = ''
  }
}

const doConfirm = (close) => {
  const url = imageUrl.value.trim()
  if (!url) return
  const attrs = { src: url }
  const title = imageTitle.value.trim()
  if (title) {
    attrs.alt = title
    attrs.title = title
  }
  props.editor?.chain().focus().setImage(attrs).run()
  imageTitle.value = ''
  imageUrl.value = ''
  close()
}
</script>

<style scoped>
.image-form-divider {
  display: flex;
  align-items: center;
  margin: 8px 0;
  gap: 8px;
}

.image-form-divider::before,
.image-form-divider::after {
  content: '';
  flex: 1;
  height: 1px;
  background: var(--kme-border-light);
}

.image-form-divider-text {
  color: var(--kme-text-3);
  font-size: 12px;
}

.image-form-upload-btn {
  width: 100%;
  height: 30px;
  border: 1px dashed var(--kme-border);
  border-radius: 4px;
  background: var(--kme-bg);
  color: var(--kme-text-2);
  font-size: 12.5px;
  cursor: pointer;
  transition: all 0.15s;
}

.image-form-upload-btn:hover:not(:disabled) {
  border-color: var(--kme-primary);
  color: var(--kme-primary);
}

.image-form-upload-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.image-form-actions {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}

.image-form-btn {
  height: 28px;
  padding: 0 10px;
  border-radius: 4px;
  font-size: 12px;
  cursor: pointer;
  transition: all 0.15s;
  border: 1px solid var(--kme-border);
  background: var(--kme-bg);
  color: var(--kme-text-2);
  display: inline-flex;
  align-items: center;
}

.image-form-btn:hover {
  border-color: var(--kme-text-3);
}

.image-form-btn.confirm {
  background: var(--kme-primary);
  color: #ffffff;
  border-color: var(--kme-primary);
}

.image-form-btn.confirm:hover {
  background: var(--kme-primary-hover);
  border-color: var(--kme-primary-hover);
}

.image-form-btn.confirm:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
</style>
