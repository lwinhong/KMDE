import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { build } from 'vite'

// 用法：node scripts/test-session-renderer.mjs [store|persistence]
// 只在内存中转译，不读取应用构建配置、不生成产物、不安装依赖。
const root = fileURLToPath(new URL('../', import.meta.url))
const suites = {
  store: 'src/renderer/src/stores/tabs.store.test.ts',
  persistence: 'src/renderer/src/composables/useDocumentPersistence.test.ts',
  workspace: 'src/renderer/src/stores/workspace.store.test.ts',
  tree: 'src/renderer/src/composables/useFileTree.test.ts'
}
const selected = process.argv.slice(2)
if (selected.some((name) => !Object.hasOwn(suites, name))) {
  console.error('用法：node scripts/test-session-renderer.mjs [store|persistence]')
  process.exitCode = 1
} else {
  // data URL 无法解析裸包名，外置为本项目已安装包的绝对 URL；不替换 Vue/Pinia 实现。
  const packages = new Map(['vue', 'pinia', 'vue-i18n'].map((name) => [name, import.meta.resolve(name)]))
  for (const name of selected.length ? [...new Set(selected)] : Object.keys(suites)) {
    try {
      const entry = resolve(root, suites[name])
      console.log(`\n会话测试：${suites[name]}`)
      const result = await build({
        root,
        configFile: false,
        envDir: false,
        publicDir: false,
        logLevel: 'warn',
        resolve: {
          alias: { '@': resolve(root, 'src/renderer/src'), '@shared': resolve(root, 'src/shared') }
        },
        plugins: [{
          name: 'session-test-installed-packages',
          enforce: 'pre',
          resolveId(id) {
            const url = packages.get(id)
            if (url) return { id: url, external: true }
          }
        }],
        build: {
          ssr: entry,
          target: 'node24',
          write: false,
          emptyOutDir: false,
          copyPublicDir: false,
          minify: false,
          sourcemap: false
        }
      })
      assert.ok(!Array.isArray(result) && 'output' in result, '必须得到单个内存构建结果')
      const chunks = result.output.filter((item) => item.type === 'chunk')
      assert.equal(chunks.length, 1, '测试入口必须完整打包，不能遗留相对 chunk 引用')
      // 使用便于定位的虚拟源名，避免断言失败时输出整段 data URL。
      const code = `${chunks[0].code}\n//# sourceURL=${pathToFileURL(entry).href}?bundled\n`
      const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`
      // 每套测试使用独立 Node 进程，隔离全局 API、Pinia 单例和模拟时钟。
      // 经标准输入传递，绕过 Windows 命令行长度限制；node:test 自动设置失败退出码。
      const status = await new Promise((accept, reject) => {
        const child = spawn(process.execPath, ['--input-type=module', '--test-reporter=tap'], {
          cwd: root,
          env: { ...process.env, NODE_ENV: 'test' },
          stdio: ['pipe', 'inherit', 'inherit']
        })
        child.once('error', reject)
        child.stdin.once('error', reject)
        child.once('exit', (code, signal) => accept(signal ? 1 : code ?? 1))
        child.stdin.end(`await import(${JSON.stringify(url)})\n`)
      })
      if (status !== 0) process.exitCode = 1
    } catch (error) {
      console.error(`测试入口失败：${name}`, error)
      process.exitCode = 1
    }
  }
}
