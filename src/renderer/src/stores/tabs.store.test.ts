import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { describe, test } from 'node:test'
import type { TestContext } from 'node:test'
import { setImmediate as nextTurn } from 'node:timers/promises'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import type { KmdeApi } from '../../../preload'
import type { EditorSession, ReadFileResult, SessionTab } from '@shared/types'
import { i18n } from '../i18n'
import { useTabsStore } from './tabs.store'

type SessionApi = Pick<KmdeApi, 'loadSession' | 'saveSession' | 'readFile' | 'writeFile' | 'saveAsDialog'>
const windowsKey = (path: string): string => path.replace(/\\/g, '/').toLowerCase()
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value))

// 不依赖较新的 Promise 类型声明，也不使用真实延时制造竞态。
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((accept) => { resolve = accept })
  return { promise, resolve }
}

function savedTab(overrides: Partial<SessionTab> = {}): SessionTab {
  return {
    id: randomUUID(), path: null, fileName: '未命名-1.md', markdown: '# 草稿\r\n',
    dirty: true, mode: 'wysiwyg', savedMtimeMs: 0, deleted: false, ...overrides
  }
}

function sessionOf(...tabs: SessionTab[]): EditorSession {
  return { version: 1, tabs, activeTabId: tabs[0]?.id ?? null, untitledSeq: tabs.length }
}

function fixture(t: TestContext, initial: EditorSession | null = null) {
  let saved = clone(initial)
  let mtimeMs = 100
  const disk = new Map<string, ReadFileResult>()
  const commits: EditorSession[] = []
  const writes: Array<{ path: string; content: string }> = []
  const api = {
    loadSession: t.mock.fn(async () => clone(saved)),
    saveSession: t.mock.fn(async (session: EditorSession): Promise<void> => {
      saved = clone(session)
      commits.push(clone(session))
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
  // 故意不提供删除草稿等额外 API；意外调用必须失败，不能用空函数掩盖问题。
  const kmde = new Proxy(api, {
    get(target, key, receiver) {
      assert.ok(Reflect.has(target, key), `不应调用未约定的 kmde API：${String(key)}`)
      return Reflect.get(target, key, receiver)
    }
  })
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { kmde } })
  i18n.global.locale.value = 'zh-CN'
  const instances: Array<{ pinia: ReturnType<typeof createPinia>; store: ReturnType<typeof useTabsStore> }> = []
  function newStore() {
    const pinia = createPinia()
    setActivePinia(pinia)
    const store = useTabsStore(pinia)
    instances.push({ pinia, store })
    return store
  }
  const store = newStore()
  t.after(async () => {
    for (const item of instances) {
      await item.store.waitForSaves()
      disposePinia(item.pinia)
    }
    setActivePinia(undefined)
    i18n.global.locale.value = originalLocale
    if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow)
    else Reflect.deleteProperty(globalThis, 'window')
  })
  return {
    store, api, writes, commits, newStore,
    diskFile(path: string, content: string, time = 10) {
      disk.set(windowsKey(path), { content, mtimeMs: time })
    }
  }
}

