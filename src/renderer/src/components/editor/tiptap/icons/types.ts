/** tiptap 工具栏图标组件通用 Props */
export interface IconProps {
  /** 图标尺寸（px），默认 18 */
  size?: number | string
  /** 附加类名 */
  className?: string
  /** 其余属性透传到 svg 元素 */
  [key: string]: unknown
}
