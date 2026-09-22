/**
 * Minimal path utilities for the renderer process
 * (the node 'path' module is not available in the sandboxed renderer).
 */
export function basename(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : p
}

export function dirname(p: string): string {
  const normalized = p.replace(/\\/g, '/')
  const idx = normalized.lastIndexOf('/')
  if (idx < 0) return '.'
  const dir = normalized.slice(0, idx)
  return dir.length > 0 ? dir : '/'
}

export function extname(p: string): string {
  const name = basename(p)
  const idx = name.lastIndexOf('.')
  if (idx <= 0) return ''
  return name.slice(idx).toLowerCase()
}

export function joinPath(dir: string, name: string): string {
  const sep = dir.includes('\\') && !dir.includes('/') ? '\\' : '/'
  const trimmed = dir.endsWith('/') || dir.endsWith('\\') ? dir.slice(0, -1) : dir
  return `${trimmed}${sep}${name}`
}

export function relativeTo(path: string, root: string): string {
  const p = path.replace(/\\/g, '/')
  const r = root.replace(/\\/g, '/').replace(/\/$/, '')
  if (p.startsWith(`${r}/`)) {
    return p.slice(r.length + 1)
  }
  return path
}

export function toFileUrl(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  return `kmd-file://${normalized.startsWith('/') ? '' : '/'}${encodeURIComponent(normalized)
    .replace(/%2F/g, '/')
    .replace(/%3A/g, ':')}`
}
