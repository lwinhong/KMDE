import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { TestContext } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createRenderer, h, inject, isProxy, nextTick, provide, shallowRef } from 'vue'
import type { FileNode } from '@shared/types'
import type { TreeController } from '../components/sidebar/FileTreeNode.vue'
import { useFileTree } from './useFileTree'

type HostNode = { parent: HostNode | null; children: HostNode[]; text: string }
const hostNode = (text = ''): HostNode => ({ parent: null, children: [], text })
const renderer = createRenderer<HostNode, HostNode>({
  createElement: hostNode, createText: hostNode, createComment: hostNode,
  setText: (target, text) => { target.text = text },
  setElementText: (target, text) => { target.text = text },
  parentNode: (target) => target.parent,
  nextSibling: (target) => {
    const siblings = target.parent?.children ?? []
    return siblings[siblings.indexOf(target) + 1] ?? null
  },
  insert(target, parent, anchor = null) {
    if (target.parent) {
      const previous = target.parent.children
      previous.splice(previous.indexOf(target), 1)
    }
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, target)
    target.parent = parent
  },
  remove(target) {
    if (target.parent) {
      const siblings = target.parent.children
      siblings.splice(siblings.indexOf(target), 1)
      target.parent = null
    }
  },
  patchProp() {}
})

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

const file = (path: string, isDir = false): FileNode => ({
  path, name: path.split('/').at(-1)!, isDir, ext: isDir ? '' : '.md'
})

