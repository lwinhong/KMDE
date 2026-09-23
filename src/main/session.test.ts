import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { SessionStorage } from './session.ts'
import type { EditorSession, SessionSaveOptions, SessionTab } from '../shared/types'

function makeTab(overrides: Partial<SessionTab> = {}): SessionTab {
  return {
    id: randomUUID(), path: null, fileName: '未命名-1.md', markdown: '# 草稿\n',
    dirty: true, mode: 'wysiwyg', savedMtimeMs: 0, deleted: false, ...overrides
  }
}

function makeSession(...tabs: SessionTab[]): EditorSession {
  return { version: 1, tabs, activeTabId: tabs[0]?.id ?? null, untitledSeq: tabs.length }
}

async function fixture(t: TestContext) {
  const base = await fs.mkdtemp(join(tmpdir(), 'kmde-session-'))
  t.after(() => fs.rm(base, { recursive: true, force: true }))
  const root = join(base, 'session')
  return {
    base, root, storage: new SessionStorage(root), snapshotPath: join(root, 'session.json'),
    draftPath: (id: string) => join(root, 'drafts', `${id.toLowerCase()}.md`)
  }
}

async function assertMissing(path: string): Promise<void> {
  await assert.rejects(fs.stat(path), { code: 'ENOENT' })
}

async function readManifest(path: string): Promise<EditorSession & { pendingCleanupIds?: string[] }> {
  return JSON.parse(await fs.readFile(path, 'utf-8'))
}

test('仅缺少快照返回新会话，空会话也能往返', async (t) => {
  const { root, storage } = await fixture(t)
  assert.equal(await storage.load(), null)
  await assertMissing(root)
  const empty = makeSession()
  assert.deepEqual(await storage.save(empty), { cleanupPending: false })
  assert.deepEqual(await new SessionStorage(root).load(), empty)
})

test('草稿是真实 Markdown 文件，全量快照保留普通文件及已删除文件的恢复内容', async (t) => {
  const { base, root, storage, snapshotPath, draftPath } = await fixture(t)
  const normalPath = join(base, '已有文件.md')
  await fs.writeFile(normalPath, '磁盘原内容')
  const draft = makeTab({ markdown: '# 中文\r\n\n灾备内容\0尾部' })
  const blank = makeTab({ markdown: '', dirty: false, mode: 'source' })
  const dirty = makeTab({ path: normalPath, markdown: '尚未保存的普通文件内容', savedMtimeMs: 123.5 })
  const deleted = makeTab({ path: join(base, '已删除.md'), deleted: true, dirty: false, markdown: '已删除文件备份' })
  const expected = { ...makeSession(draft, blank, dirty, deleted), activeTabId: dirty.id, untitledSeq: 42 }
  await storage.save(expected)
  assert.equal(await fs.readFile(draftPath(draft.id), 'utf-8'), draft.markdown)
  assert.equal(await fs.readFile(draftPath(blank.id), 'utf-8'), '')
  assert.equal(await fs.readFile(normalPath, 'utf-8'), '磁盘原内容')
  await assertMissing(deleted.path!)
  assert.deepEqual(JSON.parse(await fs.readFile(snapshotPath, 'utf-8')), expected)
  assert.deepEqual(await new SessionStorage(root).load(), expected)

  // 草稿丢失时仍可用快照灾备，读取不会偷偷写回任何普通文件。
  await fs.unlink(draftPath(draft.id))
  const loaded = await storage.load()
  assert.deepEqual(loaded, expected)
  loaded!.tabs[0].markdown = '外部修改返回值'
  assert.deepEqual(await storage.load(), expected)
})

test('同目录独占临时写、同步、关闭及重命名按顺序执行，草稿先于会话提交', async (t) => {
  const { root, storage, snapshotPath, draftPath } = await fixture(t)
  const tab = makeTab()
  const events: string[] = []
  const open = fs.open.bind(fs)
  const rename = fs.rename.bind(fs)
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    assert.equal(args[1], 'wx')
    const temporary = String(args[0])
    const name = temporary.includes('.session.json.') ? '会话' : '草稿'
    assert.equal(dirname(temporary), name === '会话' ? root : join(root, 'drafts'))
    events.push(`${name}:open`)
    const handle = await open(...args)
    const write = handle.writeFile.bind(handle)
    const sync = handle.sync.bind(handle)
    const close = handle.close.bind(handle)
    t.mock.method(handle, 'writeFile', async (...values: Parameters<typeof handle.writeFile>) => {
      events.push(`${name}:write`)
      return write(...values)
    })
    t.mock.method(handle, 'sync', async () => {
      events.push(`${name}:sync`)
      return sync()
    })
    t.mock.method(handle, 'close', async () => {
      events.push(`${name}:close`)
      return close()
    })
    return handle
  })
  t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
    const name = String(args[1]) === snapshotPath ? '会话' : '草稿'
    events.push(`${name}:rename`)
    assert.equal(dirname(String(args[0])), dirname(String(args[1])))
    if (name === '会话') assert.equal(await fs.readFile(draftPath(tab.id), 'utf-8'), tab.markdown)
    return rename(...args)
  })
  await storage.save(makeSession(tab))
  assert.deepEqual(events, ['草稿', '会话'].flatMap((name) =>
    ['open', 'write', 'sync', 'close', 'rename'].map((step) => `${name}:${step}`)))
  assert.deepEqual(await fs.readdir(root), ['drafts', 'session.json'])
  assert.deepEqual(await fs.readdir(join(root, 'drafts')), [`${tab.id}.md`])
})

