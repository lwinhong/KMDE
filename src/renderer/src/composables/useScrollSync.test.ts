import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createScrollSync } from './useScrollSync'

type FakeScroller = EventTarget & { scrollTop: number; scrollHeight: number; clientHeight: number }

function fakeScroller(scrollHeight: number, clientHeight: number): FakeScroller {
  const el = new EventTarget() as FakeScroller
  el.scrollTop = 0
  el.scrollHeight = scrollHeight
  el.clientHeight = clientHeight
  return el
}

function userScroll(el: FakeScroller, scrollTop: number): void {
  el.scrollTop = scrollTop
  el.dispatchEvent(new Event('scroll'))
}

// 程序赋值 scrollTop 后浏览器会异步派发 scroll 事件，这里模拟该回声。
function programmaticEcho(el: FakeScroller): void {
  el.dispatchEvent(new Event('scroll'))
}

test('一侧滚动按比例同步另一侧', () => {
  let time = 0
  const a = fakeScroller(1000, 200)
  const b = fakeScroller(500, 100)
  const sync = createScrollSync(a, b, { now: () => time })
  userScroll(a, 400)
  assert.equal(b.scrollTop, 200)
  time = 200
  userScroll(b, 0)
  assert.equal(a.scrollTop, 0)
  sync.destroy()
})

test('程序滚动的回声事件不反向回写（时间窗内）', () => {
  let time = 0
  const a = fakeScroller(1000, 200)
  const b = fakeScroller(500, 100)
  const sync = createScrollSync(a, b, { now: () => time })
  userScroll(a, 400)
  assert.equal(b.scrollTop, 200)
  time = 50
  programmaticEcho(b)
  assert.equal(a.scrollTop, 400, 'b 侧回声不得把 a 拉回旧位置')
  sync.destroy()
})

test('窗口过后另一侧的用户滚动恢复联动', () => {
  let time = 0
  const a = fakeScroller(1000, 200)
  const b = fakeScroller(500, 100)
  const sync = createScrollSync(a, b, { now: () => time })
  userScroll(a, 400)
  time = 200
  userScroll(b, 100)
  assert.equal(a.scrollTop, 200)
  sync.destroy()
})

test('连续滚动持续刷新回声抑制窗口', () => {
  let time = 0
  const a = fakeScroller(1000, 200)
  const b = fakeScroller(500, 100)
  const sync = createScrollSync(a, b, { now: () => time })
  for (let i = 1; i <= 5; i++) {
    time = i * 40
    userScroll(a, i * 100)
    programmaticEcho(b)
  }
  assert.equal(a.scrollTop, 500)
  assert.equal(b.scrollTop, 250)
  sync.destroy()
})

test('内容不足一屏的一侧不触发同步', () => {
  const a = fakeScroller(200, 200)
  const b = fakeScroller(500, 100)
  const sync = createScrollSync(a, b, { now: () => 0 })
  userScroll(a, 0)
  assert.equal(b.scrollTop, 0)
  sync.destroy()
})

test('destroy 后两侧独立滚动', () => {
  const a = fakeScroller(1000, 200)
  const b = fakeScroller(500, 100)
  const sync = createScrollSync(a, b, { now: () => 0 })
  sync.destroy()
  userScroll(a, 800)
  assert.equal(b.scrollTop, 0)
  userScroll(b, 400)
  assert.equal(a.scrollTop, 800, 'destroy 后 b 的滚动不得改写 a')
})
