import { useId } from 'react'

interface BrandMarkProps {
  className?: string
}

export function BrandMark({ className = 'h-10 w-10' }: BrandMarkProps) {
  const id = useId().replace(/:/g, '')
  const planetId = `${id}-planet`
  const ringId = `${id}-ring`

  return (
    <svg className={className} viewBox="0 0 48 48" role="img" aria-label="炼化星球">
      <defs>
        <linearGradient id={planetId} x1="12" x2="37" y1="10" y2="38" gradientUnits="userSpaceOnUse">
          <stop stopColor="#4f46e5" />
          <stop offset="0.58" stopColor="#0f766e" />
          <stop offset="1" stopColor="#f59e0b" />
        </linearGradient>
        <linearGradient id={ringId} x1="7" x2="42" y1="15" y2="34" gradientUnits="userSpaceOnUse">
          <stop stopColor="#14b8a6" />
          <stop offset="1" stopColor="#6366f1" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="13" fill="#0f172a" />
      <path
        d="M8.8 29.4c5.2 5.7 24.7 4.4 30.7-2.1 2.4-2.7 1.3-5-2.5-6.2"
        fill="none"
        stroke={`url(#${ringId})`}
        strokeLinecap="round"
        strokeWidth="3"
      />
      <circle cx="24" cy="24" r="12" fill={`url(#${planetId})`} />
      <path
        d="M17.5 25.2c4.2 2.5 11 2 15.1-1.1"
        fill="none"
        stroke="#f8fafc"
        strokeLinecap="round"
        strokeOpacity="0.85"
        strokeWidth="2"
      />
      <path d="M25.5 12.5 24 18.2l4.3-1.1-2.1 6.4" fill="none" stroke="#fff7ed" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
      <circle cx="35.5" cy="13" r="2.4" fill="#fde68a" />
      <circle cx="13.8" cy="36.1" r="1.6" fill="#99f6e4" />
    </svg>
  )
}