function fixture(t: TestContext, initialRoot: string | null = null) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const root = shallowRef(initialRoot)
  const version = shallowRef(0)
  const onError = t.mock.fn((_error: unknown, _path: string) => {})
  const api = { listDir: t.mock.fn(async (_path: string): Promise<FileNode[]> => []) }
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { kmde: api } })
  let tree!: ReturnType<typeof useFileTree>
  let injected!: TreeController
  const child = {
    setup() {
      injected = inject<TreeController>('fileTreeController')!
      return () => h('entries', tree.visibleRootChildren.value.map((node) => h('entry', { key: node.path }, node.name)))
    }
  }
  const app = renderer.createApp({
    setup() {
      tree = useFileTree(() => root.value, () => version.value, onError)
      provide('fileTreeController', tree.controller)
      return () => h(child)
    }
  })
  app.config.warnHandler = (message) => assert.fail(`Vue 警告：${message}`)
  const host = hostNode('root')
  app.mount(host)
  let mounted = true
  const unmount = () => { if (mounted) { app.unmount(); mounted = false } }
  t.after(async () => {
    unmount()
    await nextTurn()
    t.mock.timers.reset()
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  return {
    tree, root, version, api, onError, injected, host, unmount,
    async flush() { await nextTick(); await nextTurn(); await nextTick() },
    async advance(ms = 0) {
      await nextTick()
      t.mock.timers.tick(ms)
      await nextTurn()
      await nextTick()
    }
  }
}

// 保留真实 Vue setup/watch/provide/unmount，仅替换宿主平台与目录 IPC。
describe('目录缓存、分页与失效保护', { concurrency: false, timeout: 5000 }, () => {
  test('getter 跟随 root/version，切根同轮更新只读取一次，保留节点注入契约', async (t) => {
    const env = fixture(t)
    assert.equal(env.api.listDir.mock.callCount(), 0)
    assert.equal(env.injected, env.tree.controller)
    assert.ok(env.injected.expandedDirs instanceof Set)
    assert.ok(env.injected.loadingDirs instanceof Set)
    assert.ok(env.injected.childrenCache instanceof Map)
    env.root.value = 'C:/A'
    env.version.value++
    assert.equal(env.tree.rootLoading.value, true)
    await env.flush()
    assert.deepEqual(env.api.listDir.mock.calls.map((call) => call.arguments), [['C:/A']])
    assert.equal(env.tree.rootLoading.value, false)
    env.version.value++
    env.version.value++
    await env.flush()
    assert.equal(env.api.listDir.mock.callCount(), 2)
  })

  test('切根后旧成功/失败不回填，不清新 rootLoading，不报告过期错误', async (t) => {
    const env = fixture(t)
    const reads = [deferred<FileNode[]>(), deferred<FileNode[]>(), deferred<FileNode[]>()]
    let count = 0
    t.mock.method(env.api, 'listDir', () => reads[count++].promise)
    for (const root of ['C:/A', 'C:/B', 'C:/C']) {
      env.root.value = root
      await nextTick()
    }
    reads[0].resolve([file('C:/A/old.md')])
    reads[1].reject(new Error('旧目录已删除'))
    await env.flush()
    assert.equal(env.tree.rootLoading.value, true)
    assert.deepEqual(env.tree.rootChildren.value, [])
    assert.equal(env.onError.mock.callCount(), 0)
    reads[2].resolve([file('C:/C/new.md')])
    await env.flush()
    assert.equal(env.tree.rootChildren.value[0].name, 'new.md')
    assert.equal(env.tree.rootLoading.value, false)
  })

  test('同一 tick 内 A-B-A 仍使旧请求失效，并读取最后一个 A', async (t) => {
    const env = fixture(t)
    const old = deferred<FileNode[]>()
    const fresh = deferred<FileNode[]>()
    let count = 0
    t.mock.method(env.api, 'listDir', () => count++ === 0 ? old.promise : fresh.promise)
    env.root.value = 'C:/A'
    await nextTick()
    env.root.value = 'C:/B'
    env.root.value = 'C:/A'
    old.resolve([file('C:/A/old.md')])
    await env.flush()
    assert.equal(count, 2)
    assert.equal(env.tree.rootLoading.value, true)
    assert.deepEqual(env.tree.rootChildren.value, [])
    fresh.resolve([file('C:/A/fresh.md')])
    await env.flush()
    assert.equal(env.tree.rootChildren.value[0].name, 'fresh.md')
  })

  test('同 root 手动刷新请求乱序，旧 finally 不影响新 loading', async (t) => {
    const env = fixture(t, 'C:/A')
    await env.flush()
    const old = deferred<FileNode[]>()
    const fresh = deferred<FileNode[]>()
    let count = 0
    t.mock.method(env.api, 'listDir', () => count++ === 0 ? old.promise : fresh.promise)
    const first = env.tree.refreshRoot()
    const second = env.tree.refreshRoot()
    old.resolve([file('C:/A/old.md')])
    await first
    assert.equal(env.tree.rootLoading.value, true)
    fresh.resolve([file('C:/A/fresh.md')])
    await second
    assert.equal(env.tree.rootLoading.value, false)
    assert.equal(env.tree.rootChildren.value[0].name, 'fresh.md')
  })

  test('反复折叠展开共享在途请求和缓存，不重复读取', async (t) => {
    const env = fixture(t, 'C:/A')
    await env.flush()
    const dir = file('C:/A/dir', true)
    const read = deferred<FileNode[]>()
    t.mock.method(env.api, 'listDir', () => read.promise)
    const first = env.injected.toggleNode(dir)
    await env.injected.toggleNode(dir)
    const second = env.injected.toggleNode(dir)
    assert.equal(env.api.listDir.mock.callCount(), 1)
    assert.equal(env.injected.loadingDirs.has(dir.path), true)
    read.resolve([file('C:/A/dir/child.md')])
    await Promise.all([first, second])
    assert.equal(env.injected.loadingDirs.has(dir.path), false)
    assert.equal(env.injected.childrenCache.get(dir.path)![0].name, 'child.md')
    await env.injected.toggleNode(dir)
    await env.injected.toggleNode(dir)
    assert.equal(env.api.listDir.mock.callCount(), 1)
  })

  test('version 刷新后旧子目录请求不清新 loading，也不覆盖缓存', async (t) => {
    const env = fixture(t, 'C:/A')
    await env.flush()
    const dir = file('C:/A/dir', true)
    const old = deferred<FileNode[]>()
    const fresh = deferred<FileNode[]>()
    let count = 0
    t.mock.method(env.api, 'listDir', (path: string) => path === 'C:/A'
      ? Promise.resolve([dir]) : count++ === 0 ? old.promise : fresh.promise)
    const first = env.injected.toggleNode(dir)
    env.version.value++
    await env.flush()
    await env.advance()
    assert.equal(count, 2)
    old.resolve([file('C:/A/dir/old.md')])
    await first
    assert.equal(env.injected.loadingDirs.has(dir.path), true)
    assert.equal(env.injected.childrenCache.has(dir.path), false)
    fresh.resolve([file('C:/A/dir/new.md')])
    await env.flush()
    assert.equal(env.injected.loadingDirs.has(dir.path), false)
    assert.equal(env.injected.childrenCache.get(dir.path)![0].name, 'new.md')
  })

  test('当前根目录及子目录错误回调带路径，清 loading 且允许重试', async (t) => {
    const env = fixture(t)
    const error = new Error('读取失败')
    t.mock.method(env.api, 'listDir', async () => { throw error })
    env.root.value = 'C:/A'
    await env.flush()
    assert.deepEqual(env.onError.mock.calls[0].arguments, [error, 'C:/A'])
    assert.equal(env.tree.rootLoading.value, false)
    const dir = file('C:/A/dir', true)
    await env.injected.toggleNode(dir)
    assert.deepEqual(env.onError.mock.calls[1].arguments, [error, dir.path])
    assert.equal(env.injected.loadingDirs.size, 0)
    assert.equal(env.injected.expandedDirs.size, 0)
    t.mock.method(env.api, 'listDir', async () => [])
    await env.injected.toggleNode(dir)
    assert.equal(env.injected.childrenCache.has(dir.path), true)
  })

  test('根及子目录每页 200 项，加载更多无 IPC，不深代理巨大列表', async (t) => {
    const env = fixture(t)
    const rootNodes = Array.from({ length: 10000 }, (_, i) => file(`C:/A/${i}.md`))
    const childNodes = Array.from({ length: 450 }, (_, i) => file(`C:/A/dir/${i}.md`))
    t.mock.method(env.api, 'listDir', async (path: string) => path === 'C:/A' ? rootNodes : childNodes)
    env.root.value = 'C:/A'
    await env.flush()
    assert.equal(env.host.children[0].children.length, 200)
    assert.equal(env.tree.rootChildren.value.length, 10000)
    assert.equal(isProxy(env.tree.rootChildren.value), false)
    assert.equal(env.tree.hasMoreRoot.value, true)
    env.tree.loadMore()
    await nextTick()
    assert.equal(env.host.children[0].children.length, 400)
    const dir = file('C:/A/dir', true)
    await env.injected.toggleNode(dir)
    assert.equal(env.injected.childrenCache.get(dir.path)!.length, 200)
    assert.equal(isProxy(env.injected.childrenCache.get(dir.path)), false)
    assert.deepEqual(env.tree.moreDirectories.value, [{ path: dir.path, remaining: 250 }])
    env.tree.loadMore(dir.path)
    assert.equal(env.injected.childrenCache.get(dir.path)!.length, 400)
    env.tree.loadMore(dir.path)
    assert.equal(env.injected.childrenCache.get(dir.path)!.length, 450)
    assert.deepEqual(env.tree.moreDirectories.value, [])
    assert.equal(env.api.listDir.mock.callCount(), 2)
    env.root.value = 'C:/B'
    await env.flush()
    assert.equal(env.tree.visibleRootChildren.value.length, 200)
    assert.equal(env.injected.expandedDirs.size, 0)
    assert.equal(env.injected.childrenCache.size, 0)
  })

  test('已展开目录刷新每批至多 4 个并让出 UI，根 loading 不等待子目录', async (t) => {
    const env = fixture(t, 'C:/A')
    await env.flush()
    const reads: Array<ReturnType<typeof deferred<FileNode[]>>> = []
    for (let i = 0; i < 5; i++) env.injected.expandedDirs.add(`C:/A/d${i}`)
    t.mock.method(env.api, 'listDir', (path: string) => {
      if (path === 'C:/A') return Promise.resolve([])
      const read = deferred<FileNode[]>()
      reads.push(read)
      return read.promise
    })
    const refreshing = env.tree.refreshRoot()
    await env.flush()
    assert.equal(env.tree.rootLoading.value, false)
    assert.equal(reads.length, 0)
    await env.advance()
    assert.equal(reads.length, 4)
    for (const read of reads) read.resolve([])
    await env.flush()
    assert.equal(reads.length, 4)
    await env.advance()
    assert.equal(reads.length, 5)
    reads[4].resolve([])
    await refreshing
    assert.equal(env.injected.childrenCache.size, 5)
  })

  test('关闭根及卸载立即清状态，迟到子目录与后续 getter 更新都不回填', async (t) => {
    const env = fixture(t, 'C:/A')
    await env.flush()
    const read = deferred<FileNode[]>()
    t.mock.method(env.api, 'listDir', () => read.promise)
    const expanding = env.injected.toggleNode(file('C:/A/dir', true))
    env.root.value = null
    assert.equal(env.tree.rootLoading.value, false)
    assert.equal(env.injected.loadingDirs.size, 0)
    assert.equal(env.injected.expandedDirs.size, 0)
    read.resolve([file('C:/A/dir/old.md')])
    await expanding
    await env.flush()
    assert.equal(env.injected.childrenCache.size, 0)
    assert.deepEqual(env.tree.rootChildren.value, [])
    env.unmount()
    const calls = env.api.listDir.mock.callCount()
    env.root.value = 'C:/B'
    env.version.value++
    await env.advance(1000)
    assert.equal(env.api.listDir.mock.callCount(), calls)
    await env.tree.refreshRoot()
    await env.injected.toggleNode(file('C:/B/dir', true))
    assert.equal(env.api.listDir.mock.callCount(), calls)
  })

  test('卸载清除展开目录刷新 yield，旧根请求成功也不能继续派生读取', async (t) => {
    const env = fixture(t, 'C:/A')
    await env.flush()
    env.injected.expandedDirs.add('C:/A/dir')
    const refreshing = env.tree.refreshRoot()
    await env.flush()
    const calls = env.api.listDir.mock.callCount()
    env.unmount()
    await refreshing
    await env.advance(1000)
    assert.equal(env.api.listDir.mock.callCount(), calls)
    assert.equal(env.tree.rootLoading.value, false)
  })
})