test('并发 save 串行执行，旧请求不能覆盖新请求，load 等待之前的提交', async (t) => {
  const { storage, snapshotPath, draftPath } = await fixture(t)
  const tab = makeTab({ markdown: '旧内容' })
  const firstSession = makeSession(tab)
  const secondSession = makeSession({ ...tab, markdown: '新内容' })
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const rename = fs.rename.bind(fs)
  const commits: string[] = []
  let blocked = false
  t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
    if (String(args[1]) === snapshotPath) {
      if (!blocked) {
        blocked = true
        entered.resolve()
        await release.promise
      }
      const snapshot = JSON.parse(await fs.readFile(args[0], 'utf-8')) as EditorSession
      commits.push(snapshot.tabs[0].markdown)
    }
    return rename(...args)
  })
  const first = storage.save(firstSession)
  await entered.promise
  const second = storage.save(secondSession)
  const loaded = storage.load()
  try {
    await new Promise<void>((resolve) => setImmediate(resolve))
    assert.deepEqual(commits, [])
    assert.equal(await fs.readFile(draftPath(tab.id), 'utf-8'), '旧内容')
  } finally {
    release.resolve()
  }
  await Promise.all([first, second])
  assert.deepEqual(commits, ['旧内容', '新内容'])
  assert.deepEqual(await loaded, secondSession)
  assert.equal(await fs.readFile(draftPath(tab.id), 'utf-8'), '新内容')
})

test('光标与反向选区按模式精确往返，旧 version 1 页签不补 selection 字段', async (t) => {
  const { root, storage, snapshotPath } = await fixture(t)
  const source = makeTab({ mode: 'source', selection: { mode: 'source', anchor: Number.MAX_SAFE_INTEGER, head: 0 } })
  const wysiwyg = makeTab({ selection: { mode: 'wysiwyg', anchor: 2, head: 7 } })
  const legacy = makeTab()
  const expected = makeSession(source, wysiwyg, legacy)
  await storage.save(expected)
  assert.deepEqual(await readManifest(snapshotPath), expected)
  const loaded = await new SessionStorage(root).load()
  assert.deepEqual(loaded, expected)
  assert.equal(Object.hasOwn(loaded!.tabs[2], 'selection'), false)
  loaded!.tabs[0].selection!.head = 42
  assert.deepEqual(await storage.load(), expected)
})

test('分屏模式与两个面板坐标系的光标跨会话往返', async (t) => {
  const { root, storage, snapshotPath } = await fixture(t)
  const wysiwygPane = makeTab({ mode: 'split', selection: { mode: 'wysiwyg', anchor: 3, head: 5 } })
  const sourcePane = makeTab({ mode: 'split', selection: { mode: 'source', anchor: 8, head: 1 } })
  const expected = makeSession(wysiwygPane, sourcePane)
  await storage.save(expected)
  assert.deepEqual(await readManifest(snapshotPath), expected)
  assert.deepEqual(await new SessionStorage(root).load(), expected)
})

test('坏 selection 在 load/save 中降级忽略，保留文档及其他页签的合法光标', async (t) => {
  const { root, storage, snapshotPath } = await fixture(t)
  await fs.mkdir(root, { recursive: true })
  const tab = makeTab()
  const valid = makeTab({ selection: { mode: 'wysiwyg', anchor: 0, head: 0 } })
  const expected = makeSession(tab, valid)
  const invalidSelections: unknown[] = [
    undefined, null, [], 1, true, 'source', {},
    { mode: 'source', anchor: 0 }, { mode: 'source', head: 0 },
    ...[undefined, null, 'preview', 1].map((mode) => ({ mode, anchor: 0, head: 0 })),
    ...['anchor', 'head'].flatMap((field) =>
      [-1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, '0', null, undefined, true]
        .map((value) => ({ mode: 'source', anchor: 0, head: 0, [field]: value })))
  ]
  for (const selection of invalidSelections) {
    const value = makeSession({ ...tab, selection } as SessionTab, valid)
    const raw = JSON.stringify(value)
    await fs.writeFile(snapshotPath, raw)
    const loaded = await storage.load()
    assert.deepEqual(loaded, expected)
    assert.equal(Object.hasOwn(loaded!.tabs[0], 'selection'), false)
    assert.equal(await fs.readFile(snapshotPath, 'utf-8'), raw, '恢复不能因坏光标改写原快照')
    assert.deepEqual(await storage.save(value), { cleanupPending: false })
    assert.deepEqual(await readManifest(snapshotPath), expected)
    assert.equal(Object.hasOwn((await storage.load())!.tabs[0], 'selection'), false)
  }
})

test('合法 selection 只复制契约字段，不把 UI 扩展字段写入快照', async (t) => {
  const { storage } = await fixture(t)
  const selection = { mode: 'source' as const, anchor: 0, head: 3, extra: { transient: true } }
  const tab = makeTab({ mode: 'source', selection })
  await storage.save(makeSession(tab))
  assert.deepEqual((await storage.load())!.tabs[0].selection, { mode: 'source', anchor: 0, head: 3 })
})

