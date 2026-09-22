# KMDE

[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![Tiptap](https://img.shields.io/badge/Tiptap-3-6A9FD8)](https://tiptap.dev/)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-0078D4?logo=windows11&logoColor=white)](https://github.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

**English** | [简体中文](README.zh-CN.md)

A Typora-style Markdown editor for Windows, built with **Electron + Vue 3 + Tiptap**. WYSIWYG and source-code dual-mode editing, workspace file tree with external change detection, and fully offline HTML / PDF export.

If you are looking for an open-source, lightweight Typora alternative with live preview WYSIWYG editing, KMDE is for you.

## Features

### Editor
- **Dual editing modes**: WYSIWYG (Tiptap v3) and source mode (CodeMirror 6), toggle with `Ctrl+/`
- **Rich Markdown support**: tables, task lists, highlights, sub/superscript, typography transforms, collapsible details blocks
- **Syntax highlighting**: code blocks powered by highlight.js / lowlight
- **Math formulas**: KaTeX inline and block equations
- **Mermaid diagrams**: `mermaid` code blocks rendered live inside the editor
- **Slash commands**: type `/` to open a block-insert menu
- **Smart paste**: paste extension normalizes external content and images
- Large files automatically fall back to source mode (> 2 MB)

### Workspace
- **File tree sidebar**: open a folder as a workspace; create / rename / delete files and folders
- **Multi-tab editing**: dirty-state markers, unsaved-close confirmation
- **External change detection**: workspace watched with chokidar; when a file is modified externally while you have unsaved edits, a conflict dialog lets you compare and choose
- **Outline panel**: document headings hierarchy with click-to-jump
- **Quick open**: `Ctrl+P` fuzzy file search; `Ctrl+Shift+P` command palette

### Export
- **HTML export**: standalone HTML plus a `KMDE-assets/` folder (KaTeX fonts, hljs themes, mermaid) — works completely offline
- **PDF export**: driven by the same rendering pipeline
- Export assets are extracted from local dependencies by `scripts/prepare-export-assets.mjs`, no network required

### Desktop Integration
- Frameless window with custom title bar (minimize / maximize / close)
- Single-instance lock: reopening a `.md` file focuses the existing window
- File associations: `md` / `markdown` / `mdown`
- Dark / light theme (`F11`), built on the Naive UI theming system
- Persistent settings (theme, font size, default mode, panel visibility, last workspace) stored in `%APPDATA%/kmde/settings.json`

## Tech Stack

| Layer | Technology |
| --- | --- |
| Framework | Electron 44 + electron-vite 5 |
| Renderer | Vue 3.5 + Pinia 4 + Naive UI 2 |
| Rich text | Tiptap 3 (Markdown serialization) |
| Source editing | CodeMirror 6 |
| File watching | chokidar 5 |
| Rendering assets | KaTeX, highlight.js, lowlight, mermaid |

## Getting Started

Requirements: Node.js ≥ 20, pnpm.

```bash
# Install dependencies
pnpm install

# Development mode (main process hot reload + renderer HMR)
pnpm dev

# Type checking
pnpm typecheck:node   # main / preload
pnpm typecheck:web    # renderer
```

## Packaging (Windows)

```bash
pnpm build:win
```

This runs three steps:

1. `scripts/prepare-export-assets.mjs` — copies KaTeX / hljs / mermaid assets into `resources/export-assets/`
2. `electron-vite build` — bundles main, preload, and renderer into `out/`
3. `electron-builder --win nsis` — produces an NSIS installer in `dist/`

See [electron-builder.yml](electron-builder.yml) for build options: per-user install, custom installation directory, `.md` / `.markdown` file associations.

> Development mode uses a separate `userData` directory (`%APPDATA%/kmde-dev`) so it never fights with an installed KMDE over the single-instance lock.

## Project Structure

```
src/
├── main/              # Main process
│   ├── index.ts       # Window creation, single-instance lock, file associations, protocols
│   ├── ipc/           # IPC handlers (file system, dialogs, settings, export)
│   ├── watcher.ts     # chokidar workspace watcher (with self-write marking)
│   └── menu.ts        # Application menu and accelerators
├── preload/           # contextBridge exposing the window.kmde API
├── shared/            # Types and constants shared by main / renderer
└── renderer/
    ├── src/
    │   ├── stores/        # Pinia: tabs, workspace, settings
    │   ├── components/
    │   │   ├── workbench/ # Layout, title bar, tab bar, status bar, welcome page
    │   │   ├── sidebar/   # File tree
    │   │   ├── editor/    # Tiptap editor + CodeMirror source editor
    │   │   ├── outline/   # Outline panel
    │   │   ├── palette/   # Quick open / command palette
    │   │   ├── conflict/  # External change conflict dialog
    │   │   └── export/    # Export dialog
    │   ├── export/        # HTML export pipeline (offline assets)
    │   └── styles/        # Theme variables (dark / light)
    └── index.html
scripts/
└── prepare-export-assets.mjs   # Extract offline export assets
resources/
└── export-assets/              # KaTeX / hljs / mermaid static assets
```

## Security

- Renderer runs with `contextIsolation` enabled and `nodeIntegration` disabled; all file operations go through a whitelisted preload API
- Strict path validation at every IPC entry (absolute paths, NUL-byte rejection), filename character filtering
- 64 MB file read limit; workspace tree ignores `node_modules`, `.git`, `dist`, `out`, etc.
- CSP response header injected in production, restricting script / style / image origins
- Custom `kmd-file://` protocol for safely loading local image resources
