/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode } from 'react'
import { CheckCircle, CircleAlert, TriangleAlert, X } from 'lucide-react'

interface ToastItem {
  id: number
  message: string
  type: 'success' | 'error' | 'warning'
}

interface ToastContextType {
  success: (msg: string) => void
  error: (msg: string) => void
  warning: (msg: string) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

let nextId = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const add = useCallback((message: string, type: ToastItem['type']) => {
    const id = nextId++
    setToasts(prev => [...prev, { id, message, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 2500)
  }, [])

  const ctx: ToastContextType = {
    success: (msg) => add(msg, 'success'),
    error: (msg) => add(msg, 'error'),
    warning: (msg) => add(msg, 'warning'),
  }

  const colors = {
    success: 'bg-white text-slate-900 border-emerald-200',
    error: 'bg-white text-slate-900 border-rose-200',
    warning: 'bg-white text-slate-900 border-amber-200',
  }
  const accents = {
    success: 'text-emerald-600 bg-emerald-50',
    error: 'text-rose-600 bg-rose-50',
    warning: 'text-amber-600 bg-amber-50',
  }
  const progress = {
    success: 'bg-emerald-500',
    error: 'bg-rose-500',
    warning: 'bg-amber-500',
  }
  const icons = {
    success: CheckCircle,
    error: CircleAlert,
    warning: TriangleAlert,
  }

  return (
    <ToastContext.Provider value={ctx}>
      {children}
      <div className="fixed right-4 top-4 z-50 flex w-[calc(100vw-32px)] max-w-sm flex-col gap-2">
        {toasts.map(t => (
          <div key={t.id} className={`relative flex overflow-hidden items-start gap-3 rounded-lg border p-3 pb-4 text-sm leading-5 shadow-xl shadow-slate-900/10 animate-in ${colors[t.type]}`}>
            <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md ${accents[t.type]}`}>
              {(() => {
                const Icon = icons[t.type]
                return <Icon size={16} />
              })()}
            </span>
            <div className="min-w-0 flex-1 break-words text-slate-700">{t.message}</div>
            <button
              onClick={() => setToasts(prev => prev.filter(item => item.id !== t.id))}
              className="rounded-md p-1 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
              aria-label="关闭提示"
            >
              <X size={14} />
            </button>
            <span className={`toast-progress absolute bottom-0 left-0 h-1 ${progress[t.type]}`} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx
}
