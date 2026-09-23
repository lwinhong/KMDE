import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { createRenderer, h, nextTick } from 'vue'
import { compileScript, parse } from 'vue/compiler-sfc'
import { build } from 'vite'

// 用法：node scripts/test-toolbar-layout.mjs
// 在内存中加载真实 MenuBar setup；只替换按钮组件、宿主尺寸与浏览器调度 API。
const filename = new URL('../src/renderer/src/components/editor/tiptap/components/MenuBar.vue', import.meta.url)
const { descriptor } = parse(await readFile(filename, 'utf8'))
const script = compileScript(descriptor, { id: 'toolbar-layout-test' })
const entry = fileURLToPath(filename).replace(/\\/g, '/')
const result = await build({
  configFile: false,
  envDir: false,
  publicDir: false,
  logLevel: 'silent',
  plugins: [{
    name: 'toolbar-layout-test',
    enforce: 'pre',
    resolveId(id, importer) {
      if (id === entry) return id
      if (id === 'vue') return { id: import.meta.resolve('vue'), external: true }
      if (importer === entry) return `\0toolbar-stub:${id}`
    },
    load(id) {
      if (id === entry) return script.content
      if (!id.startsWith('\0toolbar-stub:')) return
      const source = id.slice('\0toolbar-stub:'.length)
      if (source.endsWith('.css')) return ''
      const names = Object.values(script.imports)
        .filter((item) => item.source === source && item.imported !== 'default')
        .map((item) => item.imported)
      return `export default {};\n${[...new Set(names)].map((name) =>
        `export const ${name} = ${name === 't' ? '(key) => key' : '{}'};`
      ).join('\n')}`
    }
  }],
  build: { ssr: entry, write: false, minify: false, target: 'node24' }
})
assert.ok(!Array.isArray(result) && 'output' in result)
const chunks = result.output.filter((item) => item.type === 'chunk')
assert.equal(chunks.length, 1)
const { default: MenuBar } = await import(`data:text/javascript;base64,${Buffer.from(chunks[0].code).toString('base64')}`)

function fixture(t, initialWidth = 600) {
  let width = initialWidth
  let itemWidth = 100
  let observer
  let disconnected = false
  const frames = new Map()
  let frameId = 0
  const globals = {
    requestAnimationFrame: (callback) => { frames.set(++frameId, callback); return frameId },
    cancelAnimationFrame: (id) => frames.delete(id),
    ResizeObserver: class {
      constructor(callback) { observer = callback }
      observe() {}
      disconnect() { disconnected = true }
    }
  }
  const originals = new Map(Object.keys(globals).map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
  for (const [key, value] of Object.entries(globals)) {
    Object.defineProperty(globalThis, key, { configurable: true, value })
  }
  const node = (tag) => ({
    tag, parent: null, children: [],
    get clientWidth() { return width },
    get offsetWidth() { return width > 0 ? itemWidth : 0 }
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
    ...MenuBar,
    // 自定义宿主视图保留真实响应式状态、模板引用和生命周期，不执行编辑命令。
    render(_ctx, _cache, _props, state) {
      return h('toolbar', { ref: (el) => { state.toolbarRef = el } }, [
        ...state.visibleItems.map((item) => h('visible', { key: item.key })),
        ...state.items.map((item, index) => h('measure', {
          key: `measure-${item.key}`, ref: (el) => state.setItemRef(el, index)
        }))
      ])
    }
  }, { editor: {}, useSourceMode: true })
  app.config.warnHandler = (message) => assert.fail(`Vue 警告：${message}`)
  const root = node('root')
  app.mount(root)
  let mounted = true
  const unmount = () => { if (mounted) { app.unmount(); mounted = false } }
  t.after(() => {
    unmount()
    for (const [key, original] of originals) {
      if (original) Object.defineProperty(globalThis, key, original)
      else Reflect.deleteProperty(globalThis, key)
    }
  })
  return {
    frames, unmount,
    get disconnected() { return disconnected },
    get visible() { return root.children[0].children.filter((child) => child.tag === 'visible') },
    resize(value) { width = value; observer([]) },
    setItemWidth(value) { itemWidth = value },
    async flushFrames() {
      const pending = [...frames.values()]
      frames.clear()
      for (const callback of pending) callback()
      await nextTick()
    }
  }
}

test('隐藏页签的零尺寸测量保留按钮数量与节点身份', async (t) => {
  const env = fixture(t)
  await nextTick()
  const before = env.visible
  assert.equal(before.length, 5)
  env.resize(0)
  await env.flushFrames()
  assert.equal(env.visible.length, 5)
  assert.ok(env.visible.every((node, index) => node === before[index]))
  env.resize(600)
  await nextTick()
  assert.ok(env.visible.every((node, index) => node === before[index]))
})

test('后台首次挂载的工具栏在显示当轮完成布局，不额外等待动画帧', async (t) => {
  const env = fixture(t, 0)
  await nextTick()
  env.resize(600)
  await nextTick()
  assert.equal(env.visible.length, 5)
  assert.equal(env.frames.size, 0)
})

test('后台期间宽度改变，激活当轮按新尺寸折叠及展开', async (t) => {
  const env = fixture(t, 1200)
  await nextTick()
  assert.equal(env.visible.length, 10)
  env.resize(0)
  await env.flushFrames()
  env.resize(300)
  await nextTick()
  assert.equal(env.visible.length, 2)
  env.resize(1200)
  await nextTick()
  assert.equal(env.visible.length, 10)
})

test('测量项未就绪不覆盖有效布局，极窄的非零宽度仍允许全部折叠', async (t) => {
  const env = fixture(t)
  await nextTick()
  env.setItemWidth(0)
  env.resize(600)
  await env.flushFrames()
  assert.equal(env.visible.length, 5)
  env.setItemWidth(100)
  env.resize(40)
  await nextTick()
  assert.equal(env.visible.length, 0)
})

test('卸载时释放尺寸监听且没有遗留动画帧', async (t) => {
  const env = fixture(t)
  await nextTick()
  env.resize(300)
  env.unmount()
  assert.equal(env.disconnected, true)
  assert.equal(env.frames.size, 0)
})