test('save 在调用时深复制光标与快照，不受排队期间对象修改影响', async (t) => {
  const { storage } = await fixture(t)
  const value = makeSession(makeTab({ selection: { mode: 'wysiwyg', anchor: 7, head: 2 } }))
  const expected = structuredClone(value)
  const previous = storage.save(makeSession({ ...value.tabs[0], markdown: '前一请求' }))
  const saving = storage.save(value)
  value.tabs[0].selection!.mode = 'source'
  value.tabs[0].selection!.anchor = 100
  value.tabs[0].selection!.head = 200
  value.tabs[0].markdown = '不应被保存'
  value.tabs.length = 0
  value.activeTabId = null
  await Promise.all([previous, saving])
  assert.deepEqual(await storage.load(), expected)
})

test('缺席及退出空会话保留草稿和孤儿，不扫描目录', async (t) => {
  const { storage, root, draftPath } = await fixture(t)
  const first = makeTab()
  const second = makeTab({ markdown: '第二份草稿' })
  await storage.save(makeSession(first, second))
  const orphan = draftPath(randomUUID())
  const temporary = join(root, 'drafts', '.未提交.tmp')
  await fs.writeFile(orphan, '孤儿草稿')
  await fs.writeFile(temporary, '中断写入')
  const scan = t.mock.method(fs, 'readdir', async () => { throw new Error('禁止扫描草稿目录') })
  const remove = t.mock.method(fs, 'unlink', async () => { throw new Error('禁止隐式删除') })
  assert.deepEqual(await storage.save(makeSession(second)), { cleanupPending: false })
  assert.deepEqual(await new SessionStorage(root).save(makeSession()), { cleanupPending: false })
  assert.equal(await fs.readFile(draftPath(first.id), 'utf-8'), first.markdown)
  assert.equal(await fs.readFile(draftPath(second.id), 'utf-8'), second.markdown)
  assert.equal(await fs.readFile(orphan, 'utf-8'), '孤儿草稿')
  assert.equal(await fs.readFile(temporary, 'utf-8'), '中断写入')
  assert.deepEqual(await storage.load(), makeSession())
  assert.equal(scan.mock.callCount(), 0)
  assert.equal(remove.mock.callCount(), 0)
})

test('显式丢弃归一去重，先写保留草稿、原子提交清理意图，最后只删指定草稿', async (t) => {
  const { storage, snapshotPath, draftPath } = await fixture(t)
  const discard = makeTab({ id: 'ABCDEF12-1234-4321-ABCD-123456789ABC' })
  const retained = makeTab()
  const absent = makeTab({ markdown: '缺席但不丢弃' })
  await storage.save(makeSession(discard, retained, absent))
  const next = makeSession({ ...retained, markdown: '保留草稿的新内容' })
  const missingId = randomUUID()
  const pendingCleanupIds = [discard.id.toLowerCase(), missingId].sort()
  const events: string[] = []
  const rename = fs.rename.bind(fs)
  const unlink = fs.unlink.bind(fs)
  t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
    if (String(args[1]) === draftPath(retained.id)) events.push('保留草稿')
    if (String(args[1]) === snapshotPath) {
      const manifest = await readManifest(String(args[0]))
      events.push(manifest.pendingCleanupIds ? '提交清理意图' : '确认清理完成')
      assert.equal(await fs.readFile(draftPath(retained.id), 'utf-8'), next.tabs[0].markdown)
    }
    return rename(...args)
  })
  const remove = t.mock.method(fs, 'unlink', async (...args: Parameters<typeof fs.unlink>) => {
    assert.deepEqual(await readManifest(snapshotPath), { ...next, pendingCleanupIds })
    assert.ok([draftPath(discard.id), draftPath(missingId)].includes(String(args[0])))
    events.push('删除草稿')
    return unlink(...args)
  })
  const options = { discardDraftIds: [discard.id, discard.id.toLowerCase(), missingId, missingId] }
  const saving = storage.save(next, options)
  options.discardDraftIds.splice(0, options.discardDraftIds.length, retained.id)
  assert.deepEqual(await saving, { cleanupPending: false })
  assert.deepEqual(events, ['保留草稿', '提交清理意图', '删除草稿', '删除草稿', '确认清理完成'])
  assert.equal(remove.mock.callCount(), 2)
  await assertMissing(draftPath(discard.id))
  assert.equal(await fs.readFile(draftPath(absent.id), 'utf-8'), absent.markdown)
  assert.deepEqual(await readManifest(snapshotPath), next)
  assert.deepEqual(await storage.load(), next)
})

