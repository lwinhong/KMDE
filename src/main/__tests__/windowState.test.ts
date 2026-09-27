import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { mock, test, type TestContext } from 'node:test'
import type { DisplayRect, PersistedWindowState } from '../windowState.ts'

// windowState.ts 不依赖 electron，纯逻辑与文件读写都可直接测试。

async function fixture(t: TestContext) {
  const base = await fs.mkdtemp(join(tmpdir(), 'kmde-window-state-'))
  const previous = process.env['APPDATA']
  process.env['APPDATA'] = base
  const windowState: typeof import('../windowState.ts') = await import(`../windowState.ts?test=${randomUUID()}`)
  t.after(async () => {
    if (previous === undefined) delete process.env['APPDATA']
    else process.env['APPDATA'] = previous
    await fs.rm(base, { recursive: true, force: true })
  })
  return { windowState, base, path: join(base, 'kmde', 'window-state.json') }
}

function rect(x: number, y: number, width: number, height: number): DisplayRect {
  return { x, y, width, height }
}

function primary(): DisplayRect {
  return rect(0, 0, 1920, 1040)
}

function dual(): DisplayRect[] {
  // 主屏 + 右侧第二屏。
  return [primary(), rect(1920, 0, 2560, 1400)]
}

test('无保存状态时按默认尺寸在主屏工作区居中', async (t) => {
  const { windowState } = await fixture(t)
  assert.deepEqual(windowState.resolveWindowState(null, dual(), primary()), {
    x: 320, y: 110, width: 1280, height: 820, isMaximized: false
  })
})

test('保存状态位于仍连接的第二屏时原样恢复并保留最大化标志', async (t) => {
  const { windowState } = await fixture(t)
  const saved = { x: 2400, y: 200, width: 1200, height: 900, isMaximized: true }
  assert.deepEqual(windowState.resolveWindowState(saved, dual(), primary()), {
    x: 2400, y: 200, width: 1200, height: 900, isMaximized: true
  })
})

test('第二屏被拔出后回退主屏居中，沿用保存尺寸并保留最大化标志', async (t) => {
  const { windowState } = await fixture(t)
  const saved = { x: 2400, y: 200, width: 1200, height: 900, isMaximized: true }
  assert.deepEqual(windowState.resolveWindowState(saved, [primary()], primary()), {
    x: 360, y: 70, width: 1200, height: 900, isMaximized: true
  })
})

test('保存位置仅剩边缘窄条可见（低于三成占比）时回退主屏居中', async (t) => {
  const { windowState } = await fixture(t)
  const saved = { x: 1880, y: 100, width: 1280, height: 820, isMaximized: false }
  assert.deepEqual(windowState.resolveWindowState(saved, [primary()], primary()), {
    x: 320, y: 110, width: 1280, height: 820, isMaximized: false
  })
})

test('保存位置部分可见且占比达标时保留，并夹取回该屏工作区内', async (t) => {
  const { windowState } = await fixture(t)
  // 与主屏重叠 420x800，占窗口面积 42%，可恢复；x 被夹取到工作区内。
  const saved = { x: 1500, y: 50, width: 1000, height: 800, isMaximized: false }
  assert.deepEqual(windowState.resolveWindowState(saved, [primary()], primary()), {
    x: 920, y: 50, width: 1000, height: 800, isMaximized: false
  })
})

test('分辨率缩小后恢复时尺寸与位置都夹取到目标屏工作区', async (t) => {
  const { windowState } = await fixture(t)
  const saved = { x: 0, y: 0, width: 3000, height: 2000, isMaximized: false }
  assert.deepEqual(windowState.resolveWindowState(saved, [primary()], primary()), {
    x: 0, y: 0, width: 1920, height: 1040, isMaximized: false
  })
})

test('保存尺寸超过回退主屏时被主屏工作区约束', async (t) => {
  const { windowState } = await fixture(t)
  const saved = { x: 5000, y: 0, width: 3000, height: 2000, isMaximized: false }
  assert.deepEqual(windowState.resolveWindowState(saved, [primary()], primary()), {
    x: 0, y: 0, width: 1920, height: 1040, isMaximized: false
  })
})

test('显示器列表为空时直接回退主屏居中', async (t) => {
  const { windowState } = await fixture(t)
  const saved = { x: 2400, y: 200, width: 1200, height: 900, isMaximized: false }
  assert.deepEqual(windowState.resolveWindowState(saved, [], primary()), {
    x: 360, y: 70, width: 1200, height: 900, isMaximized: false
  })
})

