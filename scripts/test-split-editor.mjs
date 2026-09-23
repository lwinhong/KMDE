import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createRenderer, h, nextTick, reactive } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { build } from 'vite'

// 用法：node scripts/test-split-editor.mjs
// 在内存中加载真实 SplitEditor setup；用可控的假面板替换两个编辑器与 Resizer，
// 验证分屏的内容同步转发、聚焦侧接口转发与滚动联动挂接。
const filename = new URL('../src/renderer/src/components/editor/SplitEditor.vue', import.meta.url)
const { descriptor } = parse(await readFile(filename, 'utf8'))
const script = compileScript(descriptor, { id: 'split-editor-test' })
// 虚拟入口使用 .ts 后缀，让打包器按 TS 解析 script setup 中的类型语法。
const entry = fileURLToPath(filename).replace(/\\/g, '/').replace(/\.vue$/, '.split-test.ts')
// rolldown 在 Windows 上会用反斜杠路径询问入口，需要规范化后再比较。
const samePath = (a, b) => a.replace(/\\/g, '/').toLowerCase() === b.replace(/\\/g, '/').toLowerCase()

function paneStubCode(name) {
  return `
export default {
  name: '${name}-stub',
  props: { tab: { type: Object, required: true }, locked: { type: Boolean, default: false } },
  emits: ['update', 'outline-change', 'toggle-mode'],
  setup(_props, { expose, emit }) {
    const pane = globalThis.__splitTest.panes.${name}
    pane.emit = emit
    expose({
      getSelection: () => pane.selection,
      whenReady: () => pane.readyPromise,
      focus: () => { pane.focused++ },
      getScrollElement: () => pane.scrollEl,
      applyExternalContent: (markdown) => { pane.applied.push(markdown) },
      flush: () => { pane.flushed++; return pane.flushResult },
      jumpTo: (item) => { pane.jumped = item },
      emitOutline: () => { pane.manualOutline++ },
      searchUpdate: () => ({ total: 0, current: 0 }),
      searchNext: () => ({ total: 0, current: 0 }),
      searchPrev: () => ({ total: 0, current: 0 }),
      searchReplace: () => ({ total: 0, current: 0 }),
      searchReplaceAll: () => ({ total: 0, current: 0 }),
      searchClear: () => {},
      getSelectedText: () => ''
    })
    return () => null
  }
}`
}

const result = await build({
  configFile: false,
  envDir: false,
  publicDir: false,
  logLevel: 'silent',
  plugins: [{
    name: 'split-editor-test',
    enforce: 'pre',
    resolveId(id, importer) {
      if (samePath(id, entry)) return entry
      if (id === 'vue') return { id: import.meta.resolve('vue'), external: true }
      if (importer === entry) return `\0split-stub:${id}`
    },
    load(id) {
      if (samePath(id, entry)) return script.content
      if (!id.startsWith('\0split-stub:')) return
      const source = id.slice('\0split-stub:'.length)
      if (source === './tiptap/TiptapEditor.vue') return paneStubCode('wysiwyg')
      if (source === './source/SourceEditor.vue') return paneStubCode('source')
      if (source === '../workbench/Resizer.vue') {
        return `export default { name: 'resizer-stub', emits: ['resize', 'resize-end'], setup: () => () => null }`
      }
      if (source === '@/composables/useScrollSync') {
        return `
export function createScrollSync(first, second) {
  const record = { first, second, destroyed: false }
  globalThis.__splitTest.scrollSyncs.push(record)
  return { destroy: () => { record.destroyed = true } }
}`
      }
      return 'export default {}'
    }
  }],
  build: { ssr: entry, write: false, minify: false, target: 'node24' }
})
assert.ok(!Array.isArray(result) && 'output' in result)
const chunks = result.output.filter((item) => item.type === 'chunk')
assert.equal(chunks.length, 1, '测试入口必须完整打包，不能遗留相对 chunk 引用')
const { default: SplitEditor } = await import(`data:text/javascript;base64,${Buffer.from(chunks[0].code).toString('base64')}`)

const settle = () => new Promise((resolve) => setImmediate(resolve))

