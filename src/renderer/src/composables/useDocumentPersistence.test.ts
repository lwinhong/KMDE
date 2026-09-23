import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, test } from 'node:test'
import type { TestContext } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { createRenderer, h, nextTick, onMounted, onUnmounted } from 'vue'
import type { KmdeApi } from '../../../preload'
import type { EditorSession, ReadFileResult, SessionSaveOptions, SessionSaveResult, SessionTab } from '@shared/types'
import { i18n } from '../i18n'
import { useTabsStore } from '../stores/tabs.store'
import { useDocumentPersistence } from './useDocumentPersistence'

type SessionApi = Pick<KmdeApi, 'loadSession' | 'saveSession' | 'readFile' | 'writeFile' | 'saveAsDialog'>
type HostNode = { parent: HostNode | null; children: HostNode[]; text: string }
const node = (text = ''): HostNode => ({ parent: null, children: [], text })
const windowsKey = (path: string): string => path.replace(/\\/g, '/').toLowerCase()
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

// 仅替换宿主平台操作，保留真实 setup、依赖注入、watch 调度和卸载生命周期。
const renderer = createRenderer<HostNode, HostNode>({
  createElement: (name) => node(name),
  createText: node,
  createComment: node,
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

function savedTab(overrides: Partial<SessionTab> = {}): SessionTab {
  return {
    id: randomUUID(), path: null, fileName: '未命名-1.md', markdown: '草稿',
    dirty: true, mode: 'wysiwyg', savedMtimeMs: 0, deleted: false, ...overrides
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

async function fixture(t: TestContext, options: {
  session?: EditorSession | null
  files?: Record<string, ReadFileResult>
  restore?: boolean
} = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const commits: EditorSession[] = []
  const writes: Array<{ path: string; content: string }> = []
  const disk = new Map(Object.entries(options.files ?? {}).map(([path, file]) => [windowsKey(path), file]))
  let mtimeMs = 100
  const api = {
    loadSession: t.mock.fn(async () => clone(options.session ?? null)),
    saveSession: t.mock.fn(async (session: EditorSession, _options?: SessionSaveOptions): Promise<SessionSaveResult> => {
      commits.push(clone(session))
      return { cleanupPending: false }
    }),
    readFile: t.mock.fn(async (path: string): Promise<ReadFileResult> => {
      const file = disk.get(windowsKey(path))
      if (!file) throw Object.assign(new Error('模拟文件不存在'), { code: 'ENOENT' })
      return { ...file }
    }),
    writeFile: t.mock.fn(async (path: string, content: string) => {
      writes.push({ path, content })
      const file = { content, mtimeMs: ++mtimeMs }
      disk.set(windowsKey(path), file)
      return { mtimeMs: file.mtimeMs }
    }),
    saveAsDialog: t.mock.fn(async (_name: string): Promise<string | null> => null)
  } satisfies SessionApi
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
  const originalLocale = i18n.global.locale.value
  const kmde = new Proxy(api, {
    get(target, key, receiver) {
      assert.ok(Reflect.has(target, key), `不应调用未约定的 kmde API：${String(key)}`)
      return Reflect.get(target, key, receiver)
    }
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { kmde } })
  i18n.global.locale.value = 'zh-CN'
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = useTabsStore(pinia)
  const onSaveError = t.mock.fn(() => {})
  let mounted = false
  let persistence!: ReturnType<typeof useDocumentPersistence>
  const app = renderer.createApp({
    setup() {
      persistence = useDocumentPersistence(onSaveError)
      onMounted(() => { mounted = true })
      onUnmounted(() => { mounted = false })
      return () => h('session-test-host')
    }
  })
  app.use(pinia)
  app.config.warnHandler = (message) => assert.fail(`Vue 宿主警告：${message}`)
  function unmount() {
    if (mounted) app.unmount()
  }
  t.after(async () => {
    unmount()
    await store.waitForSaves()
    t.mock.timers.reset()
    disposePinia(pinia)
    setActivePinia(undefined)
    i18n.global.locale.value = originalLocale
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  app.mount(node('root'))
  assert.equal(mounted, true, 'composable 必须在真实组件挂载上下文中运行')
  if (options.restore !== false) await store.restoreSession()
  await nextTick()
  return {
    store, api, commits, writes, onSaveError, persistence, unmount,
    isMounted: () => mounted,
    async open(path: string, content = '磁盘原文') {
      disk.set(windowsKey(path), { content, mtimeMs: 10 })
      const opened = await store.openPath(path)
      assert.ok(opened)
      return store.tabs.find((tab) => tab.id === opened.id)!
    },
    async advance(ms: number) {
      // Vue 先安排定时任务，再推进虚拟时间，最后等待 IPC Promise 和响应式更新。
      await nextTick()
      t.mock.timers.tick(ms)
      await nextTurn()
      await nextTick()
    }
  }
}

describe('文档持久化宿主与生命周期契约', { concurrency: false, timeout: 5000 }, () => {
  test('恢复后不活动的 dirty 标签也自动保存，草稿不会弹出保存对话框', async (t) => {
    const path = 'C:\\笔记\\后台文件.md'
    const background = savedTab({ path, fileName: '后台文件.md', markdown: '后台待保存', savedMtimeMs: 10 })
    const active = savedTab({ mode: 'source' })
    const env = await fixture(t, {
      session: { version: 1, tabs: [background, active], activeTabId: active.id, untitledSeq: 7 },
      files: { [path]: { content: '旧磁盘内容', mtimeMs: 10 } }
    })
    assert.equal(env.store.activeTabId, active.id)
    await env.advance(799)
    assert.equal(env.writes.length, 0)
    await env.advance(1)
    assert.deepEqual(env.writes, [{ path, content: '后台待保存' }])
    assert.equal(env.store.tabs[0].dirty, false)
    assert.equal(env.store.tabs[1].dirty, true)
    assert.equal(env.store.activeTabId, active.id)
    assert.equal(env.api.saveAsDialog.mock.callCount(), 0)
    assert.equal(env.onSaveError.mock.callCount(), 0)
  })

  test('各标签独立防抖，活动标签连续输入不推迟后台文件自动保存', async (t) => {
    const env = await fixture(t)
    const first = await env.open('C:\\笔记\\后台.md')
    const second = await env.open('D:\\工作\\前台.md')
    env.store.updateTabContent(first.id, '后台修改')
    env.store.updateTabContent(second.id, '前台第一版')
    await env.advance(300)
    env.store.updateTabContent(second.id, '前台第二版')
    await env.advance(300)
    env.store.updateTabContent(second.id, '前台最终版')
    await env.advance(199)
    assert.equal(env.writes.length, 0)
    await env.advance(1)
    assert.deepEqual(env.writes, [{ path: first.path, content: '后台修改' }])
    assert.equal(first.dirty, false)
    assert.equal(second.dirty, true)
    await env.advance(599)
    assert.equal(env.writes.length, 1)
    await env.advance(1)
    assert.deepEqual(env.writes[1], { path: second.path, content: '前台最终版' })
    assert.equal(second.dirty, false)
  })

  test('持续输入时会话周期写入最新草稿，不能无限重置截止时间', async (t) => {
    const env = await fixture(t)
    const draft = env.store.newUntitled()!
    for (let revision = 1; revision <= 12; revision++) {
      env.store.updateTabContent(draft.id, `持续输入第 ${revision} 版`)
      await env.advance(100)
      assert.equal(env.commits.length, Math.floor(revision / 4))
      if (revision % 4 === 0) {
        assert.equal(env.commits.at(-1)!.tabs[0].markdown, `持续输入第 ${revision} 版`)
        assert.equal(env.commits.at(-1)!.tabs[0].id, draft.id)
      }
    }
    assert.equal(env.commits.length, 3)
    assert.equal(env.commits[0].tabs[0].markdown, '持续输入第 4 版')
    assert.equal(env.store.tabs[0].dirty, true)
    assert.equal(env.writes.length, 0)
    assert.equal(env.api.saveAsDialog.mock.callCount(), 0)
  })

  test('pause 清除会话和文件定时器，暂停期间不反写，resume 重新计时', async (t) => {
    const env = await fixture(t)
    const tab = await env.open('C:\\笔记\\暂停.md')
    env.store.updateTabContent(tab.id, '暂停前修改')
    await env.advance(100)
    const cleared = t.mock.method(globalThis, 'clearTimeout')
    env.persistence.pause()
    assert.ok(cleared.mock.callCount() >= 2, '暂停必须取消会话及文件两个定时器')
    await env.advance(2000)
    assert.equal(env.commits.length, 0)
    assert.equal(env.writes.length, 0)
    env.store.updateTabContent(tab.id, '暂停期间继续输入')
    await env.advance(1000)
    assert.equal(env.commits.length, 0)
    assert.equal(env.writes.length, 0)
    env.persistence.resume()
    await env.advance(399)
    assert.equal(env.commits.length, 0)
    await env.advance(1)
    assert.equal(env.commits[0].tabs[0].markdown, '暂停期间继续输入')
    assert.equal(env.writes.length, 0)
    await env.advance(399)
    assert.equal(env.writes.length, 0)
    await env.advance(1)
    assert.deepEqual(env.writes, [{ path: tab.path, content: '暂停期间继续输入' }])
  })

  test('卸载宿主清除定时器并停止 watch，后续状态变更不再触发写入', async (t) => {
    const env = await fixture(t)
    const tab = await env.open('C:\\笔记\\卸载.md')
    env.store.updateTabContent(tab.id, '卸载前输入')
    await nextTick()
    env.unmount()
    assert.equal(env.isMounted(), false)
    await env.advance(2000)
    assert.equal(env.commits.length, 0)
    assert.equal(env.writes.length, 0)
    env.store.updateTabContent(tab.id, '卸载后输入')
    await env.advance(2000)
    assert.equal(env.commits.length, 0)
    assert.equal(env.writes.length, 0)
  })

  test('多个外部修改进入冲突队列，已排定的 autosave 也不得覆盖磁盘', async (t) => {
    const env = await fixture(t)
    const first = await env.open('C:\\笔记\\甲.md')
    const second = await env.open('C:\\笔记\\乙.md')
    env.store.updateTabContent(first.id, '本地甲')
    env.store.updateTabContent(second.id, '本地乙')
    await env.advance(200)
    assert.equal(env.store.handleExternalContent('c:/笔记/甲.md', '外部甲', 20), 'conflict')
    assert.equal(env.store.handleExternalContent('c:/笔记/乙.md', '外部乙', 21), 'conflict')
    assert.equal(env.store.handleExternalContent(second.path!, '最新外部乙', 22), 'conflict')
    assert.equal(env.store.conflict?.tabId, first.id)
    assert.deepEqual(env.store.conflictQueue.map((item) => item.tabId), [second.id])
    await env.advance(1200)
    assert.equal(env.writes.length, 0)
    assert.deepEqual(env.store.tabs.map((tab) => tab.markdown), ['本地甲', '本地乙'])
    assert.deepEqual(env.commits.at(-1)!.tabs.map((tab) => tab.markdown), ['本地甲', '本地乙'])
    assert.equal(env.onSaveError.mock.callCount(), 0)
    env.store.resolveConflict('keep')
    await env.advance(800)
    assert.deepEqual(env.writes, [{ path: first.path, content: '本地甲' }])
    assert.equal(env.store.conflict?.tabId, second.id)
    env.store.resolveConflict('load-disk')
    assert.equal(second.markdown, '最新外部乙')
    assert.equal(second.dirty, false)
    await env.advance(2000)
    assert.equal(env.writes.length, 1)
  })

  test('已删除、loading 及无路径草稿不自动写文件，也不弹出另存为', async (t) => {
    const env = await fixture(t)
    const deleted = await env.open('C:\\笔记\\已删.md')
    env.store.updateTabContent(deleted.id, '已删除文件仍须保全')
    env.store.handleExternalDelete('c:/笔记/已删.md')
    const draft = env.store.newUntitled()!
    env.store.updateTabContent(draft.id, '普通草稿')
    const read = deferred<ReadFileResult>()
    t.mock.method(env.api, 'readFile', () => read.promise)
    const opening = env.store.openPath('D:\\文档\\加载中.md')
    const loadingId = env.store.activeTabId!
    try {
      await env.advance(2000)
      assert.equal(env.writes.length, 0)
      assert.equal(env.api.saveAsDialog.mock.callCount(), 0)
      const snapshot = env.commits.at(-1)!
      assert.deepEqual(snapshot.tabs.map((tab) => tab.id), [deleted.id, draft.id])
      assert.equal(snapshot.tabs[0].deleted, true)
      assert.equal(snapshot.tabs[0].markdown, '已删除文件仍须保全')
      assert.equal(snapshot.tabs[1].markdown, '普通草稿')
      assert.notEqual(snapshot.activeTabId, loadingId)
    } finally {
      read.resolve({ content: '读取完成', mtimeMs: 50 })
      await opening
    }
    await env.advance(1000)
    assert.equal(env.writes.length, 0)
  })

  test('flush 立即提交最新内容并清除待执行的会话定时器', async (t) => {
    const env = await fixture(t)
    const draft = env.store.newUntitled()!
    env.store.updateTabContent(draft.id, '需要立即保全')
    await nextTick()
    assert.equal(env.commits.length, 0)
    assert.equal(await env.persistence.flush(), true)
    assert.equal(env.commits.length, 1)
    assert.equal(env.commits[0].tabs[0].markdown, '需要立即保全')
    await env.advance(2000)
    assert.equal(env.commits.length, 1)
    assert.equal(env.writes.length, 0)
  })

  test('flush 会话提交失败返回 false，不清空草稿，取消残留计时并可重试', async (t) => {
    const env = await fixture(t)
    const draft = env.store.newUntitled()!
    env.store.updateTabContent(draft.id, '提交失败也不能丢失')
    await nextTick()
    const before = env.store.sessionSnapshot()
    const failure = t.mock.method(env.api, 'saveSession', async () => { throw new Error('模拟会话写入失败') })
    const errors = t.mock.method(console, 'error', () => {})
    assert.equal(await env.persistence.flush(), false)
    assert.equal(env.store.sessionError, true)
    assert.deepEqual(env.store.sessionSnapshot(), before)
    await env.advance(2000)
    assert.equal(failure.mock.callCount(), 1)
    assert.equal(errors.mock.callCount(), 1)
    assert.equal(env.writes.length, 0)
    failure.mock.restore()
    assert.equal(await env.persistence.flush(), true)
    assert.equal(env.store.sessionError, false)
    assert.equal(env.commits[0].tabs[0].markdown, '提交失败也不能丢失')
  })

  test('恢复失败时 watch、resume 和 flush 都不能启用会话反写', async (t) => {
    const env = await fixture(t, { restore: false })
    const draft = env.store.newUntitled()!
    env.store.updateTabContent(draft.id, '恢复失败后的内存内容')
    t.mock.method(env.api, 'loadSession', async () => { throw new Error('模拟快照读取失败') })
    await assert.rejects(env.store.restoreSession(), /模拟快照读取失败/)
    assert.equal(env.store.sessionReady, false)
    await env.advance(2000)
    env.persistence.pause()
    await nextTick()
    env.persistence.resume()
    await env.advance(2000)
    assert.equal(await env.persistence.flush(), false)
    assert.equal(env.api.saveSession.mock.callCount(), 0)
    assert.equal(env.writes.length, 0)
    assert.equal(env.store.tabs[0].markdown, '恢复失败后的内存内容')
  })

  test('文件自动保存失败通知调用者，并保留未保存内容', async (t) => {
    const env = await fixture(t)
    const tab = await env.open('C:\\笔记\\拒绝写入.md')
    env.store.updateTabContent(tab.id, '写入失败的编辑内容')
    const failure = t.mock.method(env.api, 'writeFile', async () => { throw new Error('模拟磁盘只读') })
    const errors = t.mock.method(console, 'error', () => {})
    await env.advance(800)
    assert.equal(failure.mock.callCount(), 1)
    assert.equal(env.onSaveError.mock.callCount(), 1)
    assert.equal(errors.mock.callCount(), 1)
    assert.equal(tab.dirty, true)
    assert.equal(tab.markdown, '写入失败的编辑内容')
    assert.equal(env.commits.at(-1)!.tabs[0].markdown, '写入失败的编辑内容')
  })

  test('关闭待自动保存的正式标签会取消文件写入，后续会话无该标签且不 discard', async (t) => {
    const env = await fixture(t)
    const tab = await env.open('C:\\笔记\\关闭.md')
    env.store.updateTabContent(tab.id, '关闭前内容')
    await env.advance(100)
    env.persistence.pause()
    assert.equal(await env.persistence.flush(), true)
    assert.equal(await env.store.closePersistedTab(tab.id), true)
    await nextTick()
    env.persistence.resume()
    await env.advance(2000)
    assert.equal(env.writes.length, 0)
    assert.equal(env.commits[0].tabs[0].markdown, '关闭前内容')
    assert.deepEqual(env.commits.at(-1)!.tabs, [])
    assert.equal(env.commits.at(-1)!.activeTabId, null)
    assert.ok(env.api.saveSession.mock.calls.every((call) => call.arguments[1] === undefined))
    assert.equal(env.api.saveAsDialog.mock.callCount(), 0)
  })

  test('新建空草稿在 400ms 正常会话备份，退出 flush 和卸载均不 discard', async (t) => {
    const env = await fixture(t)
    const draft = env.store.newUntitled()!
    const before = env.store.sessionSnapshot()
    await env.advance(399)
    assert.equal(env.commits.length, 0)
    await env.advance(1)
    assert.deepEqual(env.commits, [before])
    assert.equal(env.commits[0].tabs[0].markdown, '')
    assert.equal(env.commits[0].tabs[0].id, draft.id)
    env.persistence.pause()
    assert.equal(await env.persistence.flush(), true)
    env.unmount()
    await env.advance(15000)
    assert.deepEqual(env.commits, [before, before])
    assert.ok(env.api.saveSession.mock.calls.every((call) => call.arguments[1] === undefined))
    assert.equal(env.writes.length, 0)
    assert.equal(env.api.saveAsDialog.mock.callCount(), 0)
  })

  test('cleanupPending 无编辑也每 5 秒重试，清理成功后停止且从不 discard', async (t) => {
    const env = await fixture(t)
    env.store.newUntitled()
    const before = env.store.sessionSnapshot()
    const save = env.api.saveSession
    let attempts = 0
    const retry = t.mock.method(env.api, 'saveSession', async (snapshot: EditorSession, options?: SessionSaveOptions) => {
      await save(snapshot, options)
      return { cleanupPending: ++attempts <= 2 }
    })
    await env.advance(400)
    assert.equal(env.store.cleanupPending, true)
    assert.equal(env.store.sessionError, false)
    for (let count = 1; count <= 2; count++) {
      await env.advance(4999)
      assert.equal(retry.mock.callCount(), count, '5 秒之前不应重试或进入 400ms 忙循环')
      await env.advance(1)
      assert.equal(retry.mock.callCount(), count + 1)
    }
    assert.equal(env.store.cleanupPending, false)
    await env.advance(15000)
    assert.equal(retry.mock.callCount(), 3)
    assert.deepEqual(env.commits, [before, before, before])
    assert.ok(retry.mock.calls.every((call) => call.arguments[1] === undefined))
    assert.equal(env.writes.length, 0)
    assert.equal(env.onSaveError.mock.callCount(), 0)
  })

  test('清理重试提交 reject 保留 pending，失败后仍等满 5 秒再试，不忙循环', async (t) => {
    const env = await fixture(t)
    env.store.newUntitled()
    const before = env.store.sessionSnapshot()
    const save = env.api.saveSession
    let attempts = 0
    const retry = t.mock.method(env.api, 'saveSession', async (snapshot: EditorSession, options?: SessionSaveOptions) => {
      if (++attempts === 2) throw new Error('模拟后台重试提交失败')
      await save(snapshot, options)
      return { cleanupPending: attempts === 1 }
    })
    const errors = t.mock.method(console, 'error', () => {})
    await env.advance(400)
    await env.advance(5000)
    assert.equal(retry.mock.callCount(), 2)
    assert.equal(env.store.cleanupPending, true)
    assert.equal(env.store.sessionError, true)
    assert.deepEqual(env.store.sessionSnapshot(), before)
    await env.advance(0)
    await env.advance(4999)
    assert.equal(retry.mock.callCount(), 2)
    await env.advance(1)
    assert.equal(retry.mock.callCount(), 3)
    assert.equal(env.store.cleanupPending, false)
    assert.equal(env.store.sessionError, false)
    assert.equal(errors.mock.callCount(), 1)
    await env.advance(15000)
    assert.equal(retry.mock.callCount(), 3)
    assert.ok(retry.mock.calls.every((call) => call.arguments[1] === undefined))
    assert.equal(env.writes.length, 0)
  })

  test('pause 取消清理重试，resume 后重新计满 5 秒且不产生 discard', async (t) => {
    const env = await fixture(t)
    env.store.newUntitled()
    const before = env.store.sessionSnapshot()
    const save = env.api.saveSession
    const retry = t.mock.method(env.api, 'saveSession', async (snapshot: EditorSession, options?: SessionSaveOptions) => {
      await save(snapshot, options)
      return { cleanupPending: true }
    })
    await env.advance(400)
    await env.advance(2500)
    env.persistence.pause()
    await env.advance(15000)
    assert.equal(retry.mock.callCount(), 1)
    assert.equal(env.store.cleanupPending, true)
    env.persistence.resume()
    await nextTick()
    // 清掉 resume 带来的普通 400ms 会话任务，只观察重新安排的清理任务。
    assert.equal(await env.persistence.flush(), true)
    assert.equal(retry.mock.callCount(), 2)
    await env.advance(4999)
    assert.equal(retry.mock.callCount(), 2)
    await env.advance(1)
    assert.equal(retry.mock.callCount(), 3)
    env.persistence.pause()
    await env.advance(15000)
    assert.equal(retry.mock.callCount(), 3)
    assert.deepEqual(env.store.sessionSnapshot(), before)
    assert.ok(retry.mock.calls.every((call) => call.arguments[1] === undefined))
    assert.equal(env.writes.length, 0)
  })

  test('卸载取消尚未到期的清理重试，后续 pending 变化也不再调度或 discard', async (t) => {
    const env = await fixture(t)
    const draft = env.store.newUntitled()!
    const save = env.api.saveSession
    const retry = t.mock.method(env.api, 'saveSession', async (snapshot: EditorSession, options?: SessionSaveOptions) => {
      await save(snapshot, options)
      return { cleanupPending: true }
    })
    await env.advance(400)
    await env.advance(4999)
    env.unmount()
    assert.equal(env.isMounted(), false)
    await env.advance(15000)
    assert.equal(retry.mock.callCount(), 1)
    env.store.cleanupPending = false
    await nextTick()
    env.store.cleanupPending = true
    env.store.updateTabContent(draft.id, '卸载后的内存编辑')
    await env.advance(15000)
    assert.equal(retry.mock.callCount(), 1)
    assert.equal(retry.mock.calls[0].arguments[1], undefined)
    assert.equal(env.writes.length, 0)
  })

  for (const stop of ['pause', 'unmount'] as const) {
    test(`清理重试尚在等待 IPC 时 ${stop}，迟到的 pending 回包不得重新安排重试`, async (t) => {
      const env = await fixture(t)
      env.store.newUntitled()
      const release = deferred<void>()
      const save = env.api.saveSession
      let attempts = 0
      const retry = t.mock.method(env.api, 'saveSession', async (snapshot: EditorSession, options?: SessionSaveOptions) => {
        if (++attempts === 2) await release.promise
        await save(snapshot, options)
        return { cleanupPending: true }
      })
      try {
        await env.advance(400)
        await env.advance(5000)
        assert.equal(retry.mock.callCount(), 2)
        if (stop === 'pause') env.persistence.pause()
        else env.unmount()
      } finally {
        release.resolve()
        await env.advance(0)
      }
      await env.advance(15000)
      assert.equal(retry.mock.callCount(), 2)
      assert.equal(env.store.cleanupPending, true)
      assert.ok(retry.mock.calls.every((call) => call.arguments[1] === undefined))
      assert.equal(env.writes.length, 0)
    })
  }

  test('旧周期提交未完成时关闭草稿，排队的后续周期提交不得复活该草稿', async (t) => {
    const env = await fixture(t)
    const keep = env.store.newUntitled()!
    const target = env.store.newUntitled()!
    env.store.updateTabContent(target.id, '待关闭的旧内容')
    const firstGate = deferred<void>()
    const closeGate = deferred<void>()
    const save = env.api.saveSession
    const requests: Array<{ snapshot: EditorSession; options?: SessionSaveOptions }> = []
    t.mock.method(env.api, 'saveSession', async (snapshot: EditorSession, options?: SessionSaveOptions) => {
      requests.push({ snapshot: clone(snapshot), options })
      if (requests.length === 1) await firstGate.promise
      else if (requests.length === 2) await closeGate.promise
      return save(snapshot, options)
    })
    let closing: Promise<boolean> | undefined
    try {
      await env.advance(400)
      assert.equal(requests.length, 1)
      closing = env.store.closePersistedTab(target.id)
      env.store.updateTabContent(keep.id, '关闭排队期间的新内容')
      await env.advance(400)
      assert.equal(requests.length, 1, '周期保存不能越过尚未完成的旧提交')
      firstGate.resolve()
      await env.advance(0)
      assert.equal(requests.length, 2)
      assert.deepEqual(requests[1].options, { discardDraftIds: [target.id] })
      assert.deepEqual(requests[1].snapshot.tabs.map((tab) => tab.id), [keep.id])
      assert.equal(env.store.activeTabId, target.id)
      assert.equal(env.store.tabs.length, 2)
    } finally {
      firstGate.resolve()
      closeGate.resolve()
      await closing
      await env.advance(0)
    }
    assert.equal(await closing, true)
    assert.equal(requests.length, 3)
    assert.deepEqual(requests.map((request) => request.options), [undefined, { discardDraftIds: [target.id] }, undefined])
    await env.advance(400)
    assert.equal(requests.length, 4)
    assert.deepEqual(env.commits[0].tabs.map((tab) => tab.id), [keep.id, target.id])
    for (const snapshot of env.commits.slice(1)) {
      assert.deepEqual(snapshot.tabs.map((tab) => tab.id), [keep.id])
      assert.equal(snapshot.activeTabId, keep.id)
      assert.equal(snapshot.tabs[0].markdown, '关闭排队期间的新内容')
    }
    assert.equal(requests[3].options, undefined)
    assert.equal(env.writes.length, 0)
  })

  test('另存会话提交失败时真实周期任务等待回滚，不提交临时文件身份', async (t) => {
    const env = await fixture(t)
    const draft = env.store.newUntitled()!
    env.store.updateTabContent(draft.id, '另存前草稿')
    await env.advance(400)
    const before = env.store.sessionSnapshot().tabs[0]
    const target = 'D:\\文档\\未提交.md'
    const release = deferred<void>()
    const save = env.api.saveSession
    let attempts = 0
    const pending = t.mock.method(env.api, 'saveSession', async (snapshot: EditorSession, options?: SessionSaveOptions) => {
      if (++attempts === 1) {
        await release.promise
        throw new Error('模拟另存会话提交失败')
      }
      return save(snapshot, options)
    })
    const errors = t.mock.method(console, 'error', () => {})
    const saving = env.store.saveTabAs(draft.id, target)
    try {
      await env.advance(0)
      assert.equal(pending.mock.callCount(), 1)
      assert.equal(pending.mock.calls[0].arguments[0].tabs[0].path, target)
      env.store.updateTabContent(draft.id, '提交期间继续编辑')
      await env.advance(400)
      assert.equal(pending.mock.callCount(), 1)
      assert.equal(env.commits.length, 1)
    } finally {
      release.resolve()
      await saving
      await env.advance(0)
    }
    assert.equal(await saving, 'error')
    assert.equal(errors.mock.callCount(), 1)
    assert.equal(pending.mock.callCount(), 2)
    assert.equal(env.commits.length, 2)
    assert.deepEqual(env.commits[1].tabs[0], { ...before, markdown: '提交期间继续编辑' })
    await env.advance(800)
    assert.ok(env.commits.every((snapshot) => snapshot.tabs[0].path === null))
    assert.equal(env.store.tabs[0].path, null)
    assert.equal(env.store.tabs[0].dirty, true)
    assert.deepEqual(env.writes, [{ path: target, content: before.markdown }])
    assert.ok(pending.mock.calls.every((call) => call.arguments[1] === undefined))
  })
})