test('正式路径 dirty 或 deleted 时保留备份，仅 !dirty && !deleted 提交后清理', async (t) => {
  const { base, storage, snapshotPath, draftPath } = await fixture(t)
  const first = makeTab()
  const closed = makeTab({ markdown: '已关闭草稿' })
  await storage.save(makeSession(first, closed))
  const named = { ...first, path: join(base, '正式文档.md'), markdown: '正式文档内容' }
  for (const flags of [{ dirty: true, deleted: false }, { dirty: true, deleted: true }, { dirty: false, deleted: true }]) {
    assert.deepEqual(await storage.save(makeSession({ ...named, ...flags })), { cleanupPending: false })
    assert.equal(await fs.readFile(draftPath(first.id), 'utf-8'), first.markdown)
  }
  await fs.writeFile(named.path, named.markdown)
  const committed = makeSession({ ...named, dirty: false })
  const unlink = fs.unlink.bind(fs)
  t.mock.method(fs, 'unlink', async (...args: Parameters<typeof fs.unlink>) => {
    assert.deepEqual(await readManifest(snapshotPath), { ...committed, pendingCleanupIds: [first.id] })
    assert.equal(String(args[0]), draftPath(first.id))
    return unlink(...args)
  })
  assert.deepEqual(await storage.save(committed), { cleanupPending: false })
  await assertMissing(draftPath(first.id))
  assert.equal(await fs.readFile(draftPath(closed.id), 'utf-8'), closed.markdown)
  assert.equal(await fs.readFile(named.path, 'utf-8'), named.markdown)
  assert.deepEqual(await storage.save(committed), { cleanupPending: false })
})

test('任意写入阶段失败不破坏已提交快照、不清理草稿，失败后仍可保存', async (t) => {
  for (const target of ['草稿', '会话'] as const) {
    for (const stage of ['open', 'writeFile', 'sync', 'close', 'rename'] as const) {
      await t.test(`${target} ${stage} 失败`, async (child) => {
        const { base, storage, snapshotPath, draftPath } = await fixture(child)
        const first = makeTab()
        const second = makeTab({ markdown: '旧草稿' })
        const discard = makeTab({ markdown: '请求丢弃的草稿' })
        const absent = makeTab({ markdown: '缺席的草稿' })
        const previous = makeSession(first, second, discard, absent)
        await storage.save(previous)
        const next = makeSession(
          { ...first, path: join(base, '已另存.md'), dirty: false },
          { ...second, markdown: '新草稿' }
        )
        const options = { discardDraftIds: [discard.id] }
        const destination = target === '草稿' ? draftPath(second.id) : snapshotPath
        const failure = Object.assign(new Error(`${target} ${stage} 磁盘故障`), { code: 'EIO' })
        const open = fs.open.bind(fs)
        const rename = fs.rename.bind(fs)
        const remove = child.mock.method(fs, 'unlink', async () => { throw new Error('提交失败不能删除') })
        if (stage === 'rename') {
          child.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
            if (String(args[1]) === destination) throw failure
            return rename(...args)
          })
        } else {
          child.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
            const matches = basename(String(args[0])).startsWith(`.${basename(destination)}.`)
            if (matches && stage === 'open') throw failure
            const handle = await open(...args)
            if (matches && stage !== 'open') {
              const close = handle.close.bind(handle)
              child.mock.method(handle, stage, async () => {
                if (stage === 'close') await close()
                throw failure
              })
            }
            return handle
          })
        }
        await assert.rejects(storage.save(next, options), (error) => error === failure)
        assert.deepEqual(await storage.load(), previous)
        assert.deepEqual(await readManifest(snapshotPath), previous)
        assert.equal(remove.mock.callCount(), 0)
        for (const tab of [first, discard, absent]) {
          assert.equal(await fs.readFile(draftPath(tab.id), 'utf-8'), tab.markdown)
        }
        assert.equal(await fs.readFile(draftPath(second.id), 'utf-8'), target === '草稿' ? '旧草稿' : '新草稿')
        child.mock.restoreAll()
        // 失败提交不得提前污染 closed/named 集合，也不能阻断队列。
        assert.deepEqual(await storage.save(previous), { cleanupPending: false })
        assert.deepEqual(await storage.save(next, options), { cleanupPending: false })
        assert.deepEqual(await storage.load(), next)
        await assertMissing(draftPath(first.id))
        await assertMissing(draftPath(discard.id))
        assert.equal(await fs.readFile(draftPath(absent.id), 'utf-8'), absent.markdown)
      })
    }
  }
})

test('提交后清理失败返回 pending，load 不阻断恢复，重启后 load/save 均可重试', async (t) => {
  for (const action of ['显式丢弃', '转正式'] as const) {
    for (const retry of ['load', 'save'] as const) {
      await t.test(`${action} / ${retry}`, async (child) => {
        const { base, root, storage, snapshotPath, draftPath } = await fixture(child)
        const tab = makeTab()
        await storage.save(makeSession(tab))
        const next = action === '显式丢弃' ? makeSession() : makeSession({ ...tab, path: join(base, '正式.md'), dirty: false })
        const options = action === '显式丢弃' ? { discardDraftIds: [tab.id] } : undefined
        child.mock.method(fs, 'unlink', async () => { throw Object.assign(new Error('清理失败'), { code: 'EACCES' }) })
        assert.deepEqual(await storage.save(next, options), { cleanupPending: true })
        assert.deepEqual(await readManifest(snapshotPath), { ...next, pendingCleanupIds: [tab.id] })
        assert.deepEqual(await storage.load(), next)
        assert.deepEqual(await new SessionStorage(root).load(), next)
        assert.equal(await fs.readFile(draftPath(tab.id), 'utf-8'), tab.markdown)
        child.mock.restoreAll()
        const restarted = new SessionStorage(root)
        if (retry === 'load') assert.deepEqual(await restarted.load(), next)
        else assert.deepEqual(await restarted.save(next), { cleanupPending: false })
        await assertMissing(draftPath(tab.id))
        assert.deepEqual(await readManifest(snapshotPath), next)
      })
    }
  }
})

