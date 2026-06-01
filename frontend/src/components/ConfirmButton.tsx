import { useState, useEffect, useRef } from 'react'
import type { ReactNode } from 'react'

interface Props {
  onConfirm: () => void
  children: ReactNode
  confirmText?: string
  className?: string
}

export function ConfirmButton({ onConfirm, children, confirmText = '确定?', className = '' }: Props) {
  const [confirming, setConfirming] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  function handleClick(e: React.MouseEvent) {
    e.stopPropagation()
    if (confirming) {
      onConfirm()
      setConfirming(false)
    } else {
      setConfirming(true)
      timer.current = setTimeout(() => setConfirming(false), 3000)
    }
  }

  return (
    <button
      onClick={handleClick}
      className={`${className} ${confirming ? 'text-red-600 font-medium' : ''}`}
    >
      {confirming ? confirmText : children}
    </button>
  )
}
