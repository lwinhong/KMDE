<script lang="ts">
/* ---------------------------------------------------------------
 * mermaid 渲染服务（真正的模块级作用域，所有实例共享）。
 *
 * 注意：`<script setup>` 的顶层代码会被编译进 setup() 函数体，
 * 属于实例级状态，不能放共享单例。
 *
 * mermaid 是全局单例：并发的 initialize/render 会互相打断，且
 * mermaid.render 开头会按 id 删除文档中已存在的同名元素
 * （removeExistingElements -> getElementById(id).remove()）。
 * 如果每个实例各自维护 ID 计数器，首次渲染都会拿到相同 ID，
 * 后一次渲染会把已插入文档的前一个 SVG 删掉——这正是"打开
 * 文档所有图表空白、切换一次后又出现"的根因。因此：
 *  1. 模块只动态 import 一次，全局复用；
 *  2. 所有渲染请求进入全局串行队列，逐个执行；
 *  3. 渲染 ID 全局递增，避免任何两次渲染产生相同 ID；
 *  4. initialize 仅在主题真正变化时调用（且在队列内执行）。
 * --------------------------------------------------------------- */
let mermaidModule: Promise<typeof import('mermaid')> | null = null
let renderChain: Promise<unknown> = Promise.resolve()
let mermaidIdSeq = 0
let mermaidTheme: string | null = null

function loadMermaid(): Promise<typeof import('mermaid')> {
  if (!mermaidModule) mermaidModule = import('mermaid')
  return mermaidModule
}

function enqueueRender(task: () => Promise<void>): Promise<void> {
  const run = renderChain.then(task, task)
  renderChain = run.catch(() => undefined)
  return run
}
</script>

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
  await enqueueRender(async () => {
    if (seq !== renderSeq) return
    try {
      const mermaid = (await loadMermaid()).default
      const theme = settings.isDark ? 'dark' : 'default'
      if (theme !== mermaidTheme) {
        mermaid.initialize({
          startOnLoad: false,
          theme,
          securityLevel: 'loose'
        })
        mermaidTheme = theme
      }
      const result = await mermaid.render(`kme-mermaid-${++mermaidIdSeq}`, code)
      if (seq === renderSeq) {
        svg.value = result.svg
        mermaidError.value = ''
      }
    } catch (err) {
      console.error('[MermaidCodeBlock] render error:', err)
      if (seq === renderSeq) {
        svg.value = ''
        mermaidError.value = err instanceof Error ? err.message : String(err)
      }
    }
  })
}

function scheduleRender(): void {
  if (renderTimer) clearTimeout(renderTimer)
  renderTimer = setTimeout(() => {
    renderTimer = null
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
    // 首次渲染等待节点视图真正插入文档并完成首帧布局，
    // 避免与 EditorContent 挂载过程竞争导致渲染失败。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        void renderMermaid()
      })
    })
  }
})

onBeforeUnmount(() => {
  if (renderTimer) clearTimeout(renderTimer)
})

/* ------------------------- zoom ------------------------- */

const MIN_ZOOM = 0.25
const MAX_ZOOM = 4
const ZOOM_STEP = 1.25
const zoom = ref(1)

function zoomBy(factor: number): void {
  zoom.value = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.round(zoom.value * factor * 100) / 100))
}

function zoomIn(): void {
  zoomBy(ZOOM_STEP)
}

function zoomOut(): void {
  zoomBy(1 / ZOOM_STEP)
}

function resetZoom(): void {
  zoom.value = 1
}

function onPreviewWheel(event: WheelEvent): void {
  event.preventDefault()
  zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)
}

/* ------------------------- copy ------------------------- */

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
      @wheel="onPreviewWheel"
    >
      <div v-if="svg" class="kme-mermaid-svg" :style="{ zoom: String(zoom) }" v-html="svg"></div>
      <div v-if="mermaidError" class="kme-mermaid-error">
        <div class="kme-mermaid-error-title">{{ $t('editor.mermaidRenderFailed') }}</div>
        <pre class="kme-mermaid-error-detail">{{ mermaidError }}</pre>
        <button class="kme-codeblock-btn" @click="previewMode = false">{{ $t('editor.viewSourceCode') }}</button>
      </div>
      <div v-if="!svg && !mermaidError" class="kme-mermaid-placeholder">{{ $t('editor.emptyDiagram') }}</div>
      <div v-if="svg" class="kme-mermaid-zoom" contenteditable="false" @dblclick.stop>
        <button
          class="kme-mz-btn"
          :title="$t('editor.zoomOut')"
          :disabled="zoom <= MIN_ZOOM"
          @click="zoomOut"
        >
          −
        </button>
        <button class="kme-mz-label" :title="$t('editor.zoomReset')" @click="resetZoom">
          {{ Math.round(zoom * 100) }}%
        </button>
        <button
          class="kme-mz-btn"
          :title="$t('editor.zoomIn')"
          :disabled="zoom >= MAX_ZOOM"
          @click="zoomIn"
        >
          ＋
        </button>
      </div>
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
  position: relative;
  padding: 16px;
  min-height: 60px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
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

.kme-mermaid-zoom {
  position: absolute;
  top: 6px;
  right: 6px;
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: var(--kme-glass-bg);
  backdrop-filter: blur(8px);
  border: 1px solid var(--kme-border-light);
  border-radius: var(--kme-radius-sm);
  box-shadow: var(--kme-shadow-xs);
  user-select: none;
}

.kme-mz-btn {
  min-width: 22px;
  height: 22px;
  padding: 0 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--kme-text-2);
  font-size: 14px;
  line-height: 1;
  cursor: pointer;
}

.kme-mz-btn:hover:not(:disabled) {
  background: var(--kme-bg-hover);
  color: var(--kme-text-1);
}

.kme-mz-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.kme-mz-label {
  min-width: 42px;
  height: 22px;
  padding: 0 4px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: var(--kme-text-2);
  font-size: 11px;
  line-height: 22px;
  text-align: center;
  cursor: pointer;
}

.kme-mz-label:hover {
  background: var(--kme-bg-hover);
  color: var(--kme-text-1);
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
