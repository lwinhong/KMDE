import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'
import { setImmediate as yieldToEventLoop } from 'node:timers/promises'
import { IGNORED_DIR_NAMES, SUPPORTED_DOCUMENT_EXTENSIONS } from '../shared/types.ts'
import type { FileNode } from '../shared/types'

const nameCollator = new Intl.Collator('zh-CN')
const YIELD_BATCH_SIZE = 2048

export function isIgnoredWorkspaceName(name: string): boolean {
  return name.startsWith('.') || IGNORED_DIR_NAMES.has(name)
}

export async function listWorkspaceDir(dir: string): Promise<FileNode[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const nodes: FileNode[] = []
  for (let index = 0; index < entries.length; index += 1) {
    if (index > 0 && index % YIELD_BATCH_SIZE === 0) await yieldToEventLoop()
    const entry = entries[index]
    if (isIgnoredWorkspaceName(entry.name)) continue
    // Dirent 无法区分链接目标；不解引用任何链接，避免目录递归逃逸。
    if (entry.isSymbolicLink() || (!entry.isDirectory() && !entry.isFile())) continue
    const isDir = entry.isDirectory()
    const ext = isDir ? '' : extname(entry.name).toLowerCase()
    // 文件夹保留导航入口；文件只显示编辑器支持的格式，不影响磁盘或图片引用。
    if (!isDir && !SUPPORTED_DOCUMENT_EXTENSIONS.has(ext)) continue
    nodes.push({ name: entry.name, path: join(dir, entry.name), isDir, ext })
  }
  return sortWorkspaceNodes(nodes)
}

function compareNodes(a: FileNode, b: FileNode): number {
  if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
  return nameCollator.compare(a.name, b.name)
}

async function sortWorkspaceNodes(nodes: FileNode[]): Promise<FileNode[]> {
  if (nodes.length <= YIELD_BATCH_SIZE) return nodes.sort(compareNodes)

  // 大目录的排序也分批让出，避免枚举完成后一次同步排序阻塞主进程。
  let source = nodes
  let target = new Array<FileNode>(nodes.length)
  let processed = 0
  for (let width = 1; width < nodes.length; width *= 2) {
    for (let start = 0; start < nodes.length; start += width * 2) {
      const middle = Math.min(start + width, nodes.length)
      const end = Math.min(start + width * 2, nodes.length)
      let left = start
      let right = middle
      for (let index = start; index < end; index += 1) {
        target[index] = right >= end || (left < middle && compareNodes(source[left], source[right]) <= 0)
          ? source[left++] : source[right++]
        if (++processed % YIELD_BATCH_SIZE === 0) await yieldToEventLoop()
      }
    }
    ;[source, target] = [target, source]
  }
  return source
}
