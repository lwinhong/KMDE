import { computed, onScopeDispose, shallowReactive, shallowRef, toValue, watch } from 'vue'
import type { MaybeRefOrGetter } from 'vue'
import type { FileNode } from '@shared/types'
import type { TreeController } from '../components/sidebar/FileTreeNode.vue'

const PAGE_SIZE = 200
const REFRESH_CONCURRENCY = 4

export function useFileTree(
  root: MaybeRefOrGetter<string | null>,
  treeVersion: MaybeRefOrGetter<number>,
  onError: (error: unknown, path: string) => void
) {
  const rootChildren = shallowRef<FileNode[]>([])
  const rootLoading = shallowRef(false)
  const rootLimit = shallowRef(PAGE_SIZE)
  const expandedDirs = shallowReactive(new Set<string>())
  const loadingDirs = shallowReactive(new Set<string>())
  // 节点契约保持不变；只把当前页暴露给递归组件，完整结果不做深层代理。
  const childrenCache = shallowReactive(new Map<string, FileNode[]>())
  const allChildren = shallowReactive(new Map<string, FileNode[]>())
  const limits = new Map<string, number>()
  const requests = new Map<string, { promise: Promise<void> }>()
  const pauses = new Map<ReturnType<typeof setTimeout>, () => void>()
  const revision = shallowRef(0)
  let generation = 0
  let disposed = false

  const visibleRootChildren = computed(() => rootChildren.value.slice(0, rootLimit.value))
  const hasMoreRoot = computed(() => rootChildren.value.length > rootLimit.value)
  const moreDirectories = computed(() => {
    const result: Array<{ path: string; remaining: number }> = []
    for (const path of expandedDirs) {
      const remaining = (allChildren.get(path)?.length ?? 0) - (childrenCache.get(path)?.length ?? 0)
      if (remaining > 0) result.push({ path, remaining })
    }
    return result
  })

  function current(id: number): boolean {
    return !disposed && id === generation
  }

  function invalidate(resetRoot: boolean): void {
    generation++
    requests.clear()
    loadingDirs.clear()
    childrenCache.clear()
    allChildren.clear()
    rootLoading.value = false
    for (const [timer, resume] of pauses) {
      clearTimeout(timer)
      resume()
    }
    pauses.clear()
    if (resetRoot) {
      rootChildren.value = []
      rootLimit.value = PAGE_SIZE
      expandedDirs.clear()
      limits.clear()
    }
  }

  function yieldToUI(id: number): Promise<void> {
    if (!current(id)) return Promise.resolve()
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pauses.delete(timer)
        resolve()
      }, 0)
      pauses.set(timer, resolve)
    })
  }

  function publishChildren(path: string): void {
    const nodes = allChildren.get(path)
    if (nodes) childrenCache.set(path, nodes.slice(0, limits.get(path) ?? PAGE_SIZE))
  }

  function loadDirectory(path: string, id: number, isRoot = false): Promise<void> {
    if (!current(id)) return Promise.resolve()
    const pending = requests.get(path)
    if (pending) return pending.promise
    const request = { promise: Promise.resolve() }
    requests.set(path, request)
    if (isRoot) rootLoading.value = true
    else loadingDirs.add(path)
    request.promise = (async () => {
      try {
        const nodes = await window.kmde.listDir(path)
        if (!current(id)) return
        if (isRoot) rootChildren.value = nodes
        else {
          allChildren.set(path, nodes)
          publishChildren(path)
        }
      } catch (error) {
        if (!current(id)) return
        if (isRoot) rootChildren.value = []
        else expandedDirs.delete(path)
        onError(error, path)
      } finally {
        // 不能由旧请求删除新请求的 loading，尤其是 A-B-A 与同根刷新。
        if (current(id) && requests.get(path) === request) {
          requests.delete(path)
          if (isRoot) rootLoading.value = false
          else loadingDirs.delete(path)
        }
      }
    })()
    return request.promise
  }

  async function refreshRoot(): Promise<void> {
    if (disposed) return
    invalidate(false)
    const scanRoot = toValue(root)
    if (!scanRoot) {
      rootChildren.value = []
      return
    }
    const id = generation
    await loadDirectory(scanRoot, id, true)
    if (!current(id)) return
    const expanded = [...expandedDirs].filter((path) => path !== scanRoot)
    for (let cursor = 0; cursor < expanded.length && current(id); cursor += REFRESH_CONCURRENCY) {
      // 根目录先显示；已展开子目录分批恢复，不连续垄断渲染线程。
      await yieldToUI(id)
      if (!current(id)) return
      await Promise.all(expanded.slice(cursor, cursor + REFRESH_CONCURRENCY)
        .filter((path) => expandedDirs.has(path))
        .map((path) => loadDirectory(path, id)))
    }
  }

  async function toggleNode(node: FileNode): Promise<void> {
    const scanRoot = toValue(root)
    if (disposed || !scanRoot || !node.isDir) return
    const normalized = (path: string) => path.replace(/\\/g, '/').replace(/\/$/, '')
    if (!normalized(node.path).startsWith(`${normalized(scanRoot)}/`)) return
    if (expandedDirs.has(node.path)) {
      expandedDirs.delete(node.path)
      return
    }
    expandedDirs.add(node.path)
    if (!childrenCache.has(node.path)) await loadDirectory(node.path, generation)
  }

  function loadMore(path: string | null = toValue(root)): void {
    if (disposed || !path) return
    if (path === toValue(root)) {
      rootLimit.value = Math.min(rootLimit.value + PAGE_SIZE, Math.max(PAGE_SIZE, rootChildren.value.length))
    } else if (expandedDirs.has(path) && allChildren.has(path)) {
      limits.set(path, (limits.get(path) ?? PAGE_SIZE) + PAGE_SIZE)
      publishChildren(path)
    }
  }

  // 同步失效捕获同一 tick 内的 A-B-A；实际读取由 Vue 合并为一次刷新。
  watch([() => toValue(root), () => toValue(treeVersion)], ([nextRoot], [previousRoot]) => {
    invalidate(nextRoot !== previousRoot)
    rootLoading.value = nextRoot !== null
    revision.value++
  }, { flush: 'sync' })
  watch(revision, () => { void refreshRoot() }, { immediate: true })

  onScopeDispose(() => {
    disposed = true
    invalidate(true)
  })

  const controller: TreeController = { expandedDirs, loadingDirs, childrenCache, toggleNode }
  return {
    rootChildren, visibleRootChildren, rootLoading, hasMoreRoot, moreDirectories,
    controller, refreshRoot, loadMore
  }
}
