/**
 * 建立「ProseMirror 顶级节点索引 → markdown 起始行号(1-based)」映射。
 *
 * 直接用每个节点的文本内容在 markdown 中顺序搜索定位，而不是按 markdown
 * 语法分块。原因是 markdown 分块规则复杂（列表/代码块/表格/引用/空行等），
 * 手写解析容易与 ProseMirror 的实际节点结构错位（尤其空行不产生节点），
 * 导致分屏滚动同步内容对不上。文本顺序搜索只依赖内容本身，更鲁棒。
 */

// 两侧统一归一化：去掉行内标记字符与所有空白，保证可比。
function clean(text: string): string {
  return text.replace(/[`*_~]/g, '').replace(/\s+/g, '')
}

// 去除行首块级标记后归一化。
function stripLine(line: string): string {
  return clean(
    line
      .replace(/^#{1,6}\s+/, '')
      .replace(/^>\s?/, '')
      .replace(/^(\s*)([-*+]|\d+\.)\s+/, '')
      .replace(/^\s*\|/, '')
      .replace(/\|/g, ' ')
  )
}

export function buildNodeLineMap(nodeTexts: string[], markdown: string): number[] {
  const lines = markdown.split('\n')
  const stripped = lines.map(stripLine)
  const result: number[] = []
  let searchFrom = 0

  for (const raw of nodeTexts) {
    const probe = clean(raw).slice(0, 24)
    let found = -1
    if (probe) {
      const head = probe.slice(0, 12)
      for (let j = searchFrom; j < stripped.length; j++) {
        const s = stripped[j]
        if (!s) continue
        if (s.startsWith(head) || probe.startsWith(s.slice(0, 12))) {
          found = j
          break
        }
      }
    }
    const idx = found >= 0 ? found : searchFrom
    result.push(idx + 1)
    searchFrom = idx
  }
  return result
}

/**
 * 找到行号 line 落在哪个节点范围内，返回节点索引。
 */
export function nodeIndexForLine(map: number[], line: number): number {
  let result = 0
  for (let i = 0; i < map.length; i++) {
    if (line >= map[i]) result = i
    else break
  }
  return result
}
