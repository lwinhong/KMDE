import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, sep } from 'node:path'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { SessionStorage } from './session.ts'
import type { EditorSession, SessionTab } from '../shared/types'

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

test('仅缺少快照返回新会话，空会话也能往返', async (t) => {
  const { root, storage } = await fixture(t)
  assert.equal(await storage.load(), null)
  await assertMissing(root)
  const empty = makeSession()
  assert.equal(await storage.save(empty), undefined)
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

test('save 在调用时复制快照，不受排队期间对象修改影响', async (t) => {
  const { storage } = await fixture(t)
  const value = makeSession(makeTab())
  const expected = structuredClone(value)
  const saving = storage.save(value)
  value.tabs[0].markdown = '不应被保存'
  value.tabs.length = 0
  value.activeTabId = null
  await saving
  assert.deepEqual(await storage.load(), expected)
})

test('关闭页签及保存空会话不会清理未命名草稿', async (t) => {
  const { storage, root, draftPath } = await fixture(t)
  const first = makeTab()
  const second = makeTab({ markdown: '第二份草稿' })
  await storage.save(makeSession(first, second))
  await storage.save(makeSession(second))
  await new SessionStorage(root).save(makeSession())
  assert.equal(await fs.readFile(draftPath(first.id), 'utf-8'), first.markdown)
  assert.equal(await fs.readFile(draftPath(second.id), 'utf-8'), second.markdown)
  assert.deepEqual(await storage.load(), makeSession())
})

test('转正式路径仍 dirty 时保留草稿，干净快照提交之后只清理同 ID 草稿', async (t) => {
  const { base, root, storage, draftPath } = await fixture(t)
  const first = makeTab()
  const closed = makeTab({ markdown: '已关闭草稿' })
  await storage.save(makeSession(first, closed))
  const named = { ...first, path: join(base, '正式文档.md'), markdown: '正式文档内容' }
  await storage.save(makeSession(named))
  assert.equal(await fs.readFile(draftPath(first.id), 'utf-8'), first.markdown)
  await fs.writeFile(named.path, named.markdown)
  const committed = makeSession({ ...named, dirty: false })
  const unlink = fs.unlink.bind(fs)
  t.mock.method(fs, 'unlink', async (...args: Parameters<typeof fs.unlink>) => {
    assert.deepEqual(await new SessionStorage(root).load(), committed)
    return unlink(...args)
  })
  await new SessionStorage(root).save(committed)
  await assertMissing(draftPath(first.id))
  assert.equal(await fs.readFile(draftPath(closed.id), 'utf-8'), closed.markdown)
  await storage.save(committed)
})

test('任意写入阶段失败不破坏已提交快照、不清理草稿，失败后仍可保存', async (t) => {
  for (const target of ['草稿', '会话'] as const) {
    for (const stage of ['open', 'writeFile', 'sync', 'close', 'rename'] as const) {
      await t.test(`${target} ${stage} 失败`, async (child) => {
        const { base, storage, snapshotPath, draftPath } = await fixture(child)
        const first = makeTab()
        const second = makeTab({ markdown: '旧草稿' })
        const previous = makeSession(first, second)
        await storage.save(previous)
        const next = makeSession(
          { ...first, path: join(base, '已另存.md'), dirty: false },
          { ...second, markdown: '新草稿' }
        )
        const destination = target === '草稿' ? draftPath(second.id) : snapshotPath
        const failure = Object.assign(new Error(`${target} ${stage} 磁盘故障`), { code: 'EIO' })
        const open = fs.open.bind(fs)
        const rename = fs.rename.bind(fs)
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
        await assert.rejects(storage.save(next), (error) => error === failure)
        assert.deepEqual(await storage.load(), previous)
        assert.equal(await fs.readFile(draftPath(first.id), 'utf-8'), first.markdown)
        assert.equal(await fs.readFile(draftPath(second.id), 'utf-8'), target === '草稿' ? '旧草稿' : '新草稿')
        child.mock.restoreAll()
        await storage.save(next)
        assert.deepEqual(await storage.load(), next)
        await assertMissing(draftPath(first.id))
      })
    }
  }
})

test('提交后清理失败向调用方拒绝，快照与未清理草稿仍在，重试可完成', async (t) => {
  const { base, storage, draftPath } = await fixture(t)
  const tab = makeTab()
  await storage.save(makeSession(tab))
  const next = makeSession({ ...tab, path: join(base, '正式.md'), dirty: false })
  const failure = Object.assign(new Error('清理失败'), { code: 'EACCES' })
  t.mock.method(fs, 'unlink', async () => { throw failure })
  await assert.rejects(storage.save(next), (error) => error === failure)
  assert.deepEqual(await storage.load(), next)
  assert.equal(await fs.readFile(draftPath(tab.id), 'utf-8'), tab.markdown)
  t.mock.restoreAll()
  await storage.save(next)
  await assertMissing(draftPath(tab.id))
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

test('UUID 大小写使用同一安全草稿路径，序号与有限 mtime 精确保留', async (t) => {
  const { storage, draftPath } = await fixture(t)
  const tab = makeTab({ id: 'ABCDEF12-1234-4321-ABCD-123456789ABC', savedMtimeMs: -123.5 })
  const value = { ...makeSession(tab), untitledSeq: Number.MAX_SAFE_INTEGER }
  await storage.save(value)
  assert.equal(await fs.readFile(draftPath(tab.id), 'utf-8'), tab.markdown)
  assert.deepEqual(await storage.load(), value)
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
