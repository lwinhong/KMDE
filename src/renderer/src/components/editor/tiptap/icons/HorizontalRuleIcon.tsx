import type { IconProps } from './types'

export default function HorizontalRuleIcon({ size = 18, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <rect x="3" y="11" width="18" height="2" rx="1" fill="currentColor" />
    </svg>
  )
}
