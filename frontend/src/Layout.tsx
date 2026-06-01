import { useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { BookOpen, FlaskConical, LayoutGrid, LogOut, Menu, Settings2, Sparkles, X } from 'lucide-react'
import { api } from './api'

const navItems = [
  { href: '/groups', label: '我的星球', icon: LayoutGrid },
  { href: '/skills', label: '炼化记录', icon: BookOpen },
  { href: '/config', label: '模型配置', icon: Settings2 },
]

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)

  const isActive = (href: string) => location.pathname.startsWith(href)

  async function handleLogout() {
    await api('/api/logout', { method: 'POST' })
    navigate('/login', { replace: true })
  }

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-5 pt-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-lg shadow-indigo-600/20">
            <FlaskConical size={21} />
          </div>
          <div>
            <p className="text-base font-semibold text-slate-950">炼化星球</p>
            <p className="mt-0.5 text-xs text-slate-500">Knowledge Refinery</p>
          </div>
        </div>
      </div>

      <div className="mx-3 rounded-lg border border-indigo-100 bg-indigo-50/80 px-3 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-indigo-800">
          <Sparkles size={14} />
          工作流
        </div>
        <p className="mt-1 text-xs leading-5 text-indigo-700/80">选择帖子，下载素材，沉淀为可复用的 SKILL。</p>
      </div>

      <nav className="mt-5 flex-1 space-y-1 px-3">
        {navItems.map(item => (
          <button
            key={item.href}
            onClick={() => {
              navigate(item.href)
              setMobileOpen(false)
            }}
            className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm transition-all duration-200 ${
              isActive(item.href)
                ? 'bg-slate-950 text-white shadow-md shadow-slate-950/10'
                : 'text-slate-600 hover:bg-white hover:text-slate-950 hover:shadow-sm'
            }`}
          >
            <item.icon size={18} />
            {item.label}
          </button>
        ))}
      </nav>

      <div className="px-3 pb-4">
        <button
          onClick={handleLogout}
          className="flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600"
        >
          <LogOut size={18} />
          退出登录
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(79,70,229,0.10),_transparent_34%),linear-gradient(180deg,#fbfaf7_0%,#f5f7fb_100%)]">
      <aside className="hidden w-64 shrink-0 border-r border-white/70 bg-white/70 shadow-sm shadow-slate-200/60 backdrop-blur-xl lg:flex lg:flex-col">
        {sidebar}
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-30 bg-slate-950/30 backdrop-blur-sm lg:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside className={`fixed inset-y-0 left-0 z-40 w-64 bg-white shadow-2xl shadow-slate-950/20 transition-transform lg:hidden ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      }`}>
        {sidebar}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-white/70 bg-white/80 px-4 py-3 shadow-sm shadow-slate-200/50 backdrop-blur-xl lg:hidden">
          <button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100">
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-600 text-white">
            <FlaskConical size={17} />
          </div>
          <span className="text-sm font-semibold text-slate-950">炼化星球</span>
        </header>

        <main className="flex-1 overflow-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