test('损坏或非法保存值安全回退默认状态', async (t) => {
  const { windowState } = await fixture(t)
  const expected: PersistedWindowState = {
    x: 320, y: 110, width: 1280, height: 820, isMaximized: false
  }
  const invalid: unknown[] = [
    undefined, null, 'x', 42, [], {},
    { x: 0, y: 0 },
    { x: 'a', y: 0, width: 800, height: 600 },
    { x: Number.NaN, y: 0, width: 800, height: 600 },
    { x: Number.POSITIVE_INFINITY, y: 0, width: 800, height: 600 },
    { x: 0, y: 0, width: 100, height: 600 },
    { x: 0, y: 0, width: 800, height: 50 }
  ]
  for (const saved of invalid) {
    assert.deepEqual(windowState.resolveWindowState(saved, dual(), primary()), expected)
  }
})

test('状态文件路径保持 APPDATA/kmde/window-state.json 且读写往返一致', async (t) => {
  const { windowState, path } = await fixture(t)
  assert.equal(windowState.getWindowStatePath(), path)
  assert.equal(windowState.readWindowStateSync(), null)
  const state: PersistedWindowState = { x: 10, y: 20, width: 1280, height: 820, isMaximized: true }
  windowState.writeWindowStateFileSync(state)
  assert.deepEqual(windowState.readWindowStateSync(), state)
  assert.deepEqual(await fs.readdir(dirname(path)), ['window-state.json'])
})

test('损坏的状态文件读取时返回 null，合法但结构非法的 JSON 原样返回并由 resolveWindowState 兜底', async (t) => {
  const { windowState, path } = await fixture(t)
  await fs.mkdir(dirname(path), { recursive: true })
  await fs.writeFile(path, '{broken')
  assert.equal(windowState.readWindowStateSync(), null)
  await fs.writeFile(path, '[]')
  assert.deepEqual(windowState.readWindowStateSync(), [])
  assert.deepEqual(
    windowState.resolveWindowState(windowState.readWindowStateSync(), dual(), primary()),
    { x: 320, y: 110, width: 1280, height: 820, isMaximized: false }
  )
})

test('无 APPDATA 时仍按 cwd/kmde/window-state.json 计算路径', async (t) => {
  const { windowState } = await fixture(t)
  delete process.env['APPDATA']
  assert.equal(windowState.getWindowStatePath(), join(process.cwd(), 'kmde', 'window-state.json'))
})

test('写入失败不抛出、不留下临时文件，也不破坏原状态文件', async (t) => {
  const base = await fs.mkdtemp(join(tmpdir(), 'kmde-window-state-'))
  const previous = process.env['APPDATA']
  process.env['APPDATA'] = base
  // 同步 fs 命名空间不可用 t.mock.method 改写，改用 mock.module 提供最小导出集。
  const real = await import('node:fs')
  const failure = new Error('模拟 rename 失败')
  let shouldFail = false
  const mocked = mock.module('node:fs', {
    exports: {
      readFileSync: real.readFileSync,
      mkdirSync: real.mkdirSync,
      openSync: real.openSync,
      writeFileSync: real.writeFileSync,
      closeSync: real.closeSync,
      unlinkSync: real.unlinkSync,
      renameSync: (...args: Parameters<typeof real.renameSync>) => {
        if (shouldFail) throw failure
        return real.renameSync(...args)
      }
    }
  })
  t.after(async () => {
    mocked.restore()
    if (previous === undefined) delete process.env['APPDATA']
    else process.env['APPDATA'] = previous
    await fs.rm(base, { recursive: true, force: true })
  })
  const windowState: typeof import('../windowState.ts') = await import(`../windowState.ts?test=${randomUUID()}`)
  const path = join(base, 'kmde', 'window-state.json')
  const errors: unknown[] = []
  t.mock.method(console, 'error', (...args: unknown[]) => { errors.push(args[0]) })
  const original: PersistedWindowState = { x: 1, y: 2, width: 900, height: 600, isMaximized: false }
  windowState.writeWindowStateFileSync(original)
  shouldFail = true
  const updated: PersistedWindowState = { x: 500, y: 400, width: 1000, height: 700, isMaximized: true }
  assert.doesNotThrow(() => windowState.writeWindowStateFileSync(updated))
  assert.equal(errors.length, 1)
  assert.equal(String(errors[0]).startsWith('[window-state:write]'), true)
  assert.deepEqual(windowState.readWindowStateSync(), original)
  assert.deepEqual(await fs.readdir(dirname(path)), ['window-state.json'])
})

test('目标目录尚不存在时写入会自动创建，文件名符合约定', async (t) => {
  const { windowState, path } = await fixture(t)
  const state: PersistedWindowState = { x: 0, y: 0, width: 1280, height: 820, isMaximized: false }
  windowState.writeWindowStateFileSync(state)
  assert.equal(basename(path), 'window-state.json')
  assert.deepEqual(JSON.parse(await fs.readFile(path, 'utf-8')), state)
})
