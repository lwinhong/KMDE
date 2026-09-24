import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { after, mock, test, type TestContext } from 'node:test'
import { DEFAULT_SETTINGS } from '../../shared/types.ts'
import type { AppSettings } from '../../shared/types.ts'

let systemLocale = 'en-US'
const electron = mock.module('electron', {
  exports: {
    app: {
      getLocale: () => systemLocale,
      getPath: () => { throw new Error('不能改变现有设置路径') }
    }
  }
})
after(() => electron.restore())

async function fixture(t: TestContext) {
  const base = await fs.mkdtemp(join(tmpdir(), 'kmde-settings-'))
  const previous = process.env['APPDATA']
  process.env['APPDATA'] = base
  systemLocale = 'en-US'
  const settings: typeof import('../settings.ts') = await import(`../settings.ts?test=${randomUUID()}`)
  t.after(async () => {
    if (previous === undefined) delete process.env['APPDATA']
    else process.env['APPDATA'] = previous
    await fs.rm(base, { recursive: true, force: true })
  })
  return { settings, base, path: join(base, 'kmde', 'settings.json') }
}

function snapshot(overrides: Partial<AppSettings> = {}): AppSettings {
  return { ...DEFAULT_SETTINGS, ...overrides }
}

test('设置路径保持 APPDATA/kmde/settings.json，缺失文件使用独立默认副本及系统语言', async (t) => {
  const { settings, base, path } = await fixture(t)
  assert.equal(settings.getSettingsPath(), path)
  process.env['APPDATA'] = join(base, 'changed')
  assert.equal(settings.getSettingsPath(), path)
  const first = await settings.readSettings()
  assert.deepEqual(first, snapshot({ language: 'en-US' }))
  first.fontSize = 99
  systemLocale = 'zh-HK'
  assert.deepEqual(await settings.readSettings(), snapshot())
  await assert.rejects(fs.stat(path), { code: 'ENOENT' })
  assert.equal(settings.getCurrentLocale(), DEFAULT_SETTINGS.language)
  settings.setCurrentLocale('en-US')
  assert.equal(settings.getCurrentLocale(), 'en-US')
})

test('无 APPDATA 时仍按 cwd/kmde/settings.json 计算路径，不创建文件', async (t) => {
  const { settings } = await fixture(t)
  delete process.env['APPDATA']
  assert.equal(settings.getSettingsPath(), join(process.cwd(), 'kmde', 'settings.json'))
})

test('部分设置与默认值合并，保存语言优先，损坏或非对象 JSON 安全回退', async (t) => {
  const { settings, path } = await fixture(t)
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, JSON.stringify({ fontSize: 21, language: 'zh-CN' }))
  assert.deepEqual(await settings.readSettings(), snapshot({ fontSize: 21 }))
  for (const raw of ['{broken', 'null', '[]', '42']) {
    await fs.writeFile(path, raw)
    assert.deepEqual(await settings.readSettings(), snapshot({ language: 'en-US' }))
    assert.equal(await fs.readFile(path, 'utf-8'), raw)
  }
})

test('原子写按同目录独占 tmp、write、fsync、close、rename 顺序，不直接覆盖目标', async (t) => {
  const { settings, path } = await fixture(t)
  const original = snapshot({ fontSize: 10 })
  const updated = snapshot({ fontSize: 22 })
  await settings.writeSettings(original)
  const steps: string[] = []
  const open = fs.open.bind(fs)
  const rename = fs.rename.bind(fs)
  let temporary = ''
  t.mock.method(fs, 'writeFile', () => { throw new Error('不能直接覆盖目标') })
  t.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
    temporary = String(args[0])
    assert.equal(dirname(temporary), dirname(path))
    assert.ok(basename(temporary).startsWith('.settings.json.'))
    assert.ok(temporary.endsWith('.tmp'))
    assert.equal(args[1], 'wx')
    assert.equal(args[2], 0o600)
    steps.push('open')
    const handle = await open(...args)
    const write = handle.writeFile.bind(handle)
    const sync = handle.sync.bind(handle)
    const close = handle.close.bind(handle)
    t.mock.method(handle, 'writeFile', async (...values: Parameters<typeof handle.writeFile>) => {
      steps.push('write')
      return write(...values)
    })
    t.mock.method(handle, 'sync', async () => { steps.push('sync'); return sync() })
    t.mock.method(handle, 'close', async () => { steps.push('close'); return close() })
    return handle
  })
  t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
    steps.push('rename')
    assert.equal(args[0], temporary)
    assert.equal(args[1], path)
    assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf-8')), original)
    assert.deepEqual(JSON.parse(await fs.readFile(temporary, 'utf-8')), updated)
    return rename(...args)
  })
  await settings.writeSettings(updated)
  assert.deepEqual(steps, ['open', 'write', 'sync', 'close', 'rename'])
  assert.deepEqual(await settings.readSettings(), updated)
  assert.deepEqual(await fs.readdir(dirname(path)), ['settings.json'])
})

