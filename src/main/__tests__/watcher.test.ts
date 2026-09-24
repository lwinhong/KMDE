import assert from 'node:assert/strict'
import { EventEmitter, once } from 'node:events'
import { promises as fs, type Stats } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test, type TestContext } from 'node:test'
import chokidar, { type ChokidarOptions, type FSWatcher } from 'chokidar'
import { WatcherManager } from '../watcher.ts'
import { IGNORED_DIR_NAMES } from '../../shared/types.ts'
import type { FsEvent } from '../../shared/types.ts'

class FakeWatcher extends EventEmitter {
  added: string[][] = []
  removed: string[][] = []
  closes = 0
  add(paths: string[]): this { this.added.push(paths); return this }
  unwatch(paths: string[]): this { this.removed.push(paths); return this }
  async close(): Promise<void> { this.closes += 1 }
}

function stats(mtimeMs: number, kind: 'file' | 'dir' | 'link' = 'file'): Stats {
  return {
    mtimeMs,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir',
    isSymbolicLink: () => kind === 'link'
  } as Stats
}

function fixture(t: TestContext) {
  const events: FsEvent[] = []
  const watches: Array<{ watcher: FakeWatcher; paths: string | string[]; options: ChokidarOptions }> = []
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  t.mock.method(chokidar, 'watch', (paths: string | string[], options: ChokidarOptions) => {
    const watcher = new FakeWatcher()
    watches.push({ watcher, paths, options })
    return watcher as unknown as FSWatcher
  })
  const manager = new WatcherManager((event) => events.push(event))
  t.after(() => { manager.stop(); manager.setOpenFiles([]) })
  return { manager, watches, events, flush: () => t.mock.timers.tick(150) }
}

const root = resolve('watcher-fixture')
const file = join(root, '文档.md')
const external = resolve('outside-fixture', '独立.md')

test('启动不等待 ready，重复工作区不重建，切换捕获 generation 阻止旧回调', (t) => {
  const { manager, watches, events, flush } = fixture(t)
  assert.equal(manager.watch(root), undefined)
  assert.equal(manager.currentRoot, root)
  assert.equal(watches[0].watcher.listenerCount('ready'), 0)
  manager.watch(join(root, '.'))
  assert.equal(watches.length, 1)
  watches[0].watcher.emit('change', file, stats(10))
  manager.watch(external)
  watches[0].watcher.emit('change', file, stats(20))
  watches[1].watcher.emit('change', external, stats(30))
  flush()
  assert.deepEqual(events, [{ type: 'change', path: external, mtimeMs: 30 }])
  assert.equal(watches[0].watcher.closes, 1)
  manager.stop()
  watches[1].watcher.emit('unlink', external)
  flush()
  assert.equal(events.length, 1)
  assert.equal(manager.currentRoot, null)
})

test('独立文件跨工作区持续监听，stop 不清理文档防抖和自写入标记', (t) => {
  const { manager, watches, events, flush } = fixture(t)
  manager.setOpenFiles([external])
  manager.watch(root)
  const independent = watches[0].watcher
  independent.emit('change', external, stats(10))
  manager.markSelfWrite(external, 20)
  manager.stop()
  flush()
  assert.deepEqual(events, [{ type: 'change', path: external, mtimeMs: 10 }])
  assert.equal(independent.closes, 0)
  independent.emit('change', external, stats(20))
  flush()
  assert.equal(events.length, 1)
  manager.watch(join(root, 'new'))
  independent.emit('unlink', external)
  flush()
  assert.equal(events.at(-1)?.type, 'unlink')
})

test('相同文件集合、顺序和重复路径不重建；变更只增量 add/unwatch', (t) => {
  const { manager, watches, events, flush } = fixture(t)
  manager.setOpenFiles([file, external])
  const watcher = watches[0].watcher
  manager.setOpenFiles([external, join(root, '.', '文档.md'), external])
  if (process.platform === 'win32') manager.setOpenFiles([file.toUpperCase(), external.toUpperCase()])
  assert.equal(watches.length, 1)
  assert.deepEqual(watcher.added, [])
  assert.deepEqual(watcher.removed, [])
  const added = join(root, '新增.md')
  watcher.emit('change', file, stats(10))
  manager.setOpenFiles([external, added])
  assert.deepEqual(watcher.removed, [[file]])
  assert.deepEqual(watcher.added, [[added]])
  watcher.emit('change', file, stats(20))
  watcher.emit('add', added, stats(30))
  flush()
  assert.deepEqual(events, [{ type: 'add', path: added, mtimeMs: 30 }])
  manager.setOpenFiles([])
  assert.equal(watcher.closes, 1)
  manager.setOpenFiles([file])
  watcher.emit('change', file, stats(40))
  watches[1].watcher.emit('change', file, stats(50))
  flush()
  assert.equal(events.at(-1)?.mtimeMs, 50)
  assert.equal(events.length, 2)
})

