import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { TestContext } from 'node:test'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { WorkspaceIndexer } from '../workspaceIndex.ts'
import type { WorkspaceIndexChunk } from '../../shared/types.ts'

function makeDir(t: TestContext): Promise<string> {
  const dir = fs.mkdtemp(join(tmpdir(), 'kmde-index-'))
  t.after(() => dir.then((path) => fs.rm(path, { recursive: true, force: true })))
  return dir
}

function collectUntilDone(indexer: WorkspaceIndexer, root: string): Promise<WorkspaceIndexChunk[]> {
  return new Promise((resolve) => {
    const chunks: WorkspaceIndexChunk[] = []
    indexer.start(root, (chunk) => {
      chunks.push(chunk)
      if (chunk.done) resolve(chunks)
    })
  })
}

test('遍历收集受支持文档，忽略隐藏目录与忽略名单，relPath 用正斜杠', async (t) => {
  const root = await makeDir(t)
  await fs.mkdir(join(root, 'sub'))
  await fs.mkdir(join(root, 'node_modules'))
  await fs.mkdir(join(root, '.hidden'))
  await fs.writeFile(join(root, 'a.md'), 'x')
  await fs.writeFile(join(root, 'sub', 'b.markdown'), 'x')
  await fs.writeFile(join(root, 'sub', 'c.txt'), 'x')
  await fs.writeFile(join(root, 'sub', 'd.exe'), 'x')
  await fs.writeFile(join(root, 'node_modules', 'e.md'), 'x')
  await fs.writeFile(join(root, '.hidden', 'f.md'), 'x')

  const chunks = await collectUntilDone(new WorkspaceIndexer(), root)
  const relPaths = chunks.flatMap((chunk) => chunk.entries).map((entry) => entry.relPath).sort()
  assert.deepEqual(relPaths, ['a.md', 'sub/b.markdown', 'sub/c.txt'])
  assert.ok(!relPaths.some((path) => path.includes('\\')), 'relPath 不允许出现平台分隔符')
  assert.ok(chunks.length >= 1)
  assert.ok(chunks.at(-1)!.done, '最后一个分块必须标记 done')
  assert.ok(chunks.slice(0, -1).every((chunk) => !chunk.done), 'done 只能出现一次')
})

test('超过 chunkSize 时分块推送且不丢条目', async (t) => {
  const root = await makeDir(t)
  for (let i = 0; i < 7; i++) {
    await fs.writeFile(join(root, `${i}.md`), 'x')
  }
  const indexer = new WorkspaceIndexer({ chunkSize: 2 })
  const chunks = await collectUntilDone(indexer, root)
  const entries = chunks.flatMap((chunk) => chunk.entries)
  assert.equal(entries.length, 7)
  assert.ok(chunks.length >= 4, '每 2 条至少一个分块，外加 done 收尾')
  const paths = new Set(entries.map((entry) => entry.path))
  for (let i = 0; i < 7; i++) assert.ok(paths.has(join(root, `${i}.md`)))
})

test('maxDirs 截断遍历范围', async (t) => {
  const root = await makeDir(t)
  await fs.writeFile(join(root, 'root.md'), 'x')
  for (let i = 0; i < 10; i++) {
    await fs.mkdir(join(root, `d${i}`))
    await fs.writeFile(join(root, `d${i}`, 'x.md'), 'x')
  }
  const indexer = new WorkspaceIndexer({ maxDirs: 3, concurrency: 2 })
  const chunks = await collectUntilDone(indexer, root)
  const relPaths = chunks.flatMap((chunk) => chunk.entries).map((entry) => entry.relPath).sort()
  // 队列上限 3：根目录 + d0 + d1，其余子目录不再入队。
  assert.deepEqual(relPaths, ['d0/x.md', 'd1/x.md', 'root.md'])
})

test('不可读目录按空处理，扫描仍正常收尾', async (t) => {
  const root = await makeDir(t)
  await fs.writeFile(join(root, 'a.md'), 'x')
  const indexer = new WorkspaceIndexer()
  const chunks = await collectUntilDone(indexer, join(root, 'not-exists'))
  assert.equal(chunks.at(-1)!.done, true)
  assert.deepEqual(chunks.flatMap((chunk) => chunk.entries), [])
})

test('start 新任务立即作废旧任务，旧任务不再推送', async (t) => {
  const bigRoot = await makeDir(t)
  for (let i = 0; i < 120; i++) {
    await fs.mkdir(join(bigRoot, `d${i}`))
    await fs.writeFile(join(bigRoot, `d${i}`, 'x.md'), 'x')
  }
  const smallRoot = await makeDir(t)
  await fs.writeFile(join(smallRoot, 'only.md'), 'x')

  const indexer = new WorkspaceIndexer({ concurrency: 1, chunkSize: 1 })
  const received: WorkspaceIndexChunk[] = []
  indexer.start(bigRoot, (chunk) => received.push(chunk))
  // 等旧任务确实开始推送后再启动新任务。
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (received.length > 0) {
        clearInterval(check)
        resolve()
      }
    }, 1)
  })
  const before = received.length
  const generation = indexer.start(smallRoot, (chunk) => received.push(chunk))
  const doneIndex = await new Promise<number>((resolve) => {
    const start = received.length
    const check = setInterval(() => {
      for (let i = start; i < received.length; i++) {
        if (received[i].generation === generation && received[i].done) {
          clearInterval(check)
          resolve(i)
          return
        }
      }
    }, 1)
  })
  const staleCount = received.filter((chunk) => chunk.generation !== generation).length
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(received.filter((chunk) => chunk.generation !== generation).length, staleCount, '旧任务被作废后不再推送')
  assert.ok(received.slice(doneIndex).every((chunk) => chunk.generation === generation))
  const smallEntries = received
    .filter((chunk) => chunk.generation === generation)
    .flatMap((chunk) => chunk.entries)
  assert.deepEqual(smallEntries.map((entry) => entry.relPath), ['only.md'])
})

test('cancel 停止推送且不发送 done', async (t) => {
  const bigRoot = await makeDir(t)
  for (let i = 0; i < 120; i++) {
    await fs.mkdir(join(bigRoot, `d${i}`))
    await fs.writeFile(join(bigRoot, `d${i}`, 'x.md'), 'x')
  }
  const indexer = new WorkspaceIndexer({ concurrency: 1, chunkSize: 1 })
  const received: WorkspaceIndexChunk[] = []
  indexer.start(bigRoot, (chunk) => received.push(chunk))
  await new Promise<void>((resolve) => {
    const check = setInterval(() => {
      if (received.length > 0) {
        clearInterval(check)
        resolve()
      }
    }, 1)
  })
  indexer.cancel()
  const count = received.length
  assert.ok(count > 0, '取消前任务已在推送')
  assert.ok(!received.some((chunk) => chunk.done), '取消的任务不得发送 done')
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(received.length, count, '取消后不再推送任何分块')
})
