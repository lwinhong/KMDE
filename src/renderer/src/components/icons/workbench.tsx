import type { IconProps } from './types'

/* ------------------------- 面板开关 ------------------------- */

/** 侧边栏面板（分隔线靠左） */
export function IconPanelSidebar({ size = 18, strokeWidth = 1.6, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={strokeWidth} aria-hidden="true" {...props}>
      <rect x="3" y="5" width="18" height="16" rx="1.5" />
      <line x1="9" y1="5" x2="9" y2="21" />
    </svg>
  )
}

/** 大纲面板（分隔线靠右） */
export function IconPanelOutline({ size = 18, strokeWidth = 1.6, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width={strokeWidth} aria-hidden="true" {...props}>
      <rect x="3" y="5" width="18" height="16" rx="1.5" />
      <line x1="15" y1="5" x2="15" y2="21" />
    </svg>
  )
}

/* ------------------------- 窗口控制（11x11 视窗，细线风格） ------------------------- */

/** 最小化 */
export function IconWindowMinimize({ size = 12, strokeWidth = 1, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width={strokeWidth} aria-hidden="true" {...props}>
      <path d="M1 5.5 h9" />
    </svg>
  )
}

/** 最大化 */
export function IconWindowMaximize({ size = 12, strokeWidth = 1, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width={strokeWidth} aria-hidden="true" {...props}>
      <rect x="1.5" y="1.5" width="8" height="8" />
    </svg>
  )
}

/** 还原（两层叠窗口） */
export function IconWindowRestore({ size = 12, strokeWidth = 1, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width={strokeWidth} aria-hidden="true" {...props}>
      <rect x="1.5" y="3.5" width="6" height="6" />
      <path d="M3.5 3.5 V1.5 h6 v6 h-2" />
    </svg>
  )
}

/** 关闭窗口 */
export function IconWindowClose({ size = 12, strokeWidth = 1.1, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 11 11" fill="none" stroke="currentColor" stroke-width={strokeWidth} aria-hidden="true" {...props}>
      <path d="M1.5 1.5 L9.5 9.5 M9.5 1.5 L1.5 9.5" />
    </svg>
  )
}
