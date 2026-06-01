import { useEffect } from 'react'

interface Props {
  src: string
  onClose: () => void
}

export function ImagePreview({ src, onClose }: Props) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 bg-slate-950/80 flex items-center justify-center p-4 sm:p-8" onClick={onClose}>
      <button
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 px-3 py-1.5 text-sm text-white backdrop-blur hover:bg-white/20"
      >
        关闭
      </button>
      <img
        src={src}
        className="max-w-full max-h-full rounded-lg shadow-2xl"
        onClick={e => e.stopPropagation()}
        alt=""
      />
    </div>
  )
}
