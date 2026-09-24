import { Node, mergeAttributes, textblockTypeInputRule } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, Selection } from '@tiptap/pm/state'

const DEFAULT_TAB_SIZE = 4

const backtickInputRegex = /^```([a-z]+)?[\s\n]$/
const tildeInputRegex = /^~~~([a-z]+)?[\s\n]$/

interface MarkdownToken {
  raw?: string
  codeBlockStyle?: string
  lang?: string
  text?: string
}

interface MarkdownHelpers {
  createNode(type: string, attrs: Record<string, string | null>, content?: unknown[]): unknown
  createTextNode(text: string): unknown
}

interface MarkdownRenderHelper {
  renderChildren(content: unknown): string
}

interface MarkdownNode {
  attrs?: { language?: string | null }
  content?: unknown
}

const CodeBlockWithCopy = Node.create({
  name: 'codeBlock',

  addOptions() {
    return {
      languageClassPrefix: 'language-',
      exitOnTripleEnter: true,
      exitOnArrowDown: true,
      defaultLanguage: null,
      enableTabIndentation: false,
      tabSize: DEFAULT_TAB_SIZE,
      HTMLAttributes: {},
    }
  },

  content: 'text*',
  marks: '',
  group: 'block',
  code: true,
  defining: true,

  addAttributes() {
    return {
      language: {
        default: this.options.defaultLanguage,
        parseHTML: (element: HTMLElement) => {
          const { languageClassPrefix } = this.options
          if (!languageClassPrefix) return null
          const classNames: string[] = [...(element.firstElementChild?.classList || [])]
          const languages = classNames
            .filter(className => className.startsWith(languageClassPrefix))
            .map(className => className.replace(languageClassPrefix, ''))
          return languages[0] || null
        },
        rendered: false,
      },
    }
  },

  parseHTML() {
    return [{ tag: 'pre', preserveWhitespace: 'full' }]
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'pre',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes),
      ['code', { class: node.attrs.language ? this.options.languageClassPrefix + node.attrs.language : null }, 0],
    ]
  },

  addNodeView() {
    return ({ node, HTMLAttributes }) => {
      const container = document.createElement('div')
      container.classList.add('code-block-wrapper')

      const header = document.createElement('div')
      header.classList.add('code-block-header')

      const langSpan = document.createElement('span')
      langSpan.classList.add('code-block-lang')
      langSpan.textContent = node.attrs.language || ''

      const copyBtn = document.createElement('button')
      copyBtn.classList.add('code-block-copy-btn')
      copyBtn.textContent = '复制'
      copyBtn.addEventListener('click', (e) => {
        e.preventDefault()
        const codeEl = container.querySelector('code')
        const text = codeEl?.textContent || ''
        navigator.clipboard.writeText(text).then(() => {
          copyBtn.textContent = '已复制!'
          copyBtn.classList.add('copied')
          setTimeout(() => {
            copyBtn.textContent = '复制'
            copyBtn.classList.remove('copied')
          }, 2000)
        }).catch(() => {
          copyBtn.textContent = '失败'
          setTimeout(() => { copyBtn.textContent = '复制' }, 2000)
        })
      })

      header.appendChild(langSpan)
      header.appendChild(copyBtn)
      container.appendChild(header)

      const pre = document.createElement('pre')
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes)
      Object.entries(HTMLAttributes).forEach(([key, value]) => {
        if (value != null) pre.setAttribute(key, String(value))
      })

      const code = document.createElement('code')
      if (node.attrs.language) {
        code.classList.add(this.options.languageClassPrefix + node.attrs.language)
      }

      pre.appendChild(code)
      container.appendChild(pre)

      return {
        dom: container,
        contentDOM: code,
      }
    }
  },

  markdownTokenName: 'code',

  parseMarkdown: (token: MarkdownToken, helpers: MarkdownHelpers) => {
    if (
      token.raw?.startsWith('```') === false &&
      token.raw?.startsWith('~~~') === false &&
      token.codeBlockStyle !== 'indented'
    ) {
      return []
    }
    return helpers.createNode('codeBlock', { language: token.lang || null }, token.text ? [helpers.createTextNode(token.text)] : [])
  },

  renderMarkdown: (node: MarkdownNode, h: MarkdownRenderHelper) => {
    const language = node.attrs?.language || ''
    if (!node.content) return `\`\`\`${language}\n\n\`\`\``
    return [`\`\`\`${language}`, h.renderChildren(node.content), '```'].join('\n')
  },

  addCommands() {
    return {
      setCodeBlock: (attributes?: Record<string, unknown>) => ({ commands }) => commands.setNode(this.name, attributes),
      toggleCodeBlock: (attributes?: Record<string, unknown>) => ({ commands }) => commands.toggleNode(this.name, 'paragraph', attributes),
    }
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Alt-c': () => this.editor.commands.toggleCodeBlock(),
      Backspace: () => {
        const { empty, $anchor } = this.editor.state.selection
        if (!empty || $anchor.parent.type.name !== this.name) return false
        if ($anchor.pos === 1 || !$anchor.parent.textContent.length) return this.editor.commands.clearNodes()
        return false
      },
      Tab: ({ editor }) => {
        if (!this.options.enableTabIndentation) return false
        const tabSize = this.options.tabSize ?? DEFAULT_TAB_SIZE
        const { state } = editor
        const { selection } = state
        const { $from, empty } = selection
        if ($from.parent.type !== this.type) return false
        const indent = ' '.repeat(tabSize)
        if (empty) return editor.commands.insertContent(indent)
        return editor.commands.command(({ tr }) => {
          const { from, to } = selection
          const text = state.doc.textBetween(from, to, '\n', '\n')
          const indentedText = text.split('\n').map(line => indent + line).join('\n')
          tr.replaceWith(from, to, state.schema.text(indentedText))
          return true
        })
      },
      'Shift-Tab': ({ editor }) => {
        if (!this.options.enableTabIndentation) return false
        const tabSize = this.options.tabSize ?? DEFAULT_TAB_SIZE
        const { state } = editor
        const { selection } = state
        const { $from, empty } = selection
        if ($from.parent.type !== this.type) return false
        if (empty) {
          return editor.commands.command(({ tr }) => {
            const { pos } = $from
            const codeBlockStart = $from.start()
            const codeBlockEnd = $from.end()
            const allText = state.doc.textBetween(codeBlockStart, codeBlockEnd, '\n', '\n')
            const lines = allText.split('\n')
            let currentLineIndex = 0
            let charCount = 0
            const relativeCursorPos = pos - codeBlockStart
            for (let i = 0; i < lines.length; i++) {
              if (charCount + lines[i].length >= relativeCursorPos) { currentLineIndex = i; break }
              charCount += lines[i].length + 1
            }
            const leadingSpaces = lines[currentLineIndex].match(/^ */)?.[0] || ''
            const spacesToRemove = Math.min(leadingSpaces.length, tabSize)
            if (spacesToRemove === 0) return true
            let lineStartPos = codeBlockStart
            for (let i = 0; i < currentLineIndex; i++) lineStartPos += lines[i].length + 1
            tr.delete(lineStartPos, lineStartPos + spacesToRemove)
            const cursorPosInLine = pos - lineStartPos
            if (cursorPosInLine <= spacesToRemove) tr.setSelection(TextSelection.create(tr.doc, lineStartPos))
            return true
          })
        }
        return editor.commands.command(({ tr }) => {
          const { from, to } = selection
          const text = state.doc.textBetween(from, to, '\n', '\n')
          const reverseIndentText = text.split('\n').map(line => {
            const leadingSpaces = line.match(/^ */)?.[0] || ''
            return line.slice(Math.min(leadingSpaces.length, tabSize))
          }).join('\n')
          tr.replaceWith(from, to, state.schema.text(reverseIndentText))
          return true
        })
      },
      Enter: ({ editor }) => {
        if (!this.options.exitOnTripleEnter) return false
        const { state } = editor
        const { selection } = state
        const { $from, empty } = selection
        if (!empty || $from.parent.type !== this.type) return false
        const isAtEnd = $from.parentOffset === $from.parent.nodeSize - 2
        const endsWithDoubleNewline = $from.parent.textContent.endsWith('\n\n')
        if (!isAtEnd || !endsWithDoubleNewline) return false
        return editor.chain().command(({ tr }) => { tr.delete($from.pos - 2, $from.pos); return true }).exitCode().run()
      },
      ArrowDown: ({ editor }) => {
        if (!this.options.exitOnArrowDown) return false
        const { state } = editor
        const { selection, doc } = state
        const { $from, empty } = selection
        if (!empty || $from.parent.type !== this.type) return false
        if ($from.parentOffset !== $from.parent.nodeSize - 2) return false
        const after = $from.after()
        if (after === undefined) return false
        const nodeAfter = doc.nodeAt(after)
        if (nodeAfter) return editor.commands.command(({ tr }) => { tr.setSelection(Selection.near(doc.resolve(after))); return true })
        return editor.commands.exitCode()
      },
    }
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        find: backtickInputRegex,
        type: this.type,
        getAttributes: (match: RegExpMatchArray) => ({ language: match[1] }),
      }),
      textblockTypeInputRule({
        find: tildeInputRegex,
        type: this.type,
        getAttributes: (match: RegExpMatchArray) => ({ language: match[1] }),
      }),
    ]
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('codeBlockVSCodeHandler'),
        props: {
          handlePaste: (view, event) => {
            if (!event.clipboardData) return false
            if (this.editor.isActive(this.type.name)) return false
            const text = event.clipboardData.getData('text/plain')
            const vscode = event.clipboardData.getData('vscode-editor-data')
            const vscodeData: { mode?: string } | undefined = vscode ? JSON.parse(vscode) : undefined
            const language = vscodeData?.mode
            if (!text || !language) return false
            const { tr, schema } = view.state
            const textNode = schema.text(text.replace(/\r\n?/g, '\n'))
            tr.replaceSelectionWith(this.type.create({ language }, textNode))
            if (tr.selection.$from.parent.type !== this.type) {
              tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(0, tr.selection.from - 2))))
            }
            tr.setMeta('paste', true)
            view.dispatch(tr)
            return true
          },
        },
      }),
    ]
  },
})

export { CodeBlockWithCopy }
export default CodeBlockWithCopy
