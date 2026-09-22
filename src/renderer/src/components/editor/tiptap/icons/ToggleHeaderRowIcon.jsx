export default function ToggleHeaderRowIcon({ size = 18, className, ...props }) {
  return (
    <svg width={size} height={size} className={className} viewBox="0 0 24 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg" {...props}>
      <rect x="3" y="3" width="18" height="18" rx="2" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="3" y="3" width="18" height="5" fill="currentColor" opacity="0.2" />
      <line x1="3" y1="8" x2="21" y2="8" stroke="currentColor" strokeWidth="1.5" />
      <line x1="3" y1="13" x2="21" y2="13" stroke="currentColor" strokeWidth="1.5" />
      <line x1="3" y1="18" x2="21" y2="18" stroke="currentColor" strokeWidth="1.5" />
      <line x1="9" y1="3" x2="9" y2="21" stroke="currentColor" strokeWidth="1.5" />
      <line x1="15" y1="3" x2="15" y2="21" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}
