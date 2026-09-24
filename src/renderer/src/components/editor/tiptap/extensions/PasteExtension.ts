import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'
import type { EditorView } from '@tiptap/pm/view'

const UPLOAD_PLACEHOLDER_PREFIX = '​uploading:'

function looksLikeMarkdown(text: string): boolean {
  return (
    /^#{1,6}\s/m.test(text) ||           // 标题
    /\*\*[^*]+\*\*/.test(text) ||          // 加粗
    /__[^_]+__/.test(text) ||              // 加粗（下划线）
    /\*[^*]+\*/.test(text) ||              // 斜体
    /_[^_]+_/.test(text) ||                // 斜体（下划线）
    /\[.*?\]\(.*?\)/.test(text) ||         // 链接
    /!\[.*?\]\(.*?\)/.test(text) ||        // 图片
    /^[-*+]\s/m.test(text) ||              // 无序列表
    /^\d+\.\s/m.test(text) ||             // 有序列表
    /^>\s/m.test(text) ||                  // 引用
    /^```/m.test(text) ||                  // fenced 代码块
    /`[^`]+`/.test(text) ||                // 行内代码
    /^([-*_])\1{2,}\s*$/m.test(text) ||   // 分隔线
    /~~[^~]+~~/.test(text) ||             // 删除线
    /^\|.*\|$/m.test(text)                 // 表格
  )
}

function cleanLocalFileRefs(text: string): string {
  return text.replace(/!\[([^\]]*)\]\(file:\/\/\/[^\)]+\)/g, (_match, alt: string) => {
    if (alt) return `*${alt}*`
    return ''
  })
}

function replaceFileImageNodes(view: EditorView, url: string, alt: string): void {
  let modified = false
  const tr = view.state.tr

  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && node.attrs.src?.startsWith('file:///')) {
      const newNode = view.state.schema.nodes.image.create({
        ...node.attrs,
        src: url,
        alt: alt || node.attrs.alt || ''
      })
      tr.replaceWith(pos, pos + node.nodeSize, newNode)
      modified = true
    }
  })

  if (modified) {
    view.dispatch(tr)
  }
}

export const PasteExtension = Extension.create({
  name: 'pasteExtension',

  addOptions() {
    return {
      uploadFn: null
    }
  },

  addProseMirrorPlugins() {
    const { editor } = this
    const pluginKey = new PluginKey('pasteImageUpload')

    return [
      new Plugin({
        key: pluginKey,
        props: {
          handlePaste(view, event) {
            // 1. Handle markdown paste with file:/// cleanup
            const text = event.clipboardData?.getData('text/plain')
            if (text && editor.markdown) {
              if (looksLikeMarkdown(text)) {
                event.preventDefault()
                const json = editor.markdown.parse(text)
                editor.commands.insertContent(json)
                return true
              }
            }
            return false
          }
        }
      })
    ]
  }
})

export { replaceFileImageNodes, cleanLocalFileRefs, UPLOAD_PLACEHOLDER_PREFIX }
