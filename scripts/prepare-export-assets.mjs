/**
 * Prepares local (offline) export assets into resources/export-assets.
 * Run before packaging; also usable in dev so exports work offline.
 *
 * Layout produced:
 *   resources/export-assets/
 *     katex/katex.min.css
 *     katex/fonts/*                      (relative refs from katex.min.css)
 *     hljs/hljs-common.min.js            (esbuild IIFE bundle of common languages)
 *     hljs/github.min.css
 *     hljs/github-dark.min.css
 *     mermaid/mermaid.min.js             (IIFE, all diagrams inlined)
 */
import { cpSync, mkdirSync, rmSync, existsSync, readdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources', 'export-assets')

function pkgDir(name) {
  return dirname(require.resolve(`${name}/package.json`))
}

rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// ---- katex ----
const katexDir = pkgDir('katex')
mkdirSync(join(outDir, 'katex', 'fonts'), { recursive: true })
cpSync(join(katexDir, 'dist', 'katex.min.css'), join(outDir, 'katex', 'katex.min.css'))
for (const f of readdirSync(join(katexDir, 'dist', 'fonts'))) {
  if (/\.(woff2|ttf)$/.test(f)) {
    cpSync(join(katexDir, 'dist', 'fonts', f), join(outDir, 'katex', 'fonts', f))
  }
}

// ---- highlight.js theme css ----
const hljsDir = pkgDir('highlight.js')
mkdirSync(join(outDir, 'hljs'), { recursive: true })
cpSync(join(hljsDir, 'styles', 'github.min.css'), join(outDir, 'hljs', 'github.min.css'))
cpSync(join(hljsDir, 'styles', 'github-dark.min.css'), join(outDir, 'hljs', 'github-dark.min.css'))

// ---- highlight.js runtime bundle (IIFE, offline-friendly on file://) ----
const esbuild = await import('esbuild')
await esbuild.build({
  entryPoints: [join(hljsDir, 'lib', 'common.js')],
  bundle: true,
  format: 'iife',
  globalName: '__hljsBundle',
  minify: true,
  outfile: join(outDir, 'hljs', 'hljs-common.min.js'),
  platform: 'browser',
  logLevel: 'silent'
})

// ---- mermaid IIFE ----
const mermaidDir = pkgDir('mermaid')
mkdirSync(join(outDir, 'mermaid'), { recursive: true })
cpSync(join(mermaidDir, 'dist', 'mermaid.min.js'), join(outDir, 'mermaid', 'mermaid.min.js'))

if (!existsSync(join(outDir, 'mermaid', 'mermaid.min.js'))) {
  throw new Error('mermaid.min.js missing after copy')
}
console.log(`[prepare-export-assets] done -> ${outDir}`)
