import { useEffect, useRef, useState } from 'react'
import { Outlet, useNavigate, useLocation } from 'react-router-dom'
import { BookOpen, ChevronRight, LayoutGrid, LogOut, Menu, Orbit, Settings2, Sparkles, X } from 'lucide-react'
import { api } from './api'
import { BrandMark } from './components/BrandMark'
import { clearCurrentGroup, readCurrentGroup, type CurrentGroup } from './currentGroup'

interface UserProfile {
  name: string
  avatar_url: string
}

const navItems = [
  { href: '/groups', label: '我的星球', icon: LayoutGrid },
  { href: '/skills', label: '炼化记录', icon: BookOpen },
  { href: '/config', label: '模型配置', icon: Settings2 },
]

export default function Layout() {
  const navigate = useNavigate()
  const location = useLocation()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [currentGroup, setCurrentGroup] = useState<CurrentGroup | null>(() => readCurrentGroup())
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileAvatarFailed, setProfileAvatarFailed] = useState(false)
  const [accountMenuOpen, setAccountMenuOpen] = useState(false)
  const accountMenuTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const isActive = (href: string) => location.pathname.startsWith(href)

  useEffect(() => {
    setCurrentGroup(readCurrentGroup())

    function handleCurrentGroupChange(event: Event) {
      const customEvent = event as CustomEvent<CurrentGroup | undefined>
      setCurrentGroup(customEvent.detail || readCurrentGroup())
    }

    window.addEventListener('current-group-change', handleCurrentGroupChange)
    window.addEventListener('storage', handleCurrentGroupChange)
    return () => {
      window.removeEventListener('current-group-change', handleCurrentGroupChange)
      window.removeEventListener('storage', handleCurrentGroupChange)
    }
  }, [location.pathname])

  useEffect(() => {
    let cancelled = false
    api<{ profile: UserProfile }>('/api/me')
      .then(data => {
        if (!cancelled) setProfile(data.profile || null)
      })
      .catch(() => {
        if (!cancelled) setProfile(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    setProfileAvatarFailed(false)
  }, [profile?.avatar_url])

  useEffect(() => {
    return () => {
      if (accountMenuTimer.current) clearTimeout(accountMenuTimer.current)
    }
  }, [])

  function openAccountMenu() {
    if (accountMenuTimer.current) clearTimeout(accountMenuTimer.current)
    setAccountMenuOpen(true)
  }

  function closeAccountMenuSoon() {
    if (accountMenuTimer.current) clearTimeout(accountMenuTimer.current)
    accountMenuTimer.current = setTimeout(() => setAccountMenuOpen(false), 180)
  }

  async function handleLogout() {
    await api('/api/logout', { method: 'POST' })
    clearCurrentGroup()
    setProfile(null)
    setAccountMenuOpen(false)
    navigate('/login', { replace: true })
  }

  const inGroupContext = (location.pathname.startsWith('/groups/') || location.pathname.startsWith('/refine')) && Boolean(currentGroup)
  const profileInitial = profile?.name?.trim()?.[0] || '我'

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="px-5 pb-5 pt-6">
        <div className="flex items-center gap-3">
          <BrandMark className="h-11 w-11 shrink-0 drop-shadow-sm" />
          <div>
            <p className="text-base font-semibold text-slate-950">炼化星球</p>
            <p className="mt-0.5 text-xs text-slate-500">社区知识炼化 Agent</p>
          </div>
        </div>
      </div>

      <div className="mx-3 rounded-lg border border-indigo-100 bg-indigo-50/80 px-3 py-3">
        <div className="flex items-center gap-2 text-xs font-medium text-indigo-800">
          <Orbit size={14} />
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

      <div className="px-3 pb-4 text-xs leading-5 text-slate-400">
        登录账号可在右上角头像处管理。
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
        <header className="sticky top-0 z-20 flex min-h-16 items-center justify-between gap-3 border-b border-white/70 bg-white/85 px-4 py-3 shadow-sm shadow-slate-200/50 backdrop-blur-xl sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3">
            <button onClick={() => setMobileOpen(true)} className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden">
              {mobileOpen ? <X size={20} /> : <Menu size={20} />}
            </button>
            <BrandMark className="h-9 w-9 shrink-0 lg:hidden" />
            <div className="hidden min-w-0 items-center gap-2 text-sm text-slate-500 lg:flex">
              <Sparkles size={15} className="text-indigo-600" />
              <span>炼化工作台</span>
              {inGroupContext && currentGroup && (
                <>
                  <ChevronRight size={14} className="text-slate-300" />
                  <span className="truncate font-medium text-slate-800">{currentGroup.name}</span>
                </>
              )}
            </div>
            <span className="truncate text-sm font-semibold text-slate-950 lg:hidden">
              {inGroupContext && currentGroup ? currentGroup.name : '炼化星球'}
            </span>
          </div>

          <div
            className="relative flex min-w-0 items-center justify-end"
            onMouseEnter={openAccountMenu}
            onMouseLeave={closeAccountMenuSoon}
          >
            <button
              type="button"
              onClick={() => setAccountMenuOpen(open => !open)}
              onFocus={openAccountMenu}
              className="group flex h-11 min-w-0 items-center gap-2.5 rounded-full border border-slate-200/80 bg-white/90 py-1 pl-1.5 pr-3 shadow-sm shadow-slate-200/70 transition-colors hover:border-indigo-200 hover:bg-white sm:max-w-[280px]"
              title={profile?.name || '当前账号'}
              aria-haspopup="menu"
              aria-expanded={accountMenuOpen}
            >
              <div className="relative h-8 w-8 shrink-0">
                {profile?.avatar_url && !profileAvatarFailed ? (
                  <img
                    src={profile.avatar_url}
                    alt=""
                    className="h-8 w-8 rounded-full object-cover ring-2 ring-white"
                    onError={() => setProfileAvatarFailed(true)}
                  />
                ) : (
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-950 text-xs font-semibold text-white ring-2 ring-white">
                    {profileInitial}
                  </div>
                )}
                <span className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white bg-emerald-500" />
              </div>
              <div className="hidden min-w-0 text-left sm:block">
                <div className="flex items-center gap-1.5 text-[11px] font-medium leading-3 text-slate-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  已登录
                </div>
                <p className="mt-0.5 truncate text-sm font-semibold leading-4 text-slate-900">
                  {profile?.name || '知识星球用户'}
                </p>
              </div>
            </button>

            {accountMenuOpen && (
              <>
                <div className="absolute right-0 top-full h-2 w-48" />
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-2 w-48 overflow-hidden rounded-lg border border-slate-200 bg-white p-1.5 shadow-xl shadow-slate-900/10"
                >
                  <div className="border-b border-slate-100 px-2.5 py-2">
                    <p className="truncate text-sm font-semibold text-slate-900">{profile?.name || '知识星球用户'}</p>
                    <p className="mt-0.5 text-xs text-slate-400">知识星球账号</p>
                  </div>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={handleLogout}
                    className="mt-1 flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm font-medium text-rose-600 transition-colors hover:bg-rose-50"
                  >
                    <LogOut size={15} />
                    退出登录
                  </button>
                </div>
              </>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-auto px-4 py-5 sm:px-6 lg:px-8 lg:py-8">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
