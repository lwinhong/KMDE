<script setup lang="ts">
import { computed, ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { NodeViewContent, nodeViewProps, NodeViewWrapper } from '@tiptap/vue-3'
import { useSettingsStore } from '@/stores/settings.store'

const props = defineProps(nodeViewProps)
const settings = useSettingsStore()
const copied = ref(false)

const LANGUAGES = [
  '', 'plaintext', 'mermaid', 'javascript', 'typescript', 'html', 'css', 'json',
  'python', 'java', 'go', 'rust', 'c', 'cpp', 'csharp', 'sql', 'shell', 'bash', 'yaml', 'xml', 'markdown'
]

const language = computed({
  get: () => (props.node.attrs.language as string) || '',
  set: (value: string) => {
    props.updateAttributes({ language: value || null })
  }
})

const isMermaid = computed(() => (props.node.attrs.language as string) === 'mermaid')
const previewMode = ref(true)
const svg = ref('')
const mermaidError = ref('')
let renderTimer: ReturnType<typeof setTimeout> | null = null
let renderSeq = 0

async function renderMermaid(): Promise<void> {
  if (!isMermaid.value || !previewMode.value) return
  const code = props.node.textContent
  if (!code.trim()) {
    svg.value = ''
    mermaidError.value = ''
    return
  }
  const seq = ++renderSeq
  try {
    const mermaid = (await import('mermaid')).default
    mermaid.initialize({
      startOnLoad: false,
      theme: settings.isDark ? 'dark' : 'default',
      securityLevel: 'loose'
    })
    const result = await mermaid.render(`kme-mermaid-${seq}`, code)
    if (seq === renderSeq) {
      svg.value = result.svg
      mermaidError.value = ''
    }
  } catch (err) {
    if (seq === renderSeq) {
      svg.value = ''
      mermaidError.value = err instanceof Error ? err.message : String(err)
    }
  }
}

function scheduleRender(): void {
  if (renderTimer) clearTimeout(renderTimer)
  renderTimer = setTimeout(() => {
    void renderMermaid()
  }, 300)
}

watch(
  () => props.node.textContent,
  () => {
    if (isMermaid.value && previewMode.value) scheduleRender()
  }
)

watch(
  () => [isMermaid.value, previewMode.value] as const,
  () => {
    if (isMermaid.value && previewMode.value) {
      void renderMermaid()
    }
  },
  { immediate: false }
)

watch(
  () => settings.isDark,
  () => {
    if (isMermaid.value && previewMode.value) {
      void renderMermaid()
    }
  }
)

onMounted(() => {
  if (isMermaid.value) {
    previewMode.value = true
    void renderMermaid()
  }
})

onBeforeUnmount(() => {
  if (renderTimer) clearTimeout(renderTimer)
})

let copyTimer: ReturnType<typeof setTimeout> | null = null

async function handleCopy(): Promise<void> {
  const text = props.node.textContent
  let ok = false
  try {
    await navigator.clipboard.writeText(text)
    ok = true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      document.body.appendChild(ta)
      ta.select()
      ok = document.execCommand('copy')
      document.body.removeChild(ta)
    } catch {
      ok = false
    }
  }
  if (ok) {
    copied.value = true
    if (copyTimer) clearTimeout(copyTimer)
    copyTimer = setTimeout(() => {
      copied.value = false
    }, 1600)
  }
}
</script>

<template>
  <node-view-wrapper class="kme-codeblock" :class="{ 'is-mermaid': isMermaid }">
    <div class="kme-codeblock-bar" contenteditable="false">
      <select class="kme-codeblock-lang" :value="language" @change="language = ($event.target as HTMLSelectElement).value">
        <option v-for="lang in LANGUAGES" :key="lang" :value="lang">
          {{ lang === '' ? $t('editor.plaintext') : lang }}
        </option>
      </select>
      <span class="kme-codeblock-spacer" />
      <template v-if="isMermaid">
        <button
          class="kme-codeblock-btn"
          :class="{ 'is-active': previewMode }"
          :title="$t('editor.previewDiagram')"
          @click="previewMode = true"
        >
          {{ $t('editor.diagram') }}
        </button>
        <button
          class="kme-codeblock-btn"
          :class="{ 'is-active': !previewMode }"
          :title="$t('editor.editSource')"
          @click="previewMode = false"
        >
          {{ $t('editor.source') }}
        </button>
      </template>
      <button class="kme-codeblock-btn" :title="$t('editor.copy')" @click="handleCopy">
        {{ copied ? $t('editor.copied') : $t('editor.copy') }}
      </button>
    </div>
    <div
      v-if="isMermaid"
      v-show="previewMode"
      class="kme-mermaid-preview"
      :class="{ 'has-error': !!mermaidError }"
      @dblclick="previewMode = false"
    >
      <div v-if="svg" class="kme-mermaid-svg" v-html="svg"></div>
      <div v-if="mermaidError" class="kme-mermaid-error">
        <div class="kme-mermaid-error-title">{{ $t('editor.mermaidRenderFailed') }}</div>
        <pre class="kme-mermaid-error-detail">{{ mermaidError }}</pre>
        <button class="kme-codeblock-btn" @click="previewMode = false">{{ $t('editor.viewSourceCode') }}</button>
      </div>
      <div v-if="!svg && !mermaidError" class="kme-mermaid-placeholder">{{ $t('editor.emptyDiagram') }}</div>
    </div>
    <pre v-show="!(isMermaid && previewMode)" class="kme-codeblock-pre"><code><node-view-content /></code></pre>
  </node-view-wrapper>
</template>

<style scoped>
.kme-codeblock {
  position: relative;
  border-radius: 8px;
  overflow: hidden;
  background: var(--kme-code-bg);
  border: 1px solid var(--kme-border);
  margin: 0.5em 0;
}

.kme-codeblock-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 8px;
  background: var(--kme-bg-soft);
  border-bottom: 1px solid var(--kme-border-light);
  user-select: none;
}

.kme-codeblock-lang {
  border: none;
  background: transparent;
  color: var(--kme-text-3);
  font-size: 11.5px;
  font-family: inherit;
  outline: none;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 4px;
}

.kme-codeblock-lang:hover {
  background: var(--kme-bg-hover);
  color: var(--kme-text-2);
}

.kme-codeblock-spacer {
  flex: 1;
}

.kme-codeblock-btn {
  border: none;
  background: transparent;
  color: var(--kme-text-3);
  font-size: 11.5px;
  padding: 3px 8px;
  border-radius: 4px;
  cursor: pointer;
}

.kme-codeblock-btn:hover {
  background: var(--kme-bg-hover);
  color: var(--kme-text-1);
}

.kme-codeblock-btn.is-active {
  background: var(--kme-primary-weak);
  color: var(--kme-primary);
}

.kme-codeblock-pre {
  margin: 0;
  padding: 12px 14px;
  overflow-x: auto;
  tab-size: 2;
}

.kme-mermaid-preview {
  padding: 16px;
  min-height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow-x: auto;
}

.kme-mermaid-svg :deep(svg) {
  max-width: 100%;
  height: auto;
}

.kme-mermaid-placeholder {
  margin: 0;
  width: 100%;
  min-height: 40px;
  color: var(--kme-text-3);
}

.kme-mermaid-error {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  color: var(--kme-danger);
  font-size: 12.5px;
  max-width: 100%;
}

.kme-mermaid-error-title {
  font-weight: 600;
}

.kme-mermaid-error-detail {
  margin: 0;
  max-height: 120px;
  overflow: auto;
  font-size: 11.5px;
  opacity: 0.85;
  white-space: pre-wrap;
}
</style>