test('并发写串行提交请求时副本，读取加入同一队列并先于后续写入', async (t) => {
  const { settings, path } = await fixture(t)
  const entered = Promise.withResolvers<void>()
  const release = Promise.withResolvers<void>()
  const rename = fs.rename.bind(fs)
  const commits: number[] = []
  const temporaryPaths = new Set<string>()
  t.after(() => release.resolve())
  t.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
    if (commits.length === 0) {
      entered.resolve()
      await release.promise
    }
    temporaryPaths.add(String(args[0]))
    commits.push((JSON.parse(await fs.readFile(args[0], 'utf-8')) as AppSettings).fontSize)
    return rename(...args)
  })
  const firstValue = snapshot({ fontSize: 11 })
  const first = settings.writeSettings(firstValue)
  firstValue.fontSize = 90
  await entered.promise
  const secondValue = snapshot({ fontSize: 22 })
  const second = settings.writeSettings(secondValue)
  secondValue.fontSize = 91
  let readFinished = false
  const read = settings.readSettings().then((value) => { readFinished = true; return value })
  const third = settings.writeSettings(snapshot({ fontSize: 33 }))
  await Promise.resolve()
  assert.equal(readFinished, false)
  assert.deepEqual(commits, [])
  release.resolve()
  const [, , loaded] = await Promise.all([first, second, read, third])
  assert.deepEqual(commits, [11, 22, 33])
  assert.equal(temporaryPaths.size, 3)
  assert.equal(loaded.fontSize, 22)
  assert.equal((await settings.readSettings()).fontSize, 33)
  assert.equal((JSON.parse(await fs.readFile(path, 'utf-8')) as AppSettings).fontSize, 33)
})

test('mkdir/open/write/fsync/close/rename 失败保留原文件并清理临时文件，队列继续', async (t) => {
  for (const stage of ['mkdir', 'open', 'writeFile', 'sync', 'close', 'rename'] as const) {
    await t.test(stage, async (sub) => {
      const { settings, path } = await fixture(sub)
      const original = snapshot({ fontSize: 11 })
      await settings.writeSettings(original)
      const failure = Object.assign(new Error(`模拟 ${stage} 失败`), { code: 'EACCES' })
      let failed = false
      if (stage === 'mkdir') {
        const mkdir = fs.mkdir.bind(fs)
        sub.mock.method(fs, 'mkdir', async (...args: Parameters<typeof fs.mkdir>) => {
          if (!failed) { failed = true; throw failure }
          return mkdir(...args)
        })
      } else if (stage === 'rename') {
        const rename = fs.rename.bind(fs)
        sub.mock.method(fs, 'rename', async (...args: Parameters<typeof fs.rename>) => {
          if (!failed) { failed = true; throw failure }
          return rename(...args)
        })
      } else {
        const open = fs.open.bind(fs)
        sub.mock.method(fs, 'open', async (...args: Parameters<typeof fs.open>) => {
          if (stage === 'open' && !failed) { failed = true; throw failure }
          const handle = await open(...args)
          if (stage === 'writeFile') {
            const write = handle.writeFile.bind(handle)
            sub.mock.method(handle, 'writeFile', async (...values: Parameters<typeof handle.writeFile>) => {
              if (!failed) { failed = true; throw failure }
              return write(...values)
            })
          } else if (stage === 'sync' || stage === 'close') {
            const operation = handle[stage].bind(handle)
            sub.mock.method(handle, stage, async () => {
              if (!failed) { failed = true; throw failure }
              return operation()
            })
          }
          return handle
        })
      }
      const rejected = settings.writeSettings(snapshot({ fontSize: 22 }))
      const read = settings.readSettings()
      await assert.rejects(rejected, (error) => error === failure)
      assert.deepEqual(await read, original)
      assert.deepEqual(await fs.readdir(dirname(path)), ['settings.json'])
      const updated = snapshot({ fontSize: 33 })
      await settings.writeSettings(updated)
      assert.deepEqual(await settings.readSettings(), updated)
    })
  }
})

test('序列化失败不触碰磁盘也不阻断队列', async (t) => {
  const { settings, path } = await fixture(t)
  const invalid = snapshot() as AppSettings & { cycle?: unknown }
  invalid.cycle = invalid
  await assert.rejects(settings.writeSettings(invalid), TypeError)
  await assert.rejects(fs.stat(path), { code: 'ENOENT' })
  await settings.writeSettings(snapshot({ fontSize: 25 }))
  assert.equal((await settings.readSettings()).fontSize, 25)
})