// 所有 action 都运行真实实现，只模拟跨进程 kmde 边界；每例独立 Pinia。
describe('会话恢复与标签保存契约', { concurrency: false, timeout: 5000 }, () => {
  test('UUID 与未命名序号跨会话恢复不冲突，新建不弹出另存为', async (t) => {
    const { store, api, newStore, commits, diskFile } = fixture(t)
    await store.restoreSession()
    const created = Array.from({ length: 4 }, () => store.newUntitled()!)
    created.forEach((tab, index) => {
      assert.match(tab.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
      assert.equal(tab.fileName, `未命名-${index + 1}.md`)
      assert.equal(tab.path, null)
      assert.equal(tab.dirty, true)
    })
    store.updateTabContent(created[0].id, '重启前的草稿')
    // 关闭编号最大的草稿后，序号仍必须持久化，而不是从剩余标签数量推导。
    store.removeTab(created[3].id)
    assert.equal(await store.persistSession(), true)
    assert.equal(commits.at(-1)!.untitledSeq, 4)
    const restarted = newStore()
    await restarted.restoreSession()
    assert.equal(restarted.tabs[0].markdown, '重启前的草稿')
    const next = restarted.newUntitled()!
    assert.equal(next.fileName, '未命名-5.md')
    assert.equal(new Set([...created.map((tab) => tab.id), next.id]).size, 5)
    assert.equal(await restarted.persistSession(), true)
    const again = newStore()
    await again.restoreSession()
    const sixth = again.newUntitled()!
    assert.equal(sixth.fileName, '未命名-6.md')
    assert.notEqual(sixth.id, next.id)
    diskFile('C:\\笔记\\已有.md', '磁盘内容')
    const opened = await again.openPath('C:\\笔记\\已有.md')
    assert.match(opened!.id, /^[0-9a-f-]{36}$/i)
    assert.equal(api.saveAsDialog.mock.callCount(), 0)
    assert.equal(api.writeFile.mock.callCount(), 0)
  })

  test('恢复标签顺序、编辑模式、活动标签，并保留原会话对象', async (t) => {
    const first = savedTab({ path: 'C:\\笔记\\首篇.md', fileName: '首篇.md', dirty: false, mode: 'source' })
    const second = savedTab({ fileName: '未命名-9.md', mode: 'wysiwyg' })
    const third = savedTab({ path: 'D:\\工作\\末篇.md', fileName: '末篇.md', dirty: false, mode: 'source' })
    const session = { ...sessionOf(first, second, third), activeTabId: second.id, untitledSeq: 9 }
    const original = clone(session)
    const { store, diskFile } = fixture(t, session)
    diskFile(first.path!, '首篇新内容', 20)
    diskFile(third.path!, '末篇新内容', 30)
    await store.restoreSession()
    assert.deepEqual(store.tabs.map(({ id, mode }) => ({ id, mode })), session.tabs.map(({ id, mode }) => ({ id, mode })))
    assert.equal(store.activeTabId, second.id)
    assert.equal(store.untitledSeq, 9)
    assert.ok(store.tabs.every((tab) => !tab.loading && tab.reloadToken === 0))
    assert.equal(store.sessionReady, true)
    assert.deepEqual(session, original)
  })

  test('Windows 路径大小写及分隔符归一去重，失效活动标签回退', async (t) => {
    const first = savedTab({ path: 'C:\\Notes\\A.md', dirty: false })
    const duplicate = savedTab({ path: 'c:/notes/a.MD', mode: 'source', dirty: false })
    const draft = savedTab()
    const { store, diskFile, api } = fixture(t, { ...sessionOf(first, duplicate, draft), activeTabId: duplicate.id })
    diskFile(first.path!, '唯一文件')
    await store.restoreSession()
    assert.deepEqual(store.tabs.map((tab) => tab.id), [first.id, draft.id])
    assert.equal(store.activeTabId, first.id)
    assert.equal(store.byPath('c:/NOTES/A.md')?.id, first.id)
    assert.equal(api.readFile.mock.callCount(), 1)
  })

  test('异步打开期间快照忽略 loading，并为活动标签提供有效回退', async (t) => {
    const { store, api, commits } = fixture(t)
    await store.restoreSession()
    const loaded = deferred<ReadFileResult>()
    t.mock.method(api, 'readFile', () => loaded.promise)
    const opening = store.openPath('C:\\笔记\\读取中.md')
    const loadingId = store.activeTabId!
    try {
      assert.equal(store.tabs[0].loading, true)
      assert.deepEqual(store.sessionSnapshot().tabs, [])
      assert.equal(store.sessionSnapshot().activeTabId, null)
      assert.equal(await store.saveTab(loadingId), 'loading')
      const draft = store.newUntitled()!
      store.activateTab(loadingId)
      assert.equal(await store.persistSession(), true)
      assert.deepEqual(commits[0].tabs.map((tab) => tab.id), [draft.id])
      assert.equal(commits[0].activeTabId, draft.id)
      assert.equal(api.writeFile.mock.callCount(), 0)
    } finally {
      loaded.resolve({ content: '完整文件', mtimeMs: 88 })
      await opening
    }
    const snapshot = store.sessionSnapshot()
    assert.deepEqual(snapshot.tabs.map((tab) => tab.markdown), ['完整文件', ''])
    assert.equal(snapshot.activeTabId, loadingId)
    assert.ok(snapshot.tabs.every((tab) => !('loading' in tab) && !('reloadToken' in tab)))
    store.updateTabContent(loadingId, '后续编辑')
    assert.equal(snapshot.tabs[0].markdown, '完整文件')
  })

  test('clean 文件恢复读取最新磁盘内容，不使用旧快照反写磁盘', async (t) => {
    const tab = savedTab({ path: 'C:\\笔记\\干净.md', markdown: '旧快照', dirty: false, savedMtimeMs: 10 })
    const { store, diskFile, api } = fixture(t, sessionOf(tab))
    diskFile(tab.path!, '磁盘上的新版本\r\n', 99)
    await store.restoreSession()
    assert.equal(store.tabs[0].markdown, '磁盘上的新版本\r\n')
    assert.equal(store.tabs[0].savedMtimeMs, 99)
    assert.equal(store.tabs[0].dirty, false)
    assert.equal(store.conflict, null)
    assert.equal(api.writeFile.mock.callCount(), 0)
  })

  test('dirty 内容和已删除文件完整保全，缺失文件不被空内容替换', async (t) => {
    const dirty = savedTab({ path: 'C:\\笔记\\待存.md', markdown: '本地未保存修改', savedMtimeMs: 10 })
    const deleted = savedTab({ path: 'D:\\文档\\已删.md', markdown: '已删文件的修改\r\n', deleted: true })
    const missingClean = savedTab({ path: 'D:\\文档\\丢失.md', markdown: '干净文件的灾备', dirty: false })
    const { store, diskFile, api, commits } = fixture(t, sessionOf(dirty, deleted, missingClean))
    diskFile(dirty.path!, '磁盘旧内容', 10)
    await store.restoreSession()
    assert.deepEqual(store.tabs.map((tab) => tab.markdown), [dirty.markdown, deleted.markdown, missingClean.markdown])
    assert.deepEqual(store.tabs.map((tab) => [tab.dirty, tab.deleted]), [[true, false], [true, true], [false, true]])
    assert.equal(store.conflict, null)
    assert.equal(await store.saveTab(deleted.id), 'need-path')
    assert.equal(await store.saveTab(missingClean.id), 'need-path')
    assert.equal(api.writeFile.mock.callCount(), 0)
    assert.equal(await store.persistSession(), true)
    assert.equal(commits[0].tabs[1].markdown, deleted.markdown)
    assert.equal(commits[0].tabs[1].deleted, true)
  })

  test('dirty 快照与磁盘内容相同则恢复为 clean，不产生伪冲突', async (t) => {
    const tab = savedTab({ path: 'C:\\笔记\\已存.md', deleted: true, savedMtimeMs: 1 })
    const { store, diskFile } = fixture(t, sessionOf(tab))
    diskFile(tab.path!, tab.markdown, 200)
    await store.restoreSession()
    assert.equal(store.tabs[0].dirty, false)
    assert.equal(store.tabs[0].deleted, false)
    assert.equal(store.tabs[0].savedMtimeMs, 200)
    assert.equal(store.conflict, null)
  })

  test('多个恢复冲突排队，重复通知更新内容，未处理冲突不得写入', async (t) => {
    const first = savedTab({ path: 'C:\\笔记\\甲.md', markdown: '本地甲', savedMtimeMs: 10 })
    const second = savedTab({ path: 'C:\\笔记\\乙.md', markdown: '本地乙', savedMtimeMs: 10 })
    const { store, diskFile, writes } = fixture(t, sessionOf(first, second))
    diskFile(first.path!, '外部甲', 20)
    diskFile(second.path!, '外部乙', 21)
    await store.restoreSession()
    assert.equal(store.conflict?.tabId, first.id)
    assert.deepEqual(store.conflictQueue.map((item) => item.tabId), [second.id])
    assert.equal(store.handleExternalContent('c:/笔记/乙.md', '最新外部乙', 22), 'conflict')
    assert.equal(store.conflictQueue.length, 1)
    assert.equal(store.conflictQueue[0].diskContent, '最新外部乙')
    assert.equal(await store.saveTab(first.id), 'error')
    assert.equal(await store.saveTab(second.id), 'error')
    assert.deepEqual(writes, [])
    assert.deepEqual(store.tabs.map((tab) => tab.markdown), ['本地甲', '本地乙'])
    store.resolveConflict('keep')
    assert.equal(store.conflict?.tabId, second.id)
    assert.equal(await store.saveTab(first.id), 'saved')
    assert.equal(await store.saveTab(second.id), 'error')
    assert.deepEqual(writes, [{ path: first.path, content: '本地甲' }])
    store.resolveConflict('load-disk')
    assert.equal(store.tabs[1].markdown, '最新外部乙')
    assert.equal(store.tabs[1].dirty, false)
    assert.equal(store.tabs[1].savedMtimeMs, 22)
    assert.equal(store.conflict, null)
    assert.deepEqual(store.conflictQueue, [])
  })

  test('恢复尚未完成时不发布冲突，安装标签后才能选择磁盘版本', async (t) => {
    const first = savedTab({ path: 'C:\\笔记\\冲突.md', markdown: '本地内容', savedMtimeMs: 1 })
    const second = savedTab({ path: 'C:\\笔记\\慢读取.md', dirty: false })
    const { store, api } = fixture(t, sessionOf(first, second))
    const waiting = deferred<void>()
    const release = deferred<ReadFileResult>()
    t.mock.method(api, 'readFile', async (path: string) => {
      if (path === first.path) return { content: '应保留的磁盘内容', mtimeMs: 2 }
      waiting.resolve()
      return release.promise
    })
    const restoring = store.restoreSession()
    try {
      await waiting.promise
      assert.equal(store.sessionReady, false)
      assert.equal(store.conflict, null)
      assert.deepEqual(store.conflictQueue, [])
    } finally {
      release.resolve({ content: '读取完成', mtimeMs: 3 })
      await restoring
    }
    assert.equal(store.conflict?.tabId, first.id)
    store.resolveConflict('load-disk')
    assert.equal(store.tabs[0].markdown, '应保留的磁盘内容')
    assert.equal(store.tabs[0].dirty, false)
    assert.equal(api.writeFile.mock.callCount(), 0)
  })

  test('另存为取消保留草稿身份、内容及 dirty 状态', async (t) => {
    const { store, api } = fixture(t)
    await store.restoreSession()
    const draft = store.newUntitled()!
    store.updateTabContent(draft.id, '不能丢失的草稿')
    const before = store.sessionSnapshot()
    assert.equal(await store.flushSave(draft.id), false)
    assert.deepEqual(store.sessionSnapshot(), before)
    assert.equal(api.saveAsDialog.mock.callCount(), 1)
    assert.deepEqual(api.saveAsDialog.mock.calls[0].arguments, [draft.fileName])
    assert.equal(api.writeFile.mock.callCount(), 0)
  })

  test('另存为磁盘写入失败保留草稿身份，重试成功才切换为文件', async (t) => {
    const { store, api, commits } = fixture(t)
    await store.restoreSession()
    const draft = store.newUntitled()!
    store.updateTabContent(draft.id, '等待重试')
    const before = store.sessionSnapshot()
    const target = 'D:\\文档\\另存为.md'
    t.mock.method(api, 'saveAsDialog', async () => target)
    const write = t.mock.method(api, 'writeFile', async () => { throw new Error('模拟磁盘写入失败') })
    const errors = t.mock.method(console, 'error', () => {})
    assert.equal(await store.flushSave(draft.id), false)
    assert.deepEqual(store.sessionSnapshot(), before)
    assert.equal(commits.length, 0)
    assert.equal(errors.mock.callCount(), 1)
    write.mock.restore()
    assert.equal(await store.flushSave(draft.id), true)
    assert.deepEqual(store.sessionSnapshot().tabs[0], {
      ...before.tabs[0], path: target, fileName: '另存为.md', dirty: false, savedMtimeMs: 101
    })
    assert.equal(commits.at(-1)!.tabs[0].id, draft.id)
    assert.equal(commits.at(-1)!.tabs[0].path, target)
  })

  test('另存为会话提交失败也不能提前丢失草稿身份', async (t) => {
    const { store, api, writes } = fixture(t)
    await store.restoreSession()
    const draft = store.newUntitled()!
    store.updateTabContent(draft.id, '会话尚未提交的草稿')
    const before = store.sessionSnapshot().tabs[0]
    t.mock.method(api, 'saveSession', async () => { throw new Error('模拟会话提交失败') })
    t.mock.method(console, 'error', () => {})
    assert.equal(await store.saveTabAs(draft.id, 'D:\\文档\\目标.md'), 'error')
    assert.equal(writes.length, 1)
    assert.equal(store.sessionError, true)
    const after = store.sessionSnapshot().tabs[0]
    assert.equal(after.id, before.id)
    assert.equal(after.markdown, before.markdown)
    assert.equal(after.path, null, '另存为报告失败时，应保留未提交草稿的 path=null 身份')
    assert.equal(after.fileName, before.fileName)
    assert.equal(after.dirty, true)
  })

  test('保存进行中继续编辑，成功回调不能把新内容标为 clean', async (t) => {
    const path = 'C:\\笔记\\编辑中.md'
    const { store, api, diskFile, commits } = fixture(t)
    diskFile(path, '最初内容')
    await store.restoreSession()
    const tab = (await store.openPath(path))!
    store.updateTabContent(tab.id, '第一版')
    const entered = deferred<void>()
    const release = deferred<void>()
    const write = api.writeFile
    t.mock.method(api, 'writeFile', async (target: string, content: string) => {
      entered.resolve()
      await release.promise
      return write(target, content)
    })
    const saving = store.saveTab(tab.id)
    try {
      await entered.promise
      assert.equal(store.saving, true)
      store.updateTabContent(tab.id, '保存期间输入的第二版')
    } finally {
      release.resolve()
    }
    assert.equal(await saving, 'saved')
    assert.equal(store.tabs[0].markdown, '保存期间输入的第二版')
    assert.equal(store.tabs[0].dirty, true)
    assert.equal(commits.at(-1)!.tabs[0].markdown, '保存期间输入的第二版')
    assert.equal(commits.at(-1)!.tabs[0].dirty, true)
    assert.equal(await store.saveTab(tab.id), 'saved')
    assert.equal(store.tabs[0].dirty, false)
    await store.waitForSaves()
    assert.equal(store.saving, false)
  })

  test('同一标签的并发保存串行写入，后一请求读取最新编辑内容', async (t) => {
    const path = 'C:\\笔记\\串行.md'
    const { store, api, diskFile, writes } = fixture(t)
    diskFile(path, '原始内容')
    await store.restoreSession()
    const tab = (await store.openPath(path))!
    store.updateTabContent(tab.id, '第一版')
    const entered = deferred<void>()
    const release = deferred<void>()
    const started: string[] = []
    let inFlight = 0
    let maximum = 0
    const write = api.writeFile
    t.mock.method(api, 'writeFile', async (target: string, content: string) => {
      started.push(content)
      maximum = Math.max(maximum, ++inFlight)
      try {
        if (started.length === 1) {
          entered.resolve()
          await release.promise
        }
        return await write(target, content)
      } finally {
        inFlight--
      }
    })
    const first = store.saveTab(tab.id)
    let second: ReturnType<typeof store.saveTab> | undefined
    try {
      await entered.promise
      store.updateTabContent(tab.id, '第二版')
      second = store.saveTab(tab.id)
      await nextTurn()
      assert.deepEqual(started, ['第一版'])
      assert.equal(store.saving, true)
    } finally {
      release.resolve()
    }
    assert.deepEqual(await Promise.all([first, second]), ['saved', 'saved'])
    await store.waitForSaves()
    assert.equal(maximum, 1)
    assert.deepEqual(writes, [{ path, content: '第一版' }, { path, content: '第二版' }])
    assert.equal(store.tabs[0].dirty, false)
    assert.equal(store.saving, false)
  })

  test('会话保存异常返回 false，成功重试清除错误状态', async (t) => {
    const { store, api } = fixture(t)
    assert.equal(await store.persistSession(), false)
    assert.equal(api.saveSession.mock.callCount(), 0)
    await store.restoreSession()
    store.newUntitled()
    const failure = t.mock.method(api, 'saveSession', async () => { throw new Error('模拟会话写入失败') })
    const errors = t.mock.method(console, 'error', () => {})
    assert.equal(await store.persistSession(), false)
    assert.equal(store.sessionError, true)
    assert.equal(errors.mock.callCount(), 1)
    failure.mock.restore()
    assert.equal(await store.persistSession(), true)
    assert.equal(store.sessionError, false)
  })

  test('恢复失败保持未就绪，禁止把空白或旧状态反写会话', async (t) => {
    const { store, api } = fixture(t)
    await store.restoreSession()
    const draft = store.newUntitled()!
    store.updateTabContent(draft.id, '内存里的原草稿')
    const before = store.sessionSnapshot()
    const failure = new Error('模拟快照损坏')
    t.mock.method(api, 'loadSession', async () => { throw failure })
    await assert.rejects(store.restoreSession(), (error) => error === failure)
    assert.equal(store.sessionReady, false)
    assert.deepEqual(store.sessionSnapshot(), before)
    assert.equal(await store.persistSession(), false)
    assert.equal(api.saveSession.mock.callCount(), 0)
    assert.equal(api.writeFile.mock.callCount(), 0)
  })

  test('关闭标签后快照剔除，活动标签有效，不依赖任何删除 API', async (t) => {
    const { store, commits, newStore, api } = fixture(t)
    await store.restoreSession()
    const first = store.newUntitled()!
    const second = store.newUntitled()!
    store.updateTabContent(second.id, '关闭前保全')
    assert.equal(await store.persistSession(), true)
    store.removeTab(second.id)
    assert.equal(await store.persistSession(), true)
    assert.deepEqual(commits.at(-1)!.tabs.map((tab) => tab.id), [first.id])
    assert.equal(commits.at(-1)!.activeTabId, first.id)
    assert.equal(commits[0].tabs[1].markdown, '关闭前保全')
    const restarted = newStore()
    await restarted.restoreSession()
    assert.deepEqual(restarted.tabs.map((tab) => tab.id), [first.id])
    restarted.removeTab(first.id)
    assert.equal(await restarted.persistSession(), true)
    assert.deepEqual(commits.at(-1)!.tabs, [])
    assert.equal(commits.at(-1)!.activeTabId, null)
    assert.equal(api.writeFile.mock.callCount(), 0)
  })
})
