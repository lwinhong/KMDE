import assert from 'node:assert/strict'
import { promises as fs, type Dirent } from 'node:fs'
import { join, resolve } from 'node:path'
import { test } from 'node:test'
import { IGNORED_DIR_NAMES } from '../../shared/types.ts'
import { isIgnoredWorkspaceName, listWorkspaceDir } from '../workspaceFiles.ts'

function entry(name: string, kind: 'file' | 'dir' | 'link' | 'other' = 'file'): Dirent {
  return {
    name,
    isFile: () => kind === 'file',
    isDirectory: () => kind === 'dir',
    isSymbolicLink: () => kind === 'link'
  } as Dirent
}

const root = resolve('workspace-fixture')

test('目录枚举仅调用带 withFileTypes 的 readdir，不逐项 stat 或 lstat', async (t) => {
  const read = t.mock.method(fs, 'readdir', async (dir: unknown, options: unknown) => {
    assert.equal(dir, root)
    assert.deepEqual(options, { withFileTypes: true })
    return [entry('目录', 'dir'), entry('普通文件.MD'), entry('image.png'), entry('LICENSE')]
  })
  const stat = t.mock.method(fs, 'stat', () => { throw new Error('不能调用 stat') })
  const lstat = t.mock.method(fs, 'lstat', () => { throw new Error('不能调用 lstat') })
  const nodes = await listWorkspaceDir(root)
  assert.equal(read.mock.callCount(), 1)
  assert.equal(stat.mock.callCount(), 0)
  assert.equal(lstat.mock.callCount(), 0)
  assert.equal(nodes.length, 2)
  assert.deepEqual(nodes.find((node) => node.name === '普通文件.MD'), {
    name: '普通文件.MD', path: join(root, '普通文件.MD'), isDir: false, ext: '.md'
  })
  assert.equal(nodes.some((node) => node.name === 'image.png' || node.name === 'LICENSE'), false)
  assert.ok(nodes.every((node) => !Object.hasOwn(node, 'size')))
})

test('过滤共用忽略名称、隐藏文件及目录、符号链接和特殊文件', async (t) => {
  t.mock.method(fs, 'readdir', async () => [
    ...[...IGNORED_DIR_NAMES].map((name) => entry(name, 'dir')),
    entry('dist'), entry('.env'), entry('.hidden', 'dir'), entry('linked-dir', 'link'),
    entry('linked-file.md', 'link'), entry('socket', 'other'), entry('visible.md')
  ])
  assert.deepEqual((await listWorkspaceDir(root)).map((node) => node.name), ['visible.md'])
  for (const name of IGNORED_DIR_NAMES) assert.equal(isIgnoredWorkspaceName(name), true)
  assert.equal(isIgnoredWorkspaceName('.secret'), true)
  assert.equal(isIgnoredWorkspaceName('output'), false)
  assert.equal(isIgnoredWorkspaceName('dist.md'), false)
})

test('目录优先，每组沿用 zh-CN 排序，重复调用复用 Collator', async (t) => {
  const names = ['中文', 'alpha', '文件', 'Beta', 'item10', 'item2']
  const compare = new Intl.Collator('zh-CN').compare
  t.mock.method(fs, 'readdir', async () => [
    ...names.map((name) => entry(`${name}.md`)), ...names.map((name) => entry(name, 'dir'))
  ])
  const collator = t.mock.method(Intl, 'Collator', () => { throw new Error('不能重复构造 Collator') })
  const localeCompare = t.mock.method(String.prototype, 'localeCompare', () => {
    throw new Error('不能逐次使用 localeCompare')
  })
  const expected = [...names.sort(compare), ...names.map((name) => `${name}.md`).sort(compare)]
  assert.deepEqual((await listWorkspaceDir(root)).map((node) => node.name), expected)
  assert.deepEqual((await listWorkspaceDir(root)).map((node) => node.name), expected)
  assert.equal(collator.mock.callCount(), 0)
  assert.equal(localeCompare.mock.callCount(), 0)
})

test('巨大目录即使都是过滤项也会批次让出事件循环', async (t) => {
  t.mock.method(fs, 'readdir', async () => Array.from({ length: 10_000 }, (_, index) => entry(`.${index}`)))
  let yielded = false
  const immediate = setImmediate(() => { yielded = true })
  t.after(() => clearImmediate(immediate))
  assert.deepEqual(await listWorkspaceDir(root), [])
  assert.equal(yielded, true)
})

test('可见大目录分批排序仍保持目录优先及 Collator 顺序', async (t) => {
  const entries = Array.from({ length: 8193 }, (_, index) => entry(
    `${8193 - index}中文.md`, index % 3 === 0 ? 'dir' : 'file'
  ))
  t.mock.method(fs, 'readdir', async () => entries)
  const compare = new Intl.Collator('zh-CN').compare
  const expected = [...entries].sort((a, b) =>
    Number(b.isDirectory()) - Number(a.isDirectory()) || compare(a.name, b.name))
  let turns = 0
  let immediate: NodeJS.Immediate
  const tick = (): void => { turns += 1; immediate = setImmediate(tick) }
  immediate = setImmediate(tick)
  t.after(() => clearImmediate(immediate))
  const nodes = await listWorkspaceDir(root)
  assert.deepEqual(nodes.map((node) => node.name), expected.map((item) => item.name))
  assert.ok(turns > Math.floor(entries.length / 2048), '排序阶段也必须让出事件循环')
})

test('仅显示支持的文档扩展名且忽略大小写，普通文件夹无论名称均保留', async (t) => {
  const supported = ['说明.md', 'README.MD', '长文.MarkDown', '笔记.MDOWN', '草稿.Txt']
  const hidden = ['image.png', 'data.json', 'main.ts', 'index.html', 'report.pdf', 'archive.md.zip', 'LICENSE']
  t.mock.method(fs, 'readdir', async () => [
    ...supported.map((name) => entry(name)), ...hidden.map((name) => entry(name)),
    entry('assets', 'dir'), entry('目录.json', 'dir')
  ])
  const nodes = await listWorkspaceDir(root)
  assert.deepEqual(nodes.filter((node) => node.isDir).map((node) => node.name).sort(), ['assets', '目录.json'].sort())
  assert.deepEqual(nodes.filter((node) => !node.isDir).map((node) => node.name).sort(), supported.sort())
})

test('空目录返回空数组，读取失败保持拒绝', async (t) => {
  t.mock.method(fs, 'readdir', async () => [])
  assert.deepEqual(await listWorkspaceDir(root), [])
  const failure = Object.assign(new Error('读取失败'), { code: 'EACCES' })
  t.mock.method(fs, 'readdir', async () => { throw failure })
  await assert.rejects(listWorkspaceDir(root), (error) => error === failure)
})