test('清理确认任意写入阶段失败均返回 pending，重启后幂等确认且不复活旧身份', async (t) => {
  for (const action of ['显式丢弃', '转正式'] as const) {
    for (const stage of ['open', 'writeFile', 'sync', 'close', 'rename'] as const) {
      await t.test(`${action} / ${stage}`, async (child) => {
        const { base, root, storage, snapshotPath, draftPath } = await fixture(child)
        const tab = makeTab()
        await storage.save(makeSession(tab))
        const next = action === '显式丢弃' ? makeSession() : makeSession({ ...tab, path: join(base, '正式.md'), dirty: false })
        const options = action === '显式丢弃' ? { discardDraftIds: [tab.id] } : undefined
        const failure = Object.assign(new Error('确认清理失败'), { code: 'EIO' })
        const open = fs.open.bind(fs)
        const rename = fs.rename.bind(fs)
        let committed = false
        child.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
          if (String(args[1]) === snapshotPath && committed && stage === 'rename') throw failure
          const result = await rename(...args)
          if (String(args[1]) === snapshotPath) committed = true
          return result
        })
        child.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
          const confirming = committed && basename(String(args[0])).startsWith('.session.json.')
          if (confirming && stage === 'open') throw failure
          const handle = await open(...args)
          if (confirming && stage !== 'open' && stage !== 'rename') {
            const close = handle.close.bind(handle)
            child.mock.method(handle, stage, async () => {
              if (stage === 'close') await close()
              throw failure
            })
          }
          return handle
        })
        assert.deepEqual(await storage.save(next, options), { cleanupPending: true })
        await assertMissing(draftPath(tab.id))
        assert.deepEqual(await readManifest(snapshotPath), { ...next, pendingCleanupIds: [tab.id] })
        assert.deepEqual(await new SessionStorage(root).load(), next)
        assert.deepEqual(await readManifest(snapshotPath), { ...next, pendingCleanupIds: [tab.id] })
        await assert.rejects(storage.save(makeSession(tab)), /迟到快照/)
        await assertMissing(draftPath(tab.id))
        child.mock.restoreAll()
        assert.deepEqual(await new SessionStorage(root).load(), next)
        assert.deepEqual(await readManifest(snapshotPath), next)
      })
    }
  }
})

test('后续保存合并旧 pending，部分清理成功只持久保留失败项', async (t) => {
  const { root, storage, snapshotPath, draftPath } = await fixture(t)
  const first = makeTab()
  const second = makeTab()
  const absent = makeTab()
  await storage.save(makeSession(first, second, absent))
  const unlink = fs.unlink.bind(fs)
  t.mock.method(fs, 'unlink', async (...args: Parameters<typeof fs.unlink>) => {
    if (String(args[0]) === draftPath(first.id)) throw new Error('第一份草稿被占用')
    return unlink(...args)
  })
  assert.deepEqual(await storage.save(makeSession(second), { discardDraftIds: [first.id] }), { cleanupPending: true })
  assert.deepEqual(await storage.save(makeSession(), { discardDraftIds: [second.id] }), { cleanupPending: true })
  assert.deepEqual(await readManifest(snapshotPath), { ...makeSession(), pendingCleanupIds: [first.id] })
  await assertMissing(draftPath(second.id))
  assert.equal(await fs.readFile(draftPath(first.id), 'utf-8'), first.markdown)
  assert.equal(await fs.readFile(draftPath(absent.id), 'utf-8'), absent.markdown)
  assert.deepEqual(await storage.save(makeSession()), { cleanupPending: true })
  t.mock.restoreAll()
  assert.deepEqual(await new SessionStorage(root).load(), makeSession())
  assert.deepEqual(await readManifest(snapshotPath), makeSession())
  await assertMissing(draftPath(first.id))
  assert.equal(await fs.readFile(draftPath(absent.id), 'utf-8'), absent.markdown)
})

test('历史 pending 与有效草稿或未保存正式文件冲突时优先保留恢复内容', async (t) => {
  for (const operation of ['load', 'save'] as const) {
    await t.test(operation, async (child) => {
      const { base, root, storage, snapshotPath, draftPath } = await fixture(child)
      const draft = makeTab()
      const blank = makeTab({ markdown: '', dirty: false })
      const dirty = makeTab({ path: join(base, '未保存.md') })
      const deleted = makeTab({ path: join(base, '已删除.md'), dirty: false, deleted: true })
      const value = makeSession(draft, blank, dirty, deleted)
      await fs.mkdir(join(root, 'drafts'), { recursive: true })
      for (const tab of value.tabs) await fs.writeFile(draftPath(tab.id), tab.markdown)
      await fs.writeFile(snapshotPath, JSON.stringify({ ...value, pendingCleanupIds: value.tabs.map((tab) => tab.id.toUpperCase()) }))
      const remove = child.mock.method(fs, 'unlink', async () => { throw new Error('有效备份不能删除') })
      if (operation === 'load') assert.deepEqual(await storage.load(), value)
      else assert.deepEqual(await storage.save(value), { cleanupPending: false })
      assert.equal(remove.mock.callCount(), 0)
      assert.deepEqual(await readManifest(snapshotPath), value)
      for (const tab of value.tabs) assert.equal(await fs.readFile(draftPath(tab.id), 'utf-8'), tab.markdown)
    })
  }
})

