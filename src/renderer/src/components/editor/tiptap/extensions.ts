import type { Extensions } from '@tiptap/core'
import type { NodeViewRendererProps } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { Markdown } from '@tiptap/markdown'
import { Details, DetailsContent, DetailsSummary } from '@tiptap/extension-details'
import { Highlight } from '@tiptap/extension-highlight'
import { Image, type ImageOptions } from '@tiptap/extension-image'
import { TaskItem, TaskList } from '@tiptap/extension-list'
import { Mathematics } from '@tiptap/extension-mathematics'
import { TableKit } from '@tiptap/extension-table'
import { Selection } from '@tiptap/extensions'
import { Typography } from '@tiptap/extension-typography'
import { Subscript } from '@tiptap/extension-subscript'
import { Superscript } from '@tiptap/extension-superscript'
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight'
import { VueNodeViewRenderer } from '@tiptap/vue-3'

import { buildLowlight } from './lowlight'
import { SlashCommand } from './extensions/SlashCommand'
import { PasteExtension } from './extensions/PasteExtension'
import { Placeholder } from '@tiptap/extensions'
import MermaidCodeBlock from './components/MermaidCodeBlock.vue'
import { toFileUrl, dirname, joinPath } from '@/stores/pathUtils'
import { t } from '@/i18n'

export function resolveImgSrc(src: string, docPath: string | null): string {
  if (!src) return ''
  if (/^(https?:|data:|blob:|kmd-file:)/i.test(src)) {
    return src
  }
  if (docPath) {
    return toFileUrl(joinPath(dirname(docPath), src))
  }
  return src
}

export interface KmdeImageOptions extends ImageOptions {
  docPath: string | null
}

export function buildImageExtension(docPath: string | null) {
  return Image.extend({
    addOptions(): KmdeImageOptions {
      return {
        ...this.parent?.(),
        docPath
      } as KmdeImageOptions
    },
    addNodeView() {
      return ({ node }: NodeViewRendererProps) => {
        const docPathRef = (this.options as KmdeImageOptions).docPath
        const wrap = document.createElement('span')
        wrap.className = 'kme-image-wrap'
        const img = document.createElement('img')
        const apply = (n: NodeViewRendererProps['node']): void => {
          const raw = (n.attrs.src as string) ?? ''
          img.setAttribute('src', resolveImgSrc(raw, docPathRef))
          if (n.attrs.alt) img.setAttribute('alt', String(n.attrs.alt))
          else img.removeAttribute('alt')
          if (n.attrs.title) img.setAttribute('title', String(n.attrs.title))
          else img.removeAttribute('title')
          img.setAttribute('draggable', 'false')
        }
        apply(node)
        wrap.appendChild(img)
        return {
          dom: wrap,
          update(updatedNode): boolean {
            if (updatedNode.type.name !== 'image') return false
            apply(updatedNode)
            return true
          }
        }
      }
    }
  })
}

export function buildContentExtensions(docPath: string | null): Extensions {
  return [
    StarterKit.configure({
      link: { openOnClick: false, enableClickSelection: true },
      codeBlock: false
    }),
    Markdown,
    Details,
    DetailsSummary,
    DetailsContent,
    TaskList,
    TaskItem.configure({ nested: true }),
    buildImageExtension(docPath),
    TableKit.configure({ table: { resizable: false }, tableCell: {} }),
    Selection,
    Highlight,
    Mathematics,
    Typography,
    Subscript,
    Superscript,
    CodeBlockLowlight.extend({
      addNodeView() {
        return VueNodeViewRenderer(MermaidCodeBlock)
      }
    }).configure({ lowlight: buildLowlight() })
  ]
}

/**
 * Headless export variant: no Vue node views (safe outside a component context),
 * no UI-only extensions. getHTML output is identical for content nodes.
 */
export function buildExportExtensions(docPath: string | null): Extensions {
  return [
    StarterKit.configure({
      link: { openOnClick: false },
      codeBlock: false
    }),
    Markdown,
    Details,
    DetailsSummary,
    DetailsContent,
    TaskList,
    TaskItem.configure({ nested: true }),
    buildImageExtension(docPath),
    TableKit.configure({ table: { resizable: false }, tableCell: {} }),
    Highlight,
    Mathematics,
    Typography,
    Subscript,
    Superscript,
    CodeBlockLowlight.configure({ lowlight: buildLowlight() })
  ]
}

export function buildEditorExtensions(docPath: string | null): Extensions {
  return [
    ...buildContentExtensions(docPath),
    PasteExtension,
    Placeholder.configure({
      placeholder: ({ node }: { node: { type: { name: string }; attrs: { level?: number } } }) => {
        if (node.type.name === 'heading') {
          return t('editor.headingN', { level: node.attrs.level ?? '' })
        }
        return t('editor.placeholderBody')
      },
      showOnlyWhenEditable: true,
      showOnlyCurrent: true
    }),
    SlashCommand
  ]
}
