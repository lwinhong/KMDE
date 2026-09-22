# KMDE

[![Electron](https://img.shields.io/badge/Electron-44-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D?logo=vuedotjs&logoColor=white)](https://vuejs.org/)
[![Tiptap](https://img.shields.io/badge/Tiptap-3-6A9FD8)](https://tiptap.dev/)
[![Platform](https://img.shields.io/badge/platform-Windows%2010%20%2F%2011-0078D4?logo=windows11&logoColor=white)](https://github.com/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

[English](README.md) | **简体中文**

KMDE 是一款 Typora 风格的桌面 Markdown 编辑器，基于 Electron + Vue 3 + Tiptap 构建，支持所见即所得与源码双模式编辑、工作区文件树、外部变更检测，以及离线导出 HTML / PDF。

## 功能特性

### 编辑器
- **双模式编辑**：所见即所得（Tiptap v3）与源码模式（CodeMirror 6），`Ctrl+/` 快速切换
- **丰富的 Markdown 支持**：表格、任务列表、高亮、上下标、脚注式排版（Typography）、折叠块（Details）
- **代码高亮**：基于 highlight.js / lowlight 的代码块高亮
- **数学公式**：KaTeX 行内与块级公式
- **Mermaid 图表**：`mermaid` 代码块在编辑器内实时渲染
- **Slash 命令**：输入 `/` 唤起块级元素插入菜单
- **智能粘贴**：粘贴扩展自动处理外部内容与图片
- 大文件自动降级：超过 2MB 的文件强制使用源码模式

### 工作区
- **文件树侧边栏**：打开文件夹作为工作区，支持新建 / 重命名 / 删除文件与文件夹
- **多标签页**：脏状态标记、未保存关闭确认
- **外部变更检测**：基于 chokidar 监听工作区，文件被外部修改且本地有未保存内容时弹出冲突对比对话框
- **大纲面板**：按标题层级展示文档结构，支持跳转
- **快速打开**：`Ctrl+P` 模糊搜索打开文件；`Ctrl+Shift+P` 命令面板

### 导出
- **HTML 导出**：生成独立 HTML，配套 `KMDE-assets/` 目录（KaTeX 字体、hljs 主题、mermaid），完全离线可用
- **PDF 导出**：基于同一渲染管线输出 PDF
- 导出资源由 `scripts/prepare-export-assets.mjs` 从本地依赖提取，无需网络

### 桌面集成
- 无边框窗口 + 自定义标题栏（最小化 / 最大化 / 关闭）
- 单实例锁：重复打开或双击 `.md` 文件时聚焦已有窗口
- 文件关联：`md` / `markdown` / `mdown`
- 深色 / 浅色主题（`F11` 切换），跟随 Naive UI 主题系统
- 设置持久化（主题、字号、默认模式、面板可见性、上次工作区），存于 `%APPDATA%/kmde/settings.json`

## 技术栈

| 层 | 技术 |
| --- | --- |
| 框架 | Electron 44 + electron-vite 5 |
| 渲染层 | Vue 3.5 + Pinia 4 + Naive UI 2 |
| 富文本 | Tiptap 3（Markdown 序列化） |
| 源码编辑 | CodeMirror 6 |
| 文件监听 | chokidar 5 |
| 渲染资源 | KaTeX、highlight.js、lowlight、mermaid |

## 快速开始

环境要求：Node.js ≥ 20，pnpm。

```bash
# 安装依赖
pnpm install

# 开发模式（主进程热重载 + 渲染层 HMR）
pnpm dev

# 类型检查
pnpm typecheck:node   # 主进程 / preload
pnpm typecheck:web    # 渲染层
```

## 打包（Windows）

```bash
pnpm build:win
```

该命令依次执行：

1. `scripts/prepare-export-assets.mjs` — 将 KaTeX / hljs / mermaid 资源复制到 `resources/export-assets/`
2. `electron-vite build` — 构建主进程、preload、渲染层到 `out/`
3. `electron-builder --win nsis` — 产出 NSIS 安装包到 `dist/`

产物配置见 [electron-builder.yml](electron-builder.yml)：按用户安装、允许自定义安装目录、注册 `.md` / `.markdown` 文件关联。

> 开发模式使用独立的 `userData` 目录（`%APPDATA%/kmde-dev`），避免与已安装版本争抢单实例锁。

## 目录结构

```
src/
├── main/              # 主进程
│   ├── index.ts       # 窗口创建、单实例锁、文件关联、协议注册
│   ├── ipc/           # IPC 处理器（文件系统、对话框、设置、导出）
│   ├── watcher.ts     # chokidar 工作区监听（含自写入标记）
│   └── menu.ts        # 应用菜单与快捷键
├── preload/           # contextBridge 暴露 window.kmde API
├── shared/            # 主/渲染进程共享类型与常量
└── renderer/
    ├── src/
    │   ├── stores/        # Pinia：tabs、workspace、settings
    │   ├── components/
    │   │   ├── workbench/ # 布局、标题栏、标签栏、状态栏、欢迎页
    │   │   ├── sidebar/   # 文件树
    │   │   ├── editor/    # Tiptap 编辑器 + CodeMirror 源码编辑器
    │   │   ├── outline/   # 大纲面板
    │   │   ├── palette/   # 快速打开 / 命令面板
    │   │   ├── conflict/  # 外部变更冲突对话框
    │   │   └── export/    # 导出对话框
    │   ├── export/        # HTML 导出管线（离线资源内联）
    │   └── styles/        # 主题变量（深/浅色）
    └── index.html
scripts/
└── prepare-export-assets.mjs   # 提取离线导出资源
resources/
└── export-assets/              # KaTeX / hljs / mermaid 静态资源
```

## 安全设计

- 渲染进程 `contextIsolation` 开启、`nodeIntegration` 关闭，所有文件操作经由 preload 白名单 API
- IPC 入口对路径做严格校验（绝对路径、拒绝空字节），文件名过滤非法字符
- 文件读取上限 64MB，工作区目录树忽略 `node_modules`、`.git`、`dist`、`out` 等目录
- 生产环境注入 CSP 响应头，限制脚本 / 样式 / 图片来源
- 自定义 `kmd-file://` 协议用于安全加载本地图片资源
