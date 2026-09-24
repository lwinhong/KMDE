/** 图标组件通用 Props */
export interface IconProps {
  /** 图标尺寸（px），默认 16 */
  size?: number | string
  /** 覆盖默认描边宽度 */
  strokeWidth?: number | string
  /** 附加类名 */
  className?: string
  /** 其余属性透传到 svg 根元素 */
  [key: string]: unknown
}