test('legacy version 1 不含 pending 字段也可恢复，不读草稿覆盖快照或扫描孤儿', async (t) => {
  const { root, storage, snapshotPath, draftPath } = await fixture(t)
  const tab = makeTab()
  const value = makeSession(tab)
  const raw = JSON.stringify(value)
  await fs.mkdir(join(root, 'drafts'), { recursive: true })
  await fs.writeFile(snapshotPath, raw)
  await fs.writeFile(draftPath(tab.id), '未提交的草稿内容')
  const scan = t.mock.method(fs, 'readdir', async () => { throw new Error('不应扫描') })
  const remove = t.mock.method(fs, 'unlink', async () => { throw new Error('不应删除') })
  const open = t.mock.method(fs, 'open', async () => { throw new Error('加载不应改写 legacy 快照') })
  assert.deepEqual(await storage.load(), value)
  assert.equal(await fs.readFile(snapshotPath, 'utf-8'), raw)
  assert.equal(await fs.readFile(draftPath(tab.id), 'utf-8'), '未提交的草稿内容')
  for (const method of [scan, remove, open]) assert.equal(method.mock.callCount(), 0)
})

test('load 的清理目录检查失败不阻断恢复，意图保留至后续重试', async (t) => {
  for (const code of ['EACCES', 'EIO']) {
    await t.test(code, async (child) => {
      const { root, storage, snapshotPath, draftPath } = await fixture(child)
      const tab = makeTab()
      await storage.save(makeSession(tab))
      await fs.writeFile(snapshotPath, JSON.stringify({ ...makeSession(), pendingCleanupIds: [tab.id] }))
      const lstat = fs.lstat.bind(fs)
      child.mock.method(fs, 'lstat', async (...args: Parameters<typeof fs.lstat>) => {
        if (String(args[0]) === join(root, 'drafts')) throw Object.assign(new Error('目录检查失败'), { code })
        return lstat(...args)
      })
      assert.deepEqual(await storage.load(), makeSession())
      assert.deepEqual((await readManifest(snapshotPath)).pendingCleanupIds, [tab.id])
      assert.equal(await fs.readFile(draftPath(tab.id), 'utf-8'), tab.markdown)
      child.mock.restoreAll()
      assert.deepEqual(await new SessionStorage(root).load(), makeSession())
      await assertMissing(draftPath(tab.id))
      assert.deepEqual(await readManifest(snapshotPath), makeSession())
    })
  }
})

test('重启时草稿目录已缺失可幂等确认清理，不影响快照恢复', async (t) => {
  const { root, storage, snapshotPath } = await fixture(t)
  await fs.mkdir(root)
  await fs.writeFile(snapshotPath, JSON.stringify({ ...makeSession(), pendingCleanupIds: [randomUUID()] }))
  assert.deepEqual(await storage.load(), makeSession())
  assert.deepEqual(await readManifest(snapshotPath), makeSession())
  await assertMissing(join(root, 'drafts'))
})

test('根目录不可用时保存拒绝，不退化为内存保存', async (t) => {
  const { root, storage } = await fixture(t)
  await fs.writeFile(root, '不是目录')
  await assert.rejects(storage.save(makeSession(makeTab())))
  await assert.rejects(storage.load())
  assert.equal(await fs.readFile(root, 'utf-8'), '不是目录')
})

test('读取权限或 I/O 错误必须拒绝，不能误判为空会话', async (t) => {
  const { storage } = await fixture(t)
  for (const code of ['EACCES', 'EIO', 'ENOTDIR']) {
    const failure = Object.assign(new Error(code), { code })
    t.mock.method(fs, 'readFile', async () => { throw failure })
    await assert.rejects(storage.load(), (error) => error === failure)
    t.mock.restoreAll()
  }
})

test('损坏 JSON、错误版本或无效快照必须拒绝且保留原始文件', async (t) => {
  const { root, snapshotPath, storage } = await fixture(t)
  await fs.mkdir(root, { recursive: true })
  const tab = makeTab()
  const badSnapshots = [
    '', '{', 'null', '[]', '{}',
    JSON.stringify({ ...makeSession(tab), version: 2 }),
    JSON.stringify(makeSession({ ...tab, id: '../逃逸' })),
    JSON.stringify(makeSession({ ...tab, mode: 'invalid' } as unknown as SessionTab)),
    JSON.stringify(makeSession({ ...tab, savedMtimeMs: null } as unknown as SessionTab)),
    JSON.stringify(makeSession(tab, tab))
  ]
  for (const raw of badSnapshots) {
    await fs.writeFile(snapshotPath, raw)
    await assert.rejects(storage.load())
    assert.equal(await fs.readFile(snapshotPath, 'utf-8'), raw)
  }
})

