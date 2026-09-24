import type { IconProps } from './types'

/* ------------------------- 方向 ------------------------- */

/** 右尖角箭头（chevron-right） */
export function IconChevronRight({ size = 16, strokeWidth = 2, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={strokeWidth} aria-hidden="true" {...props}>
      <path d="M9 18l6-6-6-6" />
    </svg>
  )
}

/** 左尖角箭头（chevron-left） */
export function IconChevronLeft({ size = 16, strokeWidth = 2, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={strokeWidth} aria-hidden="true" {...props}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

/** 上尖角箭头（chevron-up） */
export function IconChevronUp({ size = 16, strokeWidth = 2, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={strokeWidth} aria-hidden="true" {...props}>
      <path d="m18 15-6-6-6 6" />
    </svg>
  )
}

/** 下尖角箭头（chevron-down） */
export function IconChevronDown({ size = 16, strokeWidth = 2, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={strokeWidth} aria-hidden="true" {...props}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

/* ------------------------- 动作 ------------------------- */

/** 关闭（X） */
export function IconClose({ size = 16, strokeWidth = 2, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={strokeWidth} aria-hidden="true" {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

/** 加号（新建） */
export function IconPlus({ size = 16, strokeWidth = 2, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={strokeWidth} aria-hidden="true" {...props}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

/** 刷新 */
export function IconRefresh({ size = 16, strokeWidth = 2, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={strokeWidth} aria-hidden="true" {...props}>
      <path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" />
    </svg>
  )
}

/** 搜索（放大镜） */
export function IconSearch({ size = 16, strokeWidth = 2, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={strokeWidth} aria-hidden="true" {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  )
}

/** 展开/收起替换行（双向箭头，带箭头端） */
export function IconSwapArrows({ size = 16, strokeWidth = 2, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={strokeWidth} aria-hidden="true" {...props}>
      <path d="M4 7h11a3 3 0 0 1 3 3v0M17 17H6a3 3 0 0 1-3-3v0" />
      <path d="m14 4 3 3-3 3M7 14l-3 3 3 3" />
    </svg>
  )
}

/** 替换（双向弯箭头，无箭头端） */
export function IconReplace({ size = 16, strokeWidth = 2, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={strokeWidth} aria-hidden="true" {...props}>
      <path d="M4 7h11a3 3 0 0 1 3 3v0M17 17H6a3 3 0 0 1-3-3v0" />
    </svg>
  )
}

/* ------------------------- 对象 ------------------------- */

/** 文件夹 */
export function IconFolder({ size = 16, strokeWidth = 2, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={strokeWidth} aria-hidden="true" {...props}>
      <path d="M3 7c0-1.1.9-2 2-2h4l2 2h8c1.1 0 2 .9 2 2v8c0 1.1-.9 2-2 2H5c-1.1 0-2-.9-2-2V7z" />
    </svg>
  )
}
