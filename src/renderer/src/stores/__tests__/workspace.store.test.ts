import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { TestContext } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import type { KmdeApi } from '../../../../preload'
import type { AppSettings, QuickOpenEntry, WorkspaceIndexChunk } from '@shared/types'
import { useSettingsStore } from '../settings.store'
import { useTabsStore } from '../tabs.store'
import { useWorkspaceStore, collectNonEmptyDirs } from '../workspace.store'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

function entry(path: string): QuickOpenEntry {
  const fileName = path.split('/').at(-1)!
  return { path, fileName, relPath: fileName }
}

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const saved: AppSettings[] = []
  const indexListeners = new Set<(chunk: WorkspaceIndexChunk) => void>()
  let indexGeneration = 0
  const api = {
    watchWorkspace: t.mock.fn(async (_root: string): Promise<boolean> => true),
    unwatchWorkspace: t.mock.fn(async (): Promise<boolean> => true),
    indexWorkspace: t.mock.fn(async (_root: string): Promise<number> => ++indexGeneration),
    cancelIndexWorkspace: t.mock.fn(async (): Promise<boolean> => true),
    onIndexChunk: t.mock.fn((callback: (chunk: WorkspaceIndexChunk) => void): (() => void) => {
      indexListeners.add(callback)
      return () => { indexListeners.delete(callback) }
    }),
    saveSettings: t.mock.fn(async (settings: AppSettings): Promise<boolean> => {
      saved.push({ ...settings })
      return true
    }),
    readFile: t.mock.fn(async () => ({ content: '磁盘内容', mtimeMs: 1 }))
  } satisfies Pick<
    KmdeApi,
    'watchWorkspace' | 'unwatchWorkspace' | 'indexWorkspace' | 'cancelIndexWorkspace' |
    'onIndexChunk' | 'saveSettings' | 'readFile'
  >
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const kmde = new Proxy(api, {
    get(target, key, receiver) {
      assert.ok(Reflect.has(target, key), `意外调用 kmde API：${String(key)}`)
      return Reflect.get(target, key, receiver)
    }
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, value: { kmde } })
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useWorkspaceStore(pinia)
  const settings = useSettingsStore(pinia)
  t.after(async () => {
    disposePinia(pinia)
    await nextTurn()
    t.mock.timers.reset()
    setActivePinia(undefined)
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  return {
    store, settings, api, saved, pinia,
    emitChunk(chunk: WorkspaceIndexChunk): void {
      for (const listener of [...indexListeners]) listener(chunk)
    },
    async advance(ms = 0) {
      await nextTick()
      t.mock.timers.tick(ms)
      await nextTurn()
      await nextTick()
    }
  }
}

// 使用真实 Pinia/Vue 和真实 action，仅模拟 IPC 与时钟；索引遍历在主进程完成，
// 渲染端契约变为：订阅分块 → 累积 → done 时一次性发布。
describe('工作区生命周期与后台索引', { concurrency: false, timeout: 5000 }, () => {
  test('collectNonEmptyDirs 标记含文件的所有祖先目录，根级文件不产生目录', () => {
    const dirs = collectNonEmptyDirs('C:\\A', [
      { path: 'C:/A/root.md', fileName: 'root.md', relPath: 'root.md' },
      { path: 'C:/A/b/c/d.md', fileName: 'd.md', relPath: 'b/c/d.md' },
      { path: 'C:/A/b/e.md', fileName: 'e.md', relPath: 'b/e.md' }
    ])
    assert.deepEqual([...dirs].sort(), ['C:/A/b', 'C:/A/b/c'])
    assert.deepEqual([...collectNonEmptyDirs('C:/A', [])], [])
  })

  test('打开不等待索引完成；分块累积，done 后一次性发布', async (t) => {
    const env = fixture(t)
    const opening = env.store.openFolder('C:/A')
    assert.equal(env.store.root, 'C:/A')
    assert.equal(env.store.rootName, 'A')
    assert.equal(env.store.indexing, true)
    assert.equal(env.api.indexWorkspace.mock.callCount(), 1, '打开过程中即发起主进程扫描')
    await opening
    assert.equal(env.store.indexing, true, '打开完成不依赖索引完成')
    env.emitChunk({ generation: 1, entries: [entry('C:/A/a.md'), entry('C:/A/b.md')], done: false })
    assert.equal(env.store.indexing, true)
    assert.equal(env.store.fileIndex.length, 0, '完成前不发布部分结果')
    env.emitChunk({ generation: 1, entries: [entry('C:/A/c.md')], done: true })
    assert.equal(env.store.indexing, false)
    assert.equal(env.store.fileIndex.length, 3)
    assert.equal(env.store.fileIndex[2].relPath, 'c.md')
  })

  test('切换目录取消旧索引，迟到分块不能回填', async (t) => {
    const env = fixture(t)
    await env.store.openFolder('C:/A')
    await env.store.openFolder('C:/B')
    assert.equal(env.api.cancelIndexWorkspace.mock.callCount(), 1)
    env.emitChunk({ generation: 1, entries: [entry('C:/A/old.md')], done: true })
    assert.deepEqual(env.store.fileIndex, [])
    assert.equal(env.store.indexing, true)
    env.emitChunk({ generation: 2, entries: [entry('C:/B/new.md')], done: true })
    assert.equal(env.store.fileIndex[0].fileName, 'new.md')
    assert.equal(env.store.indexing, false)
  })

  test('同 root 重建后旧 done 不能清除新 indexing', async (t) => {
    const env = fixture(t)
    await env.store.openFolder('C:/A')
    await env.store.rebuildFileIndex()
    assert.equal(env.api.cancelIndexWorkspace.mock.callCount(), 1)
    env.emitChunk({ generation: 1, entries: [entry('C:/A/old.md')], done: true })
    assert.equal(env.store.indexing, true)
    assert.deepEqual(env.store.fileIndex, [])
    env.emitChunk({ generation: 2, entries: [entry('C:/A/fresh.md')], done: true })
    assert.equal(env.store.indexing, false)
    assert.equal(env.store.fileIndex[0].fileName, 'fresh.md')
  })

  test('索引启动失败时收尾，indexing 不悬挂', async (t) => {
    const env = fixture(t)
    t.mock.method(env.api, 'indexWorkspace', async () => { throw new Error('扫描启动失败') })
    await env.store.openFolder('C:/A')
    await nextTurn()
    assert.equal(env.store.indexing, false)
    assert.deepEqual(env.store.fileIndex, [])
  })

  test('关闭立即清工作区、取消索引与防抖，保留文件标签和未保存草稿', async (t) => {
    const env = fixture(t)
    const tabs = useTabsStore(env.pinia)
    await tabs.openPath('C:/A/open.md')
    const draft = tabs.newUntitled()!
    tabs.updateTabContent(draft.id, '不能丢失的修改')
    const before = tabs.sessionSnapshot()
    await env.store.openFolder('C:/A')
    env.store.fileIndex = [entry('C:/A/open.md')]
    env.store.scheduleTreeRefresh()
    const stopping = deferred<boolean>()
    t.mock.method(env.api, 'unwatchWorkspace', () => stopping.promise)
    const closing = env.store.closeFolder()
    assert.equal(env.store.root, null)
    assert.equal(env.store.rootName, '')
    assert.equal(env.store.isOpen, false)
    assert.equal(env.store.indexing, false)
    assert.deepEqual(env.store.fileIndex, [])
    assert.equal(env.settings.lastWorkspace, null)
    const version = env.store.treeVersion
    const starts = env.api.indexWorkspace.mock.callCount()
    await env.advance(1000)
    assert.equal(env.store.treeVersion, version)
    assert.equal(env.api.indexWorkspace.mock.callCount(), starts)
    assert.deepEqual(tabs.sessionSnapshot(), before)
    stopping.resolve(true)
    await closing
    assert.equal(env.saved.at(-1)!.lastWorkspace, null)
  })

  test('关闭后迟到的索引分块不能复活状态', async (t) => {
    const env = fixture(t)
    await env.store.openFolder('C:/A')
    await env.store.closeFolder()
    env.emitChunk({ generation: 1, entries: [entry('C:/A/late.md')], done: true })
    await env.advance(1000)
    assert.deepEqual(env.store.fileIndex, [])
    assert.equal(env.store.indexing, false)
    await env.store.openFolder('C:/B')
    const starts = env.api.indexWorkspace.mock.callCount()
    await env.store.closeFolder()
    await env.advance(1000)
    assert.equal(env.api.indexWorkspace.mock.callCount(), starts)
  })

  test('watch 和 unwatch 迟到成功或失败不能覆盖新 root 或报告过期错误', async (t) => {
    const env = fixture(t)
    const oldWatch = deferred<boolean>()
    const oldStop = deferred<boolean>()
    t.mock.method(env.api, 'watchWorkspace', (root: string) => root === 'C:/A' ? oldWatch.promise : Promise.resolve(true))
    t.mock.method(env.api, 'unwatchWorkspace', () => oldStop.promise)
    const opening = env.store.openFolder('C:/A')
    const closing = env.store.closeFolder()
    await env.store.openFolder('C:/B')
    oldWatch.reject(new Error('迟到 watch 错误'))
    oldStop.resolve(true)
    await Promise.all([opening, closing])
    assert.equal(env.store.root, 'C:/B')
    assert.equal(env.settings.lastWorkspace, 'C:/B')
    assert.deepEqual(env.saved.map((item) => item.lastWorkspace), ['C:/A', null, 'C:/B'])
  })

  test('打开及关闭都等待设置持久化，而非仅等待监听响应', async (t) => {
    const env = fixture(t)
    for (const root of ['C:/A', null]) {
      const saving = deferred<boolean>()
      t.mock.method(env.api, 'saveSettings', () => saving.promise)
      let finished = false
      const operation = (root === null ? env.store.closeFolder() : env.store.openFolder(root))
        .then(() => { finished = true })
      try {
        await nextTurn()
        assert.equal(finished, false, '父层 settings.persist 必须返回实际落盘 Promise')
      } finally {
        saving.resolve(true)
        await operation
      }
      assert.equal(finished, true)
    }
  })

  test('目录事件对 treeVersion 和索引使用同一个 400ms 防抖窗口', async (t) => {
    const env = fixture(t)
    await env.store.openFolder('C:/A')
    const version = env.store.treeVersion
    const starts = env.api.indexWorkspace.mock.callCount()
    for (let i = 0; i < 20; i++) env.store.scheduleTreeRefresh()
    await env.advance(300)
    env.store.scheduleTreeRefresh()
    await env.advance(399)
    assert.equal(env.store.treeVersion, version)
    assert.equal(env.api.indexWorkspace.mock.callCount(), starts)
    await env.advance(1)
    assert.equal(env.store.treeVersion, version + 1)
    await env.advance()
    assert.equal(env.api.indexWorkspace.mock.callCount(), starts + 1)
  })

  test('dispose 取消进行中的索引与残留防抖定时器', async (t) => {
    const env = fixture(t)
    await env.store.openFolder('C:/A')
    // 先挂上防抖定时器（同时取消进行中的索引），dispose 必须把它一并清掉。
    env.store.scheduleTreeRefresh()
    assert.equal(env.api.cancelIndexWorkspace.mock.callCount(), 1)
    const version = env.store.treeVersion
    const count = env.api.indexWorkspace.mock.callCount()
    env.store.$dispose()
    await env.advance(1000)
    assert.equal(env.store.treeVersion, version)
    assert.equal(env.api.indexWorkspace.mock.callCount(), count)
    env.emitChunk({ generation: 1, entries: [entry('C:/A/late.md')], done: true })
    assert.deepEqual(env.store.fileIndex, [])
    assert.equal(env.store.indexing, false)
  })
})
