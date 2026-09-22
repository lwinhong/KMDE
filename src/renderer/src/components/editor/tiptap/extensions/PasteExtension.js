import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

const UPLOAD_PLACEHOLDER_PREFIX = '\u200Buploading:'

function looksLikeMarkdown(text) {
  return (
    /^#{1,6}\s/m.test(text) ||           // 标题
    /\*\*[^*]+\*\*/.test(text) ||          // 加粗
    /__[^_]+__/.test(text) ||              // 加粗（下划线）
    /\*[^*]+\*/.test(text) ||              // 斜体
    /_[^_]+_/.test(text) ||                // 斜体（下划线）
    /$$.*?$$$.*?$/.test(text) ||         // 链接
    /!$$.*?$$$.*?$/.test(text) ||        // 图片
    /^[-*+]\s/m.test(text) ||              // 无序列表
    /^\d+\.\s/m.test(text) ||             // 有序列表
    /^>\s/m.test(text) ||                  // 引用
    /^```/m.test(text) ||                  //  fenced 代码块
    /`[^`]+`/.test(text) ||                // 行内代码
    /^([-*_])\1{2,}\s*$/m.test(text) ||   // 分隔线
    /~~[^~]+~~/.test(text) ||             // 删除线
    /^\|.*\|$/m.test(text)                 // 表格
  )
}

function cleanLocalFileRefs(text) {
  return text.replace(/!\[([^\]]*)\]\(file:\/\/\/[^\)]+\)/g, (match, alt) => {
    if (alt) return `*${alt}*`
    return ''
  })
}

function replaceFileImageNodes(view, url, alt) {
  let modified = false
  const tr = view.state.tr

  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'image' && node.attrs.src?.startsWith('file:///')) {
      const newNode = view.state.schema.nodes.image.create({
        ...node.attrs,
        src: url,
        alt: alt || node.attrs.alt || '',
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
      uploadFn: null,
    }
  },

  // transformPastedHTML(html) {
  //   return html.replace(
  //     /<img[^>]*src=["'](file:\/\/\/[^"']*)["'][^>]*\/?>/gi,
  //     (match, src) => {
  //       const altMatch = match.match(/alt=["']([^"']*)["']/i)
  //       const alt = altMatch ? altMatch[1] : ''
  //       const filename = alt || src.split('/').pop().split('?')[0] || 'image'
  //       const decoded = decodeURIComponent(filename)
  //       return `<span style="color:#e6a23c;font-size:13px;background:#fdf6ec;padding:2px 6px;border-radius:3px;border:1px dashed #e6a23c">[本地图片: ${decoded} — 请截图后重新粘贴上传]</span>`
  //     }
  //   )
  // },

  addProseMirrorPlugins() {
    const { editor, options } = this
    // const uploadFn = options.uploadFn
    const pluginKey = new PluginKey('pasteImageUpload')

    return [
      new Plugin({
        key: pluginKey,
        props: {
          handlePaste(view, event) {
            // 1. Handle markdown paste with file:/// cleanup
            const text = event.clipboardData?.getData('text/plain')
            if (text && editor.markdown) {
              //const hasLocalFileRef = /!\[([^\]]*)\]\(file:\/\/\/[^\)]+\)/.test(text)
              //const processedText = hasLocalFileRef ? cleanLocalFileRefs(text) : text

              if (looksLikeMarkdown(text)) {
                event.preventDefault()
                const json = editor.markdown.parse(text)
                editor.commands.insertContent(json)
                return true
              }
            }
            return false

            /* 一下还未完善，屏蔽图片上传功能
            const items = event.clipboardData?.items
            // 2. Handle image blobs (screenshot paste, drag, etc.)
            if (uploadFn && items) {
              const imageFiles = []
              for (let i = 0; i < items.length; i++) {
                const item = items[i]
                if (item.type.indexOf('image') !== -1) {
                  const file = item.getAsFile()
                  if (file) imageFiles.push(file)
                }
              }

              if (imageFiles.length > 0) {
                event.preventDefault()

                const insertPos = view.state.selection.from
                let offset = 0

                for (const file of imageFiles) {
                  const placeholder = `${UPLOAD_PLACEHOLDER_PREFIX}${file.name}\n`
                  const insertTr = view.state.tr.insertText(placeholder, insertPos + offset)
                  view.dispatch(insertTr)
                  offset += placeholder.length

                  const currentFile = file
                  const searchPlaceholder = `${UPLOAD_PLACEHOLDER_PREFIX}${currentFile.name}`

                  uploadFn(currentFile)
                    .then((result) => {
                      const doc = view.state.doc
                      let found = false
                      doc.descendants((node, nodePos) => {
                        if (found) return false
                        if (node.isText && node.text?.includes(searchPlaceholder)) {
                          const idx = node.text.indexOf(searchPlaceholder)
                          const from = nodePos + idx
                          const to = from + searchPlaceholder.length
                          const imageNode = view.state.schema.nodes.image.create({
                            src: result.url,
                            alt: result.alt || currentFile.name,
                          })
                          view.dispatch(view.state.tr.replaceWith(from, to, imageNode))
                          found = true
                          return false
                        }
                      })

                      if (!found) {
                        view.dispatch(
                          view.state.tr.insertText(
                            `![${result.alt || currentFile.name}](${result.url})`,
                            view.state.selection.from
                          )
                        )
                      }
                    })
                    .catch((err) => {
                      console.error('图片上传失败:', err)
                      const doc = view.state.doc
                      let found = false
                      doc.descendants((node, nodePos) => {
                        if (found) return false
                        if (node.isText && node.text?.includes(searchPlaceholder)) {
                          const idx = node.text.indexOf(searchPlaceholder)
                          const from = nodePos + idx
                          const to = from + searchPlaceholder.length
                          view.dispatch(view.state.tr.insertText('⚠ 图片上传失败', from, to))
                          found = true
                          return false
                        }
                      })
                    })
                }

                const text = event.clipboardData.getData('text/plain')
                if (text) {
                  const cleanText = cleanLocalFileRefs(text)
                  const trimmed = cleanText.replace(/\n{3,}/g, '\n\n').trim()
                  if (trimmed) {
                    view.dispatch(
                      view.state.tr.insertText(trimmed, view.state.selection.from)
                    )
                  }
                }

                return true
              }
            }

            // 3. Try Clipboard API for file:/// images in HTML
            if (uploadFn) {
              const html = event.clipboardData?.getData('text/html')
              if (html && /file:\/\/\//i.test(html)) {
                if (navigator.clipboard && typeof navigator.clipboard.read === 'function') {
                  const viewRef = view

                  navigator.clipboard.read().then(async (clipboardItems) => {
                    const imageBlobs = []
                    for (const item of clipboardItems) {
                      for (const type of item.types) {
                        if (type.startsWith('image/')) {
                          const blob = await item.getType(type)
                          imageBlobs.push({ blob, type })
                        }
                      }
                    }

                    if (imageBlobs.length > 0) {
                      for (const { blob, type } of imageBlobs) {
                        try {
                          const ext = type.split('/')[1] || 'png'
                          const file = new File([blob], `clipboard-image.${ext}`, { type })
                          const result = await uploadFn(file)
                          replaceFileImageNodes(viewRef, result.url, result.alt || file.name)
                        } catch (err) {
                          console.error('[PasteImageUpload] 图片上传失败:', err)
                        }
                      }
                    }
                  }).catch(() => { })
                }
              }
            }

            return false */
          },
        },
      }),
    ]
  },
})
