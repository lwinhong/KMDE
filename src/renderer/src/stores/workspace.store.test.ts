import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import type { TestContext } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import type { KmdeApi } from '../../../preload'
import type { AppSettings, FileNode } from '@shared/types'
import { useSettingsStore } from './settings.store'
import { useTabsStore } from './tabs.store'
import { useWorkspaceStore } from './workspace.store'

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}

function file(path: string, isDir = false): FileNode {
  return { path, name: path.split('/').at(-1)!, isDir, ext: isDir ? '' : '.md' }
}

function fixture(t: TestContext) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const saved: AppSettings[] = []
  const api = {
    listDir: t.mock.fn(async (_path: string): Promise<FileNode[]> => []),
    watchWorkspace: t.mock.fn(async (_root: string): Promise<boolean> => true),
    unwatchWorkspace: t.mock.fn(async (): Promise<boolean> => true),
    saveSettings: t.mock.fn(async (settings: AppSettings): Promise<boolean> => {
      saved.push({ ...settings })
      return true
    }),
    readFile: t.mock.fn(async () => ({ content: '磁盘内容', mtimeMs: 1 }))
  } satisfies Pick<KmdeApi, 'listDir' | 'watchWorkspace' | 'unwatchWorkspace' | 'saveSettings' | 'readFile'>
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
    async advance(ms = 0) {
      await nextTick()
      t.mock.timers.tick(ms)
      await nextTurn()
      await nextTick()
    }
  }
}

