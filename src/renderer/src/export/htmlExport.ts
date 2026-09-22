import { Editor } from '@tiptap/core'
import { buildExportExtensions } from '../components/editor/tiptap/extensions'
import { dirname } from '@/stores/pathUtils'

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

export function renderMarkdownHtml(markdown: string, docPath: string | null): string {
  const editor = new Editor({
    content: markdown,
    editable: false,
    extensions: buildExportExtensions(docPath),
    contentType: 'markdown'
  })
  try {
    return editor.getHTML()
  } finally {
    editor.destroy()
  }
}

const EXPORT_CSS = `
:root { --text: #24292f; --muted: #57606a; --border: #d0d7de; --code-bg: #f6f8fa; --primary: #0969da; }
* { box-sizing: border-box; }
body {
  margin: 0;
  padding: 48px 24px 96px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', sans-serif;
  color: var(--text);
  font-size: 16px;
  line-height: 1.75;
  background: #ffffff;
}
.page { max-width: 820px; margin: 0 auto; }
h1, h2, h3, h4, h5, h6 { line-height: 1.3; margin: 1.6em 0 0.6em; font-weight: 600; }
h1 { font-size: 1.9em; border-bottom: 1px solid var(--border); padding-bottom: 0.3em; }
h2 { font-size: 1.45em; border-bottom: 1px solid var(--border); padding-bottom: 0.25em; }
h3 { font-size: 1.22em; }
h4 { font-size: 1.05em; }
p { margin: 0.7em 0; }
a { color: var(--primary); text-decoration: none; }
a:hover { text-decoration: underline; }
img { max-width: 100%; }
ul, ol { padding-left: 1.6em; }
li { margin: 0.25em 0; }
li > p { margin: 0.3em 0; }
ul.contains-task-list, ul[data-type="taskList"] { list-style: none; padding-left: 0.4em; }
ul[data-type="taskList"] li { display: flex; align-items: baseline; gap: 8px; }
ul[data-type="taskList"] li > label { flex-shrink: 0; }
blockquote {
  margin: 0.8em 0;
  padding: 4px 16px;
  border-left: 4px solid var(--border);
  color: var(--muted);
  background: var(--code-bg);
  border-radius: 0 4px 4px 0;
}
code {
  font-family: 'JetBrains Mono', Consolas, 'Courier New', monospace;
  font-size: 0.88em;
  background: var(--code-bg);
  border-radius: 4px;
  padding: 2px 5px;
}
pre {
  background: var(--code-bg);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 14px 16px;
  overflow-x: auto;
  line-height: 1.55;
}
pre code { background: transparent; padding: 0; font-size: 0.85em; }
table { border-collapse: collapse; margin: 1em 0; display: block; overflow-x: auto; max-width: 100%; }
th, td { border: 1px solid var(--border); padding: 7px 12px; }
th { background: var(--code-bg); font-weight: 600; }
tr:nth-child(2n) td { background: #fbfcfd; }
hr { border: none; border-top: 2px solid var(--border); margin: 2em 0; }
details { border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; margin: 0.8em 0; }
details summary { font-weight: 600; cursor: pointer; }
mark { background: #fff3c4; padding: 1px 3px; border-radius: 3px; }
.katex-display { overflow-x: auto; padding: 4px 0; }
sub, sup { line-height: 0; }
.mermaid { text-align: center; margin: 1em 0; }
.kmde-footer { margin-top: 64px; padding-top: 16px; border-top: 1px solid var(--border); color: var(--muted); font-size: 12px; text-align: center; }
@media print {
  body { padding: 24px 0 48px; }
  .kmde-footer { display: none; }
  pre, blockquote, table, img { break-inside: avoid; }
  h1, h2, h3, h4 { break-after: avoid; }
}
`

export interface ExportHtmlOptions {
  title: string
  markdown: string
  docPath: string | null
}

export function buildExportHtml(options: ExportHtmlOptions): string {
  const bodyHtml = renderMarkdownHtml(options.markdown, options.docPath)
  const hasMermaid = /<pre[^>]*><code[^>]*language-mermaid/.test(bodyHtml)
  const hljsTheme = 'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/styles/github.min.css'
  const katexCss = 'https://cdn.jsdelivr.net/npm/katex@0.16.11/dist/katex.min.css'
  const hljsScript = 'https://cdn.jsdelivr.net/gh/highlightjs/cdn-release@11.9.0/build/highlight.min.js'
  const mermaidScript = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'

  const readyFallback = hasMermaid ? '' : '<script>window.__exportReady = true<\/script>'

  const mermaidBoot = hasMermaid
    ? `<script type="module">
  try {
    const mermaid = (await import('${mermaidScript}')).default;
    mermaid.initialize({ startOnLoad: false, theme: 'neutral', securityLevel: 'loose' });
    const blocks = Array.from(document.querySelectorAll('pre code.language-mermaid'));
    for (let i = 0; i < blocks.length; i++) {
      const b = blocks[i];
      try {
        const { svg } = await mermaid.render('kmde-mermaid-' + i, b.textContent || '');
        const wrap = document.createElement('div');
        wrap.className = 'mermaid';
        wrap.innerHTML = svg;
        b.closest('pre').replaceWith(wrap);
      } catch (e) {
        console.warn('mermaid render failed', e);
      }
    }
  } catch (e) {
    console.warn('mermaid load failed', e);
  }
  window.__exportReady = true;
<\/script>`
    : ''

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escapeHtml(options.title)}</title>
<link rel="stylesheet" href="${katexCss}">
<link rel="stylesheet" href="${hljsTheme}">
<style>${EXPORT_CSS}</style>
</head>
<body>
<div class="page">
${bodyHtml}
<div class="kmde-footer">由 KMDE 导出</div>
</div>
${readyFallback}
<script src="${hljsScript}"><\/script>
<script>if (window.hljs) { document.querySelectorAll('pre code:not(.language-mermaid)').forEach((b) => { try { hljs.highlightElement(b); } catch (e) {} }); }<\/script>
${mermaidBoot}
</body>
</html>`
}

export function defaultExportPath(docPath: string | null, fileName: string, ext: 'html' | 'pdf'): string {
  const base = docPath
    ? `${dirname(docPath)}/${fileName.replace(/\.(md|markdown|mdown|txt)$/i, '')}.${ext}`
    : `${fileName.replace(/\.(md|markdown|mdown|txt)$/i, '')}.${ext}`
  return base
}