test('取消再添加同一路径不投递旧防抖事件', (t) => {
  const { manager, watches, events, flush } = fixture(t)
  manager.setOpenFiles([file, external])
  watches[0].watcher.emit('change', file, stats(10))
  manager.setOpenFiles([external])
  manager.setOpenFiles([external, file])
  flush()
  assert.deepEqual(events, [])
  assert.equal(watches.length, 1)
})

test('工作区与打开文件的重叠事件统一防抖，延迟重复也只投递一次', (t) => {
  const { manager, watches, events, flush } = fixture(t)
  manager.watch(root)
  manager.setOpenFiles([file])
  const workspace = watches[0].watcher
  const independent = watches[1].watcher
  workspace.emit('change', file, stats(10))
  independent.emit('change', file, stats(10))
  flush()
  assert.equal(events.length, 1)
  workspace.emit('change', file, stats(20))
  flush()
  independent.emit('change', file, stats(20))
  flush()
  assert.equal(events.length, 2)
  independent.emit('change', file, stats(30))
  flush()
  workspace.emit('change', file, stats(30))
  flush()
  assert.equal(events.length, 3)
  workspace.emit('unlink', file)
  independent.emit('unlink', file)
  flush()
  assert.equal(events.at(-1)?.type, 'unlink')
  assert.equal(events.length, 4)
  independent.emit('add', file, stats(40))
  workspace.emit('add', file, stats(40))
  manager.stop()
  flush()
  assert.equal(events.at(-1)?.type, 'add')
  assert.equal(events.length, 5)
})

test('另一来源迟到的旧事件不能覆盖防抖中的新版本', (t) => {
  const { manager, watches, events, flush } = fixture(t)
  manager.watch(root)
  manager.setOpenFiles([file])
  watches[0].watcher.emit('change', file, stats(10))
  flush()
  watches[0].watcher.emit('change', file, stats(20))
  watches[1].watcher.emit('change', file, stats(10))
  flush()
  assert.deepEqual(events.map((event) => event.mtimeMs), [10, 20])
})

test('新建后连续修改仍报告 add，删除后仅收到 change 也能识别重建', (t) => {
  const { manager, watches, events, flush } = fixture(t)
  manager.setOpenFiles([file])
  const watcher = watches[0].watcher
  watcher.emit('add', file, stats(10))
  watcher.emit('change', file, stats(20))
  flush()
  assert.deepEqual(events, [{ type: 'add', path: file, mtimeMs: 20 }])
  watcher.emit('unlink', file)
  flush()
  watcher.emit('change', file, stats(30))
  flush()
  assert.deepEqual(events.at(-1), { type: 'add', path: file, mtimeMs: 30 })
})

test('连续不同 mtime 取最后一次，两路自写入均被抑制，后续外部修改正常投递', (t) => {
  const { manager, watches, events, flush } = fixture(t)
  manager.watch(root)
  manager.setOpenFiles([file])
  manager.markSelfWrite(file, 100)
  for (const { watcher } of watches) watcher.emit('change', file, stats(101))
  flush()
  assert.deepEqual(events, [])
  watches[0].watcher.emit('change', file, stats(110))
  t.mock.timers.tick(80)
  watches[1].watcher.emit('change', file, stats(120))
  t.mock.timers.tick(80)
  assert.deepEqual(events, [])
  flush()
  assert.deepEqual(events, [{ type: 'change', path: file, mtimeMs: 120 }])
})

test('工作区过滤与目录枚举一致，无 stats 也过滤隐藏路径；根目录自身不误过滤', (t) => {
  const { manager, watches, events, flush } = fixture(t)
  const hiddenRoot = join(root, '.parent', 'dist')
  manager.watch(hiddenRoot)
  const ignored = watches[0].options.ignored as (path: string, stats?: Stats) => boolean
  assert.equal(watches[0].options.followSymlinks, false)
  assert.equal(watches[0].options.ignoreInitial, true)
  assert.equal(ignored(hiddenRoot), false)
  assert.equal(ignored(dirname(hiddenRoot)), false)
  assert.equal(ignored(join(hiddenRoot, 'visible.md'), stats(1)), false)
  for (const name of [...IGNORED_DIR_NAMES, '.env', '.hidden']) {
    const path = join(hiddenRoot, name)
    assert.equal(ignored(path), true)
    assert.equal(ignored(path, stats(1)), true)
    assert.equal(ignored(join(path, 'nested.md')), true)
    watches[0].watcher.emit('unlink', path)
  }
  assert.equal(ignored(join(hiddenRoot, 'link'), stats(1, 'link')), true)
  watches[0].watcher.emit('add', join(hiddenRoot, 'link'), stats(1, 'link'))
  watches[0].watcher.emit('change', external, stats(1))
  flush()
  assert.deepEqual(events, [])
})