// 使用真实 Pinia/Vue 和真实 action，仅模拟 IPC 与时钟；由 renderer runner 内存转译。
describe('工作区生命周期与后台索引', { concurrency: false, timeout: 5000 }, () => {
  test('打开不等待扫描，首轮及每 200 项主动让出 UI', async (t) => {
    const env = fixture(t)
    const reading = deferred<FileNode[]>()
    t.mock.method(env.api, 'listDir', () => reading.promise)
    await env.store.openFolder('C:/A')
    assert.equal(env.store.root, 'C:/A')
    assert.equal(env.store.rootName, 'A')
    assert.equal(env.store.indexing, true)
    assert.equal(env.api.listDir.mock.callCount(), 0, '打开操作先完成，扫描在下一轮启动')
    await env.advance()
    reading.resolve(Array.from({ length: 450 }, (_, i) => file(`C:/A/${i}.md`)))
    await nextTurn()
    assert.equal(env.store.indexing, true)
    assert.equal(env.store.fileIndex.length, 0)
    await env.advance()
    assert.equal(env.store.indexing, true, '400 项后仍应让出一次 UI')
    await env.advance()
    assert.equal(env.store.indexing, false)
    assert.equal(env.store.fileIndex.length, 450)
    assert.equal(env.store.fileIndex[449].relPath, '449.md')
  })

  test('递归读取并发为 4，切换时旧请求仍占配额且不再派生扫描', async (t) => {
    const env = fixture(t)
    const pending: Array<ReturnType<typeof deferred<FileNode[]>>> = []
    let active = 0
    let peak = 0
    t.mock.method(env.api, 'listDir', async (path: string) => {
      if (path === 'C:/A') return Array.from({ length: 12 }, (_, i) => file(`C:/A/d${i}`, true))
      peak = Math.max(peak, ++active)
      const read = deferred<FileNode[]>()
      pending.push(read)
      try { return await read.promise } finally { active-- }
    })
    await env.store.openFolder('C:/A')
    await env.advance()
    await env.advance()
    assert.equal(active, 4)
    await env.store.openFolder('C:/B')
    await env.advance()
    assert.equal(active, 4)
    assert.equal(pending.length, 4)
    pending[0].resolve([file('C:/A/old', true)])
    await nextTurn()
    assert.equal(pending.length, 5)
    assert.equal(active, 4)
    for (const read of pending) read.resolve([])
    await nextTurn()
    assert.equal(peak, 4)
    assert.equal(env.store.root, 'C:/B')
    assert.equal(env.store.indexing, false)
    assert.deepEqual(env.store.fileIndex, [])
    assert.ok(env.api.listDir.mock.calls.every(({ arguments: args }) => args[0] !== 'C:/A/old'))
  })

  test('A-B-A 使用请求代次而非路径比较，迟到结果不能回填', async (t) => {
    const env = fixture(t)
    const reads = Array.from({ length: 3 }, () => deferred<FileNode[]>())
    let count = 0
    t.mock.method(env.api, 'listDir', () => reads[count++].promise)
    for (const root of ['C:/A', 'C:/B', 'C:/A']) {
      await env.store.openFolder(root)
      await env.advance()
    }
    reads[2].resolve([file('C:/A/new.md')])
    await nextTurn()
    assert.equal(env.store.fileIndex[0].fileName, 'new.md')
    reads[0].resolve([file('C:/A/old.md')])
    reads[1].resolve([file('C:/B/old.md')])
    await nextTurn()
    assert.equal(env.store.root, 'C:/A')
    assert.equal(env.store.fileIndex[0].fileName, 'new.md')
    assert.equal(env.store.indexing, false)
  })

  test('同 root 重建后旧 finally 不清除新 indexing', async (t) => {
    const env = fixture(t)
    const old = deferred<FileNode[]>()
    const fresh = deferred<FileNode[]>()
    let count = 0
    t.mock.method(env.api, 'listDir', () => count++ === 0 ? old.promise : fresh.promise)
    await env.store.openFolder('C:/A')
    await env.advance()
    const rebuilding = env.store.rebuildFileIndex()
    await env.advance()
    old.resolve([file('C:/A/old.md')])
    await nextTurn()
    assert.equal(env.store.indexing, true)
    assert.deepEqual(env.store.fileIndex, [])
    fresh.resolve([file('C:/A/fresh.md')])
    await rebuilding
    assert.equal(env.store.indexing, false)
    assert.equal(env.store.fileIndex[0].fileName, 'fresh.md')
  })

  test('关闭立即清工作区、取消防抖，保留文件标签和未保存草稿', async (t) => {
    const env = fixture(t)
    const tabs = useTabsStore(env.pinia)
    await tabs.openPath('C:/A/open.md')
    const draft = tabs.newUntitled()!
    tabs.updateTabContent(draft.id, '不能丢失的修改')
    const before = tabs.sessionSnapshot()
    await env.store.openFolder('C:/A')
    await env.advance()
    env.store.fileIndex = [{ path: 'C:/A/open.md', fileName: 'open.md', relPath: 'open.md' }]
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
    const reads = env.api.listDir.mock.callCount()
    await env.advance(1000)
    assert.equal(env.store.treeVersion, version)
    assert.equal(env.api.listDir.mock.callCount(), reads)
    assert.deepEqual(tabs.sessionSnapshot(), before)
    stopping.resolve(true)
    await closing
    assert.equal(env.saved.at(-1)!.lastWorkspace, null)
  })

  test('关闭取消批次 yield；未返回的旧目录请求不能复活索引', async (t) => {
    const env = fixture(t)
    const read = deferred<FileNode[]>()
    t.mock.method(env.api, 'listDir', () => read.promise)
    await env.store.openFolder('C:/A')
    await env.advance()
    await env.store.closeFolder()
    read.resolve([file('C:/A/late.md'), file('C:/A/late', true)])
    await env.advance(1000)
    assert.deepEqual(env.store.fileIndex, [])
    assert.equal(env.store.indexing, false)
    assert.equal(env.api.listDir.mock.callCount(), 1)
    await env.store.openFolder('C:/B')
    const reads = env.api.listDir.mock.callCount()
    await env.store.closeFolder()
    await env.advance(1000)
    assert.equal(env.api.listDir.mock.callCount(), reads)
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
    await env.advance()
    const version = env.store.treeVersion
    const reads = env.api.listDir.mock.callCount()
    for (let i = 0; i < 20; i++) env.store.scheduleTreeRefresh()
    await env.advance(300)
    env.store.scheduleTreeRefresh()
    await env.advance(399)
    assert.equal(env.store.treeVersion, version)
    assert.equal(env.api.listDir.mock.callCount(), reads)
    await env.advance(1)
    assert.equal(env.store.treeVersion, version + 1)
    await env.advance()
    assert.equal(env.api.listDir.mock.callCount(), reads + 1)
  })

  test('读取失败收尾且释放配额；dispose 取消残留定时器', async (t) => {
    const env = fixture(t)
    t.mock.method(env.api, 'listDir', async () => { throw new Error('目录不可读') })
    await env.store.openFolder('C:/A')
    await env.advance()
    assert.equal(env.store.indexing, false)
    assert.deepEqual(env.store.fileIndex, [])
    env.store.scheduleTreeRefresh()
    const version = env.store.treeVersion
    const count = env.api.listDir.mock.callCount()
    env.store.$dispose()
    await env.advance(1000)
    assert.equal(env.store.treeVersion, version)
    assert.equal(env.api.listDir.mock.callCount(), count)
  })
})
