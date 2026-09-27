import { randomUUID } from 'node:crypto'
import * as nodeFs from 'node:fs'
import { basename, dirname, join } from 'node:path'

export interface DisplayRect {
  x: number
  y: number
  width: number
  height: number
}

export interface PersistedWindowState extends DisplayRect {
  isMaximized: boolean
}

export const DEFAULT_WINDOW_WIDTH = 1280
export const DEFAULT_WINDOW_HEIGHT = 820

// 窗口与某块屏幕工作区的最小可见占比；低于它视为该屏幕已不可用（如被拔出）。
const MIN_VISIBLE_RATIO = 0.3
// 保存值过小视为损坏数据，不恢复。
const MIN_SAVED_WIDTH = 200
const MIN_SAVED_HEIGHT = 200

let statePath = ''

export function getWindowStatePath(): string {
  if (!statePath) {
    statePath = join(process.env['APPDATA'] ?? process.cwd(), 'kmde', 'window-state.json')
  }
  return statePath
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function parseSavedBounds(saved: unknown): DisplayRect | null {
  if (!isRecord(saved)) return null
  const x = finiteNumber(saved.x)
  const y = finiteNumber(saved.y)
  const width = finiteNumber(saved.width)
  const height = finiteNumber(saved.height)
  if (x === null || y === null || width === null || height === null) return null
  if (width < MIN_SAVED_WIDTH || height < MIN_SAVED_HEIGHT) return null
  return { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) }
}

function intersectionArea(a: DisplayRect, b: DisplayRect): number {
  const overlapWidth = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
  const overlapHeight = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
  if (overlapWidth <= 0 || overlapHeight <= 0) return 0
  return overlapWidth * overlapHeight
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max))
}

function centeredOnPrimary(primary: DisplayRect, width: number, height: number, isMaximized: boolean): PersistedWindowState {
  const clampedWidth = Math.min(width, primary.width)
  const clampedHeight = Math.min(height, primary.height)
  return {
    x: primary.x + Math.floor((primary.width - clampedWidth) / 2),
    y: primary.y + Math.floor((primary.height - clampedHeight) / 2),
    width: clampedWidth,
    height: clampedHeight,
    isMaximized
  }
}

/**
 * 依据当前已连接的显示器解析窗口恢复状态。
 *
 * - 保存位置所在屏幕仍在且可见占比达标 → 原样恢复，并夹取回该屏工作区内
 *   （容忍分辨率 / DPI 变化导致的位置与尺寸漂移）。
 * - 保存位置所在屏幕已被拔出（或仅剩边缘窄条可见）→ 回退主屏居中，
 *   沿用保存的尺寸（受主屏工作区约束）；最大化标志在两种路径下都保留。
 * - 无有效保存 → 主屏居中默认尺寸。
 */
export function resolveWindowState(saved: unknown, displays: DisplayRect[], primary: DisplayRect): PersistedWindowState {
  const isMaximized = isRecord(saved) && saved.isMaximized === true
  const savedBounds = parseSavedBounds(saved)
  if (savedBounds) {
    let best: DisplayRect | null = null
    let bestArea = 0
    for (const display of displays) {
      const area = intersectionArea(savedBounds, display)
      if (area > bestArea) {
        bestArea = area
        best = display
      }
    }
    if (best && bestArea >= savedBounds.width * savedBounds.height * MIN_VISIBLE_RATIO) {
      const width = Math.min(savedBounds.width, best.width)
      const height = Math.min(savedBounds.height, best.height)
      return {
        x: clamp(savedBounds.x, best.x, best.x + best.width - width),
        y: clamp(savedBounds.y, best.y, best.y + best.height - height),
        width,
        height,
        isMaximized
      }
    }
  }
  const size = savedBounds ?? { width: DEFAULT_WINDOW_WIDTH, height: DEFAULT_WINDOW_HEIGHT }
  return centeredOnPrimary(primary, size.width, size.height, isMaximized)
}

export function readWindowStateSync(): unknown {
  try {
    return JSON.parse(nodeFs.readFileSync(getWindowStatePath(), 'utf-8')) as unknown
  } catch {
    // 缺失或损坏都视为没有保存状态，由调用方走默认恢复。
    return null
  }
}

export function writeWindowStateFileSync(state: PersistedWindowState): void {
  const content = JSON.stringify(state, null, 2)
  const path = getWindowStatePath()
  const directory = dirname(path)
  const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`)
  try {
    nodeFs.mkdirSync(directory, { recursive: true })
    const handle = nodeFs.openSync(temporary, 'wx', 0o600)
    try {
      nodeFs.writeFileSync(handle, content, 'utf-8')
    } finally {
      nodeFs.closeSync(handle)
    }
    nodeFs.renameSync(temporary, path)
  } catch (error) {
    // 保存发生在关闭路径上，失败不能阻断退出；下次启动按默认状态恢复。
    console.error('[window-state:write]', error)
    try {
      nodeFs.unlinkSync(temporary)
    } catch {
      // 临时文件本就不存在时无需处理。
    }
  }
}