test('非法 ID、结构及路径在任何磁盘写入前被拒绝', async (t) => {
  const { root, storage } = await fixture(t)
  const tab = makeTab({ id: 'abcdef12-1234-4321-abcd-123456789abc' })
  const invalidIds = ['', 'tab-1', '.', '..', '../逃逸', '..\\逃逸', `${tab.id}/x`,
    `${tab.id}\\x`, `${tab.id}\0`, `${tab.id}.md`, ` ${tab.id}`, `${tab.id}\n`,
    '%2e%2e%2fescape', 'gggggggg-gggg-gggg-gggg-gggggggggggg', join(root, '绝对路径')]
  const invalidValues: unknown[] = [
    null, [], {}, { ...makeSession(tab), version: '1' }, { ...makeSession(tab), version: 2 },
    { ...makeSession(tab), tabs: {} }, { ...makeSession(tab), tabs: [null] },
    { ...makeSession(tab), tabs: new Array(1) },
    ...[-1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '1'].map((untitledSeq) => ({ ...makeSession(tab), untitledSeq })),
    ...[randomUUID(), undefined, 123].map((activeTabId) => ({ ...makeSession(tab), activeTabId })),
    makeSession(tab, { ...tab }), makeSession(tab, { ...tab, id: tab.id.toUpperCase() }),
    ...invalidIds.map((id) => makeSession({ ...tab, id })),
    ...['', 'relative.md', `..${sep}escape.md`, `${root}${sep}..${sep}escape.md`,
      `${root}/../escape.md`, `${root}\\..\\escape.md`, `${root}\0evil.md`, undefined, 1]
      .map((path) => makeSession({ ...tab, path } as SessionTab)),
    ...['', '..', '../文件.md', '路径\\文件.md', '名\0字', 123]
      .map((fileName) => makeSession({ ...tab, fileName } as SessionTab)),
    ...[{ markdown: null }, { dirty: 'true' }, { deleted: 0 }, { mode: 'preview' },
      { savedMtimeMs: Infinity }, { savedMtimeMs: -Infinity }, { savedMtimeMs: NaN }, { savedMtimeMs: '0' }]
      .map((patch) => makeSession({ ...tab, ...patch } as SessionTab))
  ]
  for (const value of invalidValues) {
    await assert.rejects(storage.save(value as EditorSession))
    await assertMissing(root)
  }
})

test('非法 discard 选项及仍在快照中的 ID 必须在所有磁盘写入前拒绝', async (t) => {
  const { base, root, storage, snapshotPath, draftPath } = await fixture(t)
  const tab = makeTab({ id: 'abcdef12-1234-4321-abcd-123456789abc' })
  await storage.save(makeSession(tab))
  const previous = await fs.readFile(snapshotPath, 'utf-8')
  const outside = join(base, '不能删除.md')
  await fs.writeFile(outside, '外部内容')
  const invalid: unknown[] = [
    null, [], 'options', 1,
    ...[null, {}, tab.id, 1, new Array(1), [null], [1], [''], ['../不能删除'], ['..\\不能删除'],
      [outside], [`${tab.id}.md`], [`${tab.id}\n`], [`${tab.id}\r\n`], [`${tab.id}\0`],
      [` ${tab.id}`], [`${tab.id}/x`], [tab.id.replace('a', 'g')], [tab.id, '../不能删除']]
      .map((discardDraftIds) => ({ discardDraftIds }))
  ]
  const open = t.mock.method(fs, 'open', async () => { throw new Error('不应写文件') })
  const mkdir = t.mock.method(fs, 'mkdir', async () => { throw new Error('不应创建目录') })
  const unlink = t.mock.method(fs, 'unlink', async () => { throw new Error('不应删除') })
  for (const options of invalid) {
    await assert.rejects(storage.save(makeSession(), options as SessionSaveOptions))
    await assert.rejects(new SessionStorage(join(root, '新目录')).save(makeSession(), options as SessionSaveOptions))
  }
  for (const path of [null, outside]) {
    await assert.rejects(storage.save(makeSession({ ...tab, path }), { discardDraftIds: [tab.id.toUpperCase()] }), /仍在/)
  }
  assert.equal(open.mock.callCount(), 0)
  assert.equal(mkdir.mock.callCount(), 0)
  assert.equal(unlink.mock.callCount(), 0)
  assert.equal(await fs.readFile(snapshotPath, 'utf-8'), previous)
  assert.equal(await fs.readFile(draftPath(tab.id), 'utf-8'), tab.markdown)
  assert.equal(await fs.readFile(outside, 'utf-8'), '外部内容')
})