test('显式打开的隐藏或忽略目录内文件可监听，不递归其兄弟目录或符号链接', (t) => {
  const { manager, watches, events, flush } = fixture(t)
  const hidden = join(root, 'node_modules', '.hidden.md')
  manager.setOpenFiles([hidden])
  const ignored = watches[0].options.ignored as (path: string, stats?: Stats) => boolean
  assert.equal(watches[0].options.depth, 0)
  assert.equal(watches[0].options.followSymlinks, false)
  assert.equal(ignored(hidden, stats(1)), false)
  assert.equal(ignored(dirname(hidden), stats(1, 'dir')), false)
  assert.equal(ignored(join(dirname(hidden), 'unrelated.md'), stats(1)), true)
  assert.equal(ignored(hidden, stats(1, 'link')), true)
  watches[0].watcher.emit('change', file, stats(1))
  watches[0].watcher.emit('change', hidden, stats(1, 'link'))
  watches[0].watcher.emit('addDir', hidden)
  watches[0].watcher.emit('change', hidden, stats(2))
  flush()
  assert.deepEqual(events, [{ type: 'change', path: hidden, mtimeMs: 2 }])
})

test('异步 close 拒绝及同步异常被处理，关闭完成前旧监听不能投递', async (t) => {
  const { manager, watches, events, flush } = fixture(t)
  const errors: unknown[][] = []
  t.mock.method(console, 'error', (...args: unknown[]) => errors.push(args))
  manager.watch(root)
  manager.setOpenFiles([file])
  const failure = new Error('关闭失败')
  t.mock.method(watches[0].watcher, 'close', async () => { throw failure })
  t.mock.method(watches[1].watcher, 'close', () => { throw failure })
  manager.stop()
  manager.setOpenFiles([])
  for (const { watcher } of watches) watcher.emit('change', file, stats(1))
  await Promise.resolve()
  await Promise.resolve()
  flush()
  assert.deepEqual(events, [])
  assert.equal(errors.length, 2)
  assert.ok(errors.every((args) => args[1] === failure))
})

test('真实 chokidar：增量打开文件在工作区停止后仍报告修改、删除和重建', { timeout: 15000 }, async (t) => {
  const base = await fs.mkdtemp(join(tmpdir(), 'kmde-watcher-'))
  const work = join(base, 'workspace')
  const hidden = join(base, '.outside', '.doc.md')
  const other = join(base, 'other.md')
  const realWatch = chokidar.watch.bind(chokidar)
  const watches: FSWatcher[] = []
  t.mock.method(chokidar, 'watch', (...args: Parameters<typeof chokidar.watch>) => {
    const watcher = realWatch(...args)
    watches.push(watcher)
    return watcher
  })
  const delivered = new EventEmitter()
  const manager = new WatcherManager((event) => delivered.emit('event', event))
  t.after(async () => {
    manager.stop()
    manager.setOpenFiles([])
    await Promise.all(watches.map((watcher) => watcher.close()))
    await fs.rm(base, { recursive: true, force: true })
  })
  await fs.mkdir(work)
  await fs.mkdir(dirname(hidden))
  await fs.writeFile(hidden, '初始')
  await fs.writeFile(other, '初始')
  manager.setOpenFiles([other])
  manager.watch(work)
  await Promise.all(watches.map((watcher) => once(watcher, 'ready')))
  manager.setOpenFiles([hidden, other])
  // 增量 add 没有第二次 ready，等待实际文件监听建立。
  const deadline = Date.now() + 3000
  while (!watches[0].getWatched()[dirname(hidden)]?.includes('.doc.md')) {
    assert.ok(Date.now() < deadline, '增量文件监听应建立')
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  manager.stop()
  manager.setOpenFiles([hidden])
  const expectEvent = async (type: FsEvent['type'], action: () => Promise<void>): Promise<void> => {
    const next = once(delivered, 'event', { signal: AbortSignal.timeout(4000) })
    await action()
    const [event] = await next as [FsEvent]
    assert.equal(event.path, hidden)
    assert.equal(event.type, type)
  }
  await expectEvent('change', () => fs.writeFile(hidden, '修改'))
  await expectEvent('unlink', () => fs.unlink(hidden))
  await expectEvent('add', () => fs.writeFile(hidden, '重建'))
})
