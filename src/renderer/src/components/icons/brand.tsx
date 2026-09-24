import type { IconProps } from './types'

/** KMDE 应用 Logo（K 字标，主色随主题变量） */
export function IconLogo({ size = 16, ...props }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" {...props}>
      <rect x="8" y="8" width="240" height="240" rx="56" style="fill: var(--kme-primary)" />
      <path
        d="M78 72 L78 184 M78 128 L150 72 M78 128 L150 184"
        stroke="#fff"
        stroke-width="10"
        stroke-linecap="round"
        fill="none"
      />
      <path d="M168 72 L168 184" stroke="#fff" stroke-width="12" stroke-linecap="round" />
    </svg>
  )
}
