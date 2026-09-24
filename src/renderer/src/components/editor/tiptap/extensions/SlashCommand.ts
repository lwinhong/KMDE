import { Extension } from '@tiptap/core'
import type { Editor, Range } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from 'prosemirror-state'
import { h } from 'vue'
import type { Component } from 'vue'
import { renderToString } from 'vue/server-renderer'
import { t } from '@/i18n'
import {
  HeadingIcon,
  ListBulletIcon,
  ListOrderedIcon,
  ListTodoIcon,
  BlockquoteIcon,
  CodeBlockIcon,
  HorizontalRuleIcon,
  ImagePlusIcon,
  TableIcon,
} from '../icons'
import './slash-command.css'

export const SlashCommandPluginKey = new PluginKey('slash-command')

interface SlashCommandProps {
  editor: Editor
  range: Range
}

interface SlashItem {
  titleKey: string
  descriptionKey: string
  iconKey: string
  pinyin: string
  command: (props: SlashCommandProps) => void
}

function renderIcon(iconComponent: Component): Promise<string> {
  return renderToString(h(iconComponent, { size: 20 }))
}

const iconComponents: Record<string, Component> = {
  heading: HeadingIcon,
  listBullet: ListBulletIcon,
  listOrdered: ListOrderedIcon,
  listTodo: ListTodoIcon,
  blockquote: BlockquoteIcon,
  codeBlock: CodeBlockIcon,
  horizontalRule: HorizontalRuleIcon,
  table: TableIcon,
  imagePlus: ImagePlusIcon,
}

async function renderIcons(): Promise<Record<string, string>> {
  const entries = Object.entries(iconComponents)
  const rendered = await Promise.all(entries.map(([, component]) => renderIcon(component)))
  return Object.fromEntries(entries.map(([key], i) => [key, rendered[i]]))
}

const slashCommandItems: SlashItem[] = [
  { titleKey: 'slash.heading1', descriptionKey: 'slash.heading1Desc', iconKey: 'heading', pinyin: 'h1,bt,bt1,biaoti',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run() } },
  { titleKey: 'slash.heading2', descriptionKey: 'slash.heading2Desc', iconKey: 'heading', pinyin: 'h2,bt,bt2,biaoti',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run() } },
  { titleKey: 'slash.heading3', descriptionKey: 'slash.heading3Desc', iconKey: 'heading', pinyin: 'bt,bt3,biaoti',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run() } },
  { titleKey: 'slash.heading4', descriptionKey: 'slash.heading4Desc', iconKey: 'heading', pinyin: 'h4,bt,bt4,biaoti',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setNode('heading', { level: 4 }).run() } },
  { titleKey: 'slash.bulletList', descriptionKey: 'slash.bulletListDesc', iconKey: 'listBullet', pinyin: 'wxlb,wuxu',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleBulletList().run() } },
  { titleKey: 'slash.orderedList', descriptionKey: 'slash.orderedListDesc', iconKey: 'listOrdered', pinyin: 'yxlb,youxu',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleOrderedList().run() } },
  { titleKey: 'slash.taskList', descriptionKey: 'slash.taskListDesc', iconKey: 'listTodo', pinyin: 'rwlb,renwu',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleTaskList().run() } },
  { titleKey: 'slash.blockquote', descriptionKey: 'slash.blockquoteDesc', iconKey: 'blockquote', pinyin: 'yy,yinyong',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleBlockquote().run() } },
  { titleKey: 'slash.codeBlock', descriptionKey: 'slash.codeBlockDesc', iconKey: 'codeBlock', pinyin: 'dmk,daima',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleCodeBlock().run() } },
  { titleKey: 'slash.horizontalRule', descriptionKey: 'slash.horizontalRuleDesc', iconKey: 'horizontalRule', pinyin: 'fgx,fenge',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setHorizontalRule().run() } },
  { titleKey: 'slash.table', descriptionKey: 'slash.tableDesc', iconKey: 'table', pinyin: 'bg,biaoge',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() } },
  { titleKey: 'slash.imageUrl', descriptionKey: 'slash.imageUrlDesc', iconKey: 'imagePlus', pinyin: 'tp,tupian',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).run(); const url = window.prompt(t('slash.imageUrlPrompt')); if (url) { editor.chain().focus().setImage({ src: url }).run() } } },
]

function filterItems(items: SlashItem[], query: string): SlashItem[] {
  const q = query.toLowerCase()
  return items.filter(item => {
    const title = t(item.titleKey)
    const description = t(item.descriptionKey)
    return title.toLowerCase().includes(q) ||
      description.toLowerCase().includes(q) ||
      (item.pinyin && item.pinyin.toLowerCase().includes(q))
  })
}

