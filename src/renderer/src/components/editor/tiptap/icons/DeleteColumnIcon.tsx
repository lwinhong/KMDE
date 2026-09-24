import type { IconProps } from './types'

export default function DeleteColumnIcon({ size = 18, className, ...props }: IconProps) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 1024 1024" version="1.1" xmlns="http://www.w3.org/2000/svg" {...props}>
      <path d="M244.48 128v768h-85.333333V128h85.333333z m559.786667 446.293333l60.586666 60.586667L774.4 725.333333l90.453333 90.453334-60.586666 60.586666-90.496-90.453333-90.410667 90.453333-60.16-60.586666 90.154667-90.325334-90.581334-90.581333 60.586667-60.586667 90.538667 90.538667 90.368-90.538667zM457.813333 128v512h-85.333333V128h85.333333z m213.333334 0v256h-85.333334V128h85.333334z" fill="currentColor" />
    </svg>
  )
}
