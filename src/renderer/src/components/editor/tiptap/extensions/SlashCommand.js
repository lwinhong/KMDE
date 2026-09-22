import { Extension } from '@tiptap/core'
import Suggestion from '@tiptap/suggestion'
import { PluginKey } from 'prosemirror-state'
import { h } from 'vue'
import { renderToString } from 'vue/server-renderer'
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

const SlashCommandPluginKey = new PluginKey('slash-command')

function renderIcon(iconComponent) {
  return renderToString(h(iconComponent, { size: 20 }))
}

const iconComponents = {
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

async function renderIcons() {
  const entries = Object.entries(iconComponents)
  const rendered = await Promise.all(entries.map(([, component]) => renderIcon(component)))
  return Object.fromEntries(entries.map(([key], i) => [key, rendered[i]]))
}

const slashCommandItems = [
  { title: '标题 1', description: '大标题', iconKey: 'heading', pinyin: 'h1,bt,bt1,biaoti',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run() } },
  { title: '标题 2', description: '中标题', iconKey: 'heading', pinyin: 'h2,bt,bt2,biaoti',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run() } },
  { title: '标题 3', description: '小标题', iconKey: 'heading', pinyin: 'bt,bt3,biaoti',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run() } },
  { title: '标题 4', description: '四级标题', iconKey: 'heading', pinyin: 'h4,bt,bt4,biaoti',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setNode('heading', { level: 4 }).run() } },
  // { title: '标题 5', description: '五级标题', iconKey: 'heading', pinyin: 'h5,bt,bt5,biaoti',
  //   command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setNode('heading', { level: 5 }).run() } },
  // { title: '标题 6', description: '六级标题', iconKey: 'heading', pinyin: 'h6,bt,bt6,biaoti',
  //   command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setNode('heading', { level: 6 }).run() } },
  { title: '无序列表', description: '创建无序列表', iconKey: 'listBullet', pinyin: 'wxlb,wuxu',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleBulletList().run() } },
  { title: '有序列表', description: '创建有序列表', iconKey: 'listOrdered', pinyin: 'yxlb,youxu',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleOrderedList().run() } },
  { title: '任务列表', description: '创建任务列表', iconKey: 'listTodo', pinyin: 'rwlb,renwu',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleTaskList().run() } },
  { title: '引用', description: '插入引用块', iconKey: 'blockquote', pinyin: 'yy,yinyong',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleBlockquote().run() } },
  { title: '代码块', description: '插入代码块', iconKey: 'codeBlock', pinyin: 'dmk,daima',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).toggleCodeBlock().run() } },
  { title: '分割线', description: '插入分割线', iconKey: 'horizontalRule', pinyin: 'fgx,fenge',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).setHorizontalRule().run() } },
  { title: '表格', description: '插入 3×3 表格', iconKey: 'table', pinyin: 'bg,biaoge',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() } },
  { title: '图片（URL）', description: '通过链接地址插入图片', iconKey: 'imagePlus', pinyin: 'tp,tupian',
    command: ({ editor, range }) => { editor.chain().focus().deleteRange(range).run(); const url = window.prompt('输入图片地址:'); if (url) { editor.chain().focus().setImage({ src: url }).run() } } },
]

function filterItems(items, query) {
  const q = query.toLowerCase()
  return items.filter(item =>
    item.title.toLowerCase().includes(q) ||
    item.description.toLowerCase().includes(q) ||
    (item.pinyin && item.pinyin.toLowerCase().includes(q))
  )
}

function renderSlashMenu() {
  let popup = null
  let selectedIndex = 0
  let currentItems = []
  let currentCommand = null
  let icons = {}

  async function buildHTML(items, selectedIdx) {
    if (!icons.heading) {
      icons = await renderIcons()
    }
    const listHTML = items.map((item, i) => {
      const cls = i === selectedIdx ? 'notion-slash-item selected' : 'notion-slash-item'
      return `<button class="${cls}" data-index="${i}">
        <span class="notion-slash-icon">${icons[item.iconKey]}</span>
        <span class="notion-slash-text">
          <span class="notion-slash-title">${item.title}</span>
          <span class="notion-slash-desc">${item.description}</span>
        </span>
      </button>`
    }).join('')

    return `<div class="notion-slash-menu">
      <div class="notion-slash-header">块类型</div>
      <div class="notion-slash-list">${listHTML}</div>
      ${items.length === 0 ? '<div class="notion-slash-empty">没有匹配的结果</div>' : ''}
    </div>`
  }

  async function render() {
    if (!popup) return
    popup.innerHTML = await buildHTML(currentItems, selectedIndex)
    popup.querySelectorAll('.notion-slash-item').forEach(btn => {
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault()
        const idx = parseInt(btn.dataset.index)
        if (currentItems[idx] && currentCommand) {
          currentCommand(currentItems[idx])
        }
      })
    })
    const selected = popup.querySelector('.notion-slash-item.selected')
    if (selected) {
      selected.scrollIntoView({ block: 'nearest' })
    }
  }

  function positionPopup(clientRect) {
    if (!popup || !clientRect) return
    const rect = clientRect()
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
    async onStart(props) {
      popup = document.createElement('div')
      document.body.appendChild(popup)
      currentItems = props.items || []
      currentCommand = props.command
      selectedIndex = 0
      await render()
      positionPopup(props.clientRect)
    },
    async onUpdate(props) {
      currentItems = props.items || []
      currentCommand = props.command
      selectedIndex = 0
      await render()
      positionPopup(props.clientRect)
    },
    onKeyDown(props) {
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
        command: ({ editor, range, props }) => {
          props.command({ editor, range })
        },
        items: ({ query }) => filterItems(slashCommandItems, query),
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
