import assert from 'node:assert/strict'
import { test } from 'node:test'
import { computeTextDiff } from './textDiff'

test('相同内容返回 null', () => {
  assert.equal(computeTextDiff('# hello', '# hello'), null)
  assert.equal(computeTextDiff('', ''), null)
})

test('尾部追加只报告追加区间', () => {
  assert.deepEqual(computeTextDiff('abc', 'abcdef'), { from: 3, to: 3, insert: 'def' })
})

test('头部插入只报告插入区间', () => {
  assert.deepEqual(computeTextDiff('bc', 'abc'), { from: 0, to: 0, insert: 'a' })
})

test('中间修改保留公共前后缀', () => {
  assert.deepEqual(computeTextDiff('abcXYZghi', 'abc123ghi'), { from: 3, to: 6, insert: '123' })
})

test('删除中间片段', () => {
  assert.deepEqual(computeTextDiff('abcdefgh', 'abefgh'), { from: 2, to: 4, insert: '' })
})

test('完全不同退化为全量替换', () => {
  assert.deepEqual(computeTextDiff('aaa', 'bbb'), { from: 0, to: 3, insert: 'bbb' })
})

test('清空与从空创建', () => {
  assert.deepEqual(computeTextDiff('abc', ''), { from: 0, to: 3, insert: '' })
  assert.deepEqual(computeTextDiff('', 'abc'), { from: 0, to: 0, insert: 'abc' })
})

test('应用差异后得到 next，与 CodeMirror changes 语义一致', () => {
  const cases: Array<[string, string]> = [
    ['abc', 'abcdef'],
    ['abcXYZghi', 'abc123ghi'],
    ['aaa', 'bbb'],
    ['多行\r\n文档\r\n内容', '多行\r\n文档改动\r\n内容'],
    ['x', ''],
    ['# a\n\n# b', '# a\n\n## b\n\n# c']
  ]
  for (const [current, next] of cases) {
    const change = computeTextDiff(current, next)
    assert.ok(change)
    const applied = current.slice(0, change.from) + change.insert + current.slice(change.to)
    assert.equal(applied, next, `差异应用结果应还原 next：${current} -> ${next}`)
  }
})