test('队列内拒绝已关闭或转正式的迟到快照，拒绝之前不能写入任何草稿', async (t) => {
  for (const action of ['显式丢弃', '缺席关闭', '转正式', '未保存正式', '已删除正式'] as const) {
    for (const failCleanup of [false, true]) {
      await t.test(`${action} / 清理失败=${failCleanup}`, async (child) => {
        const { base, storage, snapshotPath, draftPath } = await fixture(child)
        const tab = makeTab({ id: 'abcdef12-1234-4321-abcd-123456789abc' })
        const retained = makeTab({ markdown: '不能被旧快照覆盖' })
        await storage.save(makeSession(tab, retained))
        const closing = action === '显式丢弃' || action === '缺席关闭'
        const next = closing ? makeSession(retained) : makeSession(retained, {
          ...tab, path: join(base, '正式.md'), dirty: action === '未保存正式', deleted: action === '已删除正式'
        })
        const options = action === '显式丢弃' ? { discardDraftIds: [tab.id.toUpperCase()] } : undefined
        if (failCleanup) child.mock.method(fs, 'unlink', async () => { throw new Error('删除失败') })
        const open = fs.open.bind(fs)
        let committed = false
        let lateDraftWrites = 0
        child.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
          if (committed && dirname(String(args[0])) === dirname(draftPath(tab.id))) lateDraftWrites++
          return open(...args)
        })
        const rename = fs.rename.bind(fs)
        child.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
          const result = await rename(...args)
          if (String(args[1]) === snapshotPath) committed = true
          return result
        })
        const saving = storage.save(next, options)
        const stale = storage.save(makeSession({ ...retained, markdown: '迟到覆盖' }, { ...tab, id: tab.id.toUpperCase() }))
        const rejected = assert.rejects(stale, /迟到快照/)
        await saving
        await rejected
        assert.equal(lateDraftWrites, 0)
        assert.equal(await fs.readFile(draftPath(retained.id), 'utf-8'), retained.markdown)
        assert.deepEqual(await storage.load(), next)
        const manifest = await readManifest(snapshotPath)
        assert.deepEqual(manifest.tabs, next.tabs)
        if (closing) {
          await assert.rejects(storage.save(makeSession({ ...tab, path: join(base, '旧正式.md') })), /迟到快照/)
        }
        if (action === '缺席关闭' || action === '未保存正式' || action === '已删除正式' || failCleanup) {
          assert.equal(await fs.readFile(draftPath(tab.id), 'utf-8'), tab.markdown)
        } else await assertMissing(draftPath(tab.id))
      })
    }
  }
})

test('恢复的正式页签也是已提交身份，不能被同实例旧草稿覆盖', async (t) => {
  const { base, root, storage, draftPath, snapshotPath } = await fixture(t)
  const tab = makeTab()
  const next = makeSession({ ...tab, path: join(base, '正式.md'), dirty: false })
  await storage.save(next)
  const restarted = new SessionStorage(root)
  assert.deepEqual(await restarted.load(), next)
  await assert.rejects(restarted.save(makeSession(tab)), /迟到快照/)
  await assertMissing(draftPath(tab.id))
  assert.deepEqual(await readManifest(snapshotPath), next)
})

test('UUID 大小写使用同一安全草稿路径，序号与有限 mtime 精确保留', async (t) => {
  const { storage, draftPath } = await fixture(t)
  const tab = makeTab({ id: 'ABCDEF12-1234-4321-ABCD-123456789ABC', savedMtimeMs: -123.5 })
  const value = { ...makeSession(tab), untitledSeq: Number.MAX_SAFE_INTEGER }
  await storage.save(value)
  assert.equal(await fs.readFile(draftPath(tab.id), 'utf-8'), tab.markdown)
  assert.deepEqual(await storage.load(), value)
})

test('持久清理 ID 同样严格校验，非法元数据不能造成删除或被保存覆盖', async (t) => {
  const { root, storage, snapshotPath, draftPath } = await fixture(t)
  const tab = makeTab()
  await storage.save(makeSession(tab))
  const open = t.mock.method(fs, 'open', async () => { throw new Error('不应写入') })
  const remove = t.mock.method(fs, 'unlink', async () => { throw new Error('不应删除') })
  for (const ids of [null, tab.id, {}, ['../逃逸'], [join(root, '逃逸.md')], [null], [`${tab.id}\n`]]) {
    const raw = JSON.stringify({ ...makeSession(), pendingCleanupIds: ids })
    await fs.writeFile(snapshotPath, raw)
    await assert.rejects(storage.load(), /UUID|数组/)
    await assert.rejects(storage.save(makeSession()), /UUID|数组/)
    assert.equal(await fs.readFile(snapshotPath, 'utf-8'), raw)
  }
  assert.equal(open.mock.callCount(), 0)
  assert.equal(remove.mock.callCount(), 0)
  assert.equal(await fs.readFile(draftPath(tab.id), 'utf-8'), tab.markdown)
})

test('清理不跟随草稿目录符号链接，仍恢复快照并保留重试意图', async (t) => {
  const { base, root, storage, snapshotPath } = await fixture(t)
  const outside = join(base, '受保护目录')
  const id = randomUUID()
  await fs.mkdir(outside)
  await fs.mkdir(root)
  const protectedPath = join(outside, `${id}.md`)
  await fs.writeFile(protectedPath, '不能删除')
  const manifest = { ...makeSession(), pendingCleanupIds: [id] }
  await fs.writeFile(snapshotPath, JSON.stringify(manifest))
  await fs.symlink(outside, join(root, 'drafts'), process.platform === 'win32' ? 'junction' : 'dir')
  const remove = t.mock.method(fs, 'unlink', async () => { throw new Error('不能尝试删除外部文件') })
  assert.deepEqual(await storage.load(), makeSession())
  assert.equal(remove.mock.callCount(), 0)
  assert.deepEqual(await readManifest(snapshotPath), manifest)
  assert.equal(await fs.readFile(protectedPath, 'utf-8'), '不能删除')
})

test('草稿目录符号链接不能将写入重定向到存储目录以外', async (t) => {
  const { base, root, storage } = await fixture(t)
  const outside = join(base, '外部目录')
  await fs.mkdir(outside)
  await fs.mkdir(root)
  await fs.symlink(outside, join(root, 'drafts'), process.platform === 'win32' ? 'junction' : 'dir')
  await assert.rejects(storage.save(makeSession(makeTab())), /符号链接/)
  assert.deepEqual(await fs.readdir(outside), [])
  await assertMissing(join(root, 'session.json'))
})