interface SlashMenuProps {
  items: SlashItem[]
  command: (item: SlashItem) => void
  clientRect: (() => DOMRect | null) | null
}

export function renderSlashMenu() {
  let popup: HTMLElement | null = null
  let selectedIndex = 0
  let currentItems: SlashItem[] = []
  let currentCommand: ((item: SlashItem) => void) | null = null
  let icons: Record<string, string> = {}

  async function buildHTML(items: SlashItem[], selectedIdx: number): Promise<string> {
    if (!icons.heading) {
      icons = await renderIcons()
    }
    const listHTML = items.map((item, i) => {
      const cls = i === selectedIdx ? 'notion-slash-item selected' : 'notion-slash-item'
      return `<button class="${cls}" data-index="${i}">
        <span class="notion-slash-icon">${icons[item.iconKey]}</span>
        <span class="notion-slash-text">
          <span class="notion-slash-title">${t(item.titleKey)}</span>
          <span class="notion-slash-desc">${t(item.descriptionKey)}</span>
        </span>
      </button>`
    }).join('')

    return `<div class="notion-slash-menu">
      <div class="notion-slash-header">${t('slash.blockTypes')}</div>
      <div class="notion-slash-list">${listHTML}</div>
      ${items.length === 0 ? `<div class="notion-slash-empty">${t('slash.noResults')}</div>` : ''}
    </div>`
  }

  async function render(): Promise<void> {
    if (!popup) return
    popup.innerHTML = await buildHTML(currentItems, selectedIndex)
    popup.querySelectorAll('.notion-slash-item').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault()
        const idx = parseInt(btn.dataset.index ?? '0', 10)
        if (currentItems[idx] && currentCommand) {
          currentCommand(currentItems[idx])
        }
      })
    })
    const selected = popup.querySelector('.notion-slash-item.selected')
    if (selected) {
      (selected as HTMLElement).scrollIntoView({ block: 'nearest' })
    }
  }

  function positionPopup(clientRect: (() => DOMRect | null) | null): void {
    if (!popup || !clientRect) return
    const rect = clientRect()
    if (!rect) return
    const menuHeight = popup.offsetHeight || 320
    const menuWidth = popup.offsetWidth || 280
    const viewportW = window.innerWidth
    const viewportH = window.innerHeight

    popup.style.position = 'fixed'
    popup.style.zIndex = '10000'

    let left = rect.left
    let top = rect.bottom + 6

    if (top + menuHeight > viewportH - 8) {
      top = rect.top - menuHeight - 6
    }
    if (top < 8) {
      top = 8
    }
    if (left + menuWidth > viewportW - 8) {
      left = viewportW - menuWidth - 8
    }
    if (left < 8) {
      left = 8
    }

    popup.style.left = `${left}px`
    popup.style.top = `${top}px`
  }

  return {
    async onStart(props: SlashMenuProps) {
      popup = document.createElement('div')
      document.body.appendChild(popup)
      currentItems = props.items || []
      currentCommand = props.command
      selectedIndex = 0
      await render()
      positionPopup(props.clientRect)
    },
    async onUpdate(props: SlashMenuProps) {
      currentItems = props.items || []
      currentCommand = props.command
      selectedIndex = 0
      await render()
      positionPopup(props.clientRect)
    },
    onKeyDown(props: { event: KeyboardEvent }) {
      if (props.event.key === 'Escape') {
        return true
      }
      if (props.event.key === 'ArrowUp') {
        selectedIndex = (selectedIndex + currentItems.length - 1) % currentItems.length
        render()
        return true
      }
      if (props.event.key === 'ArrowDown') {
        selectedIndex = (selectedIndex + 1) % currentItems.length
        render()
        return true
      }
      if (props.event.key === 'Enter') {
        if (currentItems[selectedIndex] && currentCommand) {
          currentCommand(currentItems[selectedIndex])
        }
        return true
      }
      return false
    },
    onExit() {
      if (popup && popup.parentNode) {
        popup.parentNode.removeChild(popup)
      }
      popup = null
      currentItems = []
      currentCommand = null
    },
  }
}

export const SlashCommand = Extension.create({
  name: 'slashCommand',

  addOptions() {
    return {
      suggestion: {
        char: '/',
        pluginKey: SlashCommandPluginKey,
        command: ({ editor, range, props }: { editor: Editor, range: Range, props: SlashItem }) => {
          props.command({ editor, range })
        },
        items: ({ query }: { query: string }) => filterItems(slashCommandItems, query),
        render: renderSlashMenu,
      },
    }
  },

  addProseMirrorPlugins() {
    return [
      Suggestion({
        editor: this.editor,
        ...this.options.suggestion,
      }),
    ]
  },
})