function fixture(t, savedSelection) {
  const panes = {
    wysiwyg: {
      selection: { mode: 'wysiwyg', anchor: 1, head: 2 }, readyPromise: Promise.resolve(true),
      scrollEl: { pane: 'wysiwyg' }, applied: [], flushed: 0, flushResult: 'wys-md',
      focused: 0, jumped: null, manualOutline: 0, emit: null
    },
    source: {
      selection: { mode: 'source', anchor: 3, head: 4 }, readyPromise: Promise.resolve(true),
      scrollEl: { pane: 'source' }, applied: [], flushed: 0, flushResult: 'src-md',
      focused: 0, jumped: null, manualOutline: 0, emit: null
    }
  }
  const scrollSyncs = []
  globalThis.__splitTest = { panes, scrollSyncs }
  const tab = reactive({
    id: 'tab-1', markdown: '# a', mode: 'split', loading: false, dirty: false,
    reloadToken: 0, ...(savedSelection ? { selection: savedSelection } : {})
  })
  const updates = []
  const outlines = []
  const node = (tag) => ({
    tag, parent: null, children: [], clientWidth: 800,
    get isConnected() { return true }
  })
  const renderer = createRenderer({
    createElement: node, createText: node, createComment: node,
    setText() {}, setElementText() {}, patchProp() {},
    parentNode: (target) => target.parent,
    nextSibling: (target) => {
      const siblings = target.parent?.children ?? []
      return siblings[siblings.indexOf(target) + 1] ?? null
    },
    insert(target, parent, anchor = null) {
      if (target.parent) target.parent.children.splice(target.parent.children.indexOf(target), 1)
      const index = anchor ? parent.children.indexOf(anchor) : -1
      parent.children.splice(index < 0 ? parent.children.length : index, 0, target)
      target.parent = parent
    },
    remove(target) {
      target.parent?.children.splice(target.parent.children.indexOf(target), 1)
      target.parent = null
    }
  })
  const app = renderer.createApp({
    ...SplitEditor,
    // 自定义宿主视图保留真实响应式状态、面板引用与生命周期，不渲染真实编辑器。
    render(_ctx, _cache, $props, state) {
      return h('split', { ref: (el) => { state.rootRef = el } }, [
        h('pane-wys', { ref: (el) => { state.wysPaneRef = el } }, [
          h(state.TiptapEditor, {
            key: 'wys',
            ref: (el) => { state.wysiwygRef = el },
            tab: $props.tab,
            locked: $props.locked,
            onUpdate: (md) => state.onEditorUpdate(md),
            onOutlineChange: (items, activeId) => state.onWysiwygOutline(items, activeId)
          })
        ]),
        h(state.Resizer, { key: 'resizer', onResize: (delta) => state.onPaneResize(delta) }),
        h('pane-src', { ref: (el) => { state.srcPaneRef = el } }, [
          h(state.SourceEditor, {
            key: 'src',
            ref: (el) => { state.sourceRef = el },
            tab: $props.tab,
            locked: $props.locked,
            onUpdate: (md) => state.onEditorUpdate(md),
            onOutlineChange: (items, activeId) => state.onSourceOutline(items, activeId)
          })
        ])
      ])
    }
  }, {
    tab,
    locked: false,
    onUpdate: (md) => updates.push(md),
    onOutlineChange: (items, activeId) => outlines.push([items, activeId])
  })
  app.config.warnHandler = (message) => assert.fail(`Vue 警告：${message}`)
  app.mount(node('root'))
  let mounted = true
  const unmount = () => { if (mounted) { app.unmount(); mounted = false } }
  t.after(() => {
    unmount()
    delete globalThis.__splitTest
  })
  return {
    panes, scrollSyncs, tab, updates, outlines, unmount,
    exposed: () => app._instance?.exposed ?? null
  }
}

test('任一侧写回的 markdown 同步转发到两个面板', async (t) => {
  const env = fixture(t)
  await nextTick()
  env.tab.markdown = '# changed'
  await nextTick()
  assert.deepEqual(env.panes.wysiwyg.applied, ['# changed'])
  assert.deepEqual(env.panes.source.applied, ['# changed'])
})

test('活动侧初始跟随已保存光标，实例接口只转发聚焦侧面板', async (t) => {
  const env = fixture(t, { mode: 'source', anchor: 5, head: 6 })
  await nextTick()
  const exposed = env.exposed()
  assert.ok(exposed)
  assert.deepEqual(exposed.getSelection(), { mode: 'source', anchor: 3, head: 4 })
  exposed.focus()
  assert.equal(env.panes.source.focused, 1)
  assert.equal(env.panes.wysiwyg.focused, 0)
  assert.equal(exposed.flush(), 'src-md')
  assert.equal(env.panes.source.flushed, 1)
  assert.equal(env.panes.wysiwyg.flushed, 1)
  exposed.jumpTo({ id: 'h-1', level: 2, text: 'x' })
  assert.deepEqual(env.panes.source.jumped, { id: 'h-1', level: 2, text: 'x' })
  assert.equal(env.panes.wysiwyg.jumped, null)
})

test('无已保存光标时默认富文本侧，update 与大纲只认聚焦侧', async (t) => {
  const env = fixture(t)
  await nextTick()
  const exposed = env.exposed()
  assert.deepEqual(exposed.getSelection(), { mode: 'wysiwyg', anchor: 1, head: 2 })
  env.panes.wysiwyg.emit('update', 'wys-content')
  env.panes.wysiwyg.emit('outline-change', [{ id: 'h-1', level: 1, text: 'a' }], 'h-1')
  env.panes.source.emit('outline-change', [{ id: 'l-1', level: 1, text: 'b' }], 'l-1')
  assert.deepEqual(env.updates, ['wys-content'])
  assert.deepEqual(env.outlines, [[[{ id: 'h-1', level: 1, text: 'a' }], 'h-1']])
})

test('whenReady 聚合两侧就绪状态', async (t) => {
  const env = fixture(t)
  await nextTick()
  assert.equal(await env.exposed().whenReady(), true)
  env.panes.source.readyPromise = Promise.resolve(false)
  const instance = env.exposed()
  assert.equal(await instance.whenReady(), false)
})

test('两侧就绪后按各自滚动容器建立联动，卸载时销毁', async (t) => {
  const env = fixture(t)
  await nextTick()
  await settle()
  assert.equal(env.scrollSyncs.length, 1)
  assert.equal(env.scrollSyncs[0].first, env.panes.wysiwyg.scrollEl)
  assert.equal(env.scrollSyncs[0].second, env.panes.source.scrollEl)
  env.unmount()
  assert.equal(env.scrollSyncs[0].destroyed, true)
})
