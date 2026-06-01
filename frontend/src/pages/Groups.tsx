import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, CircleAlert, Crown, LayoutGrid, RefreshCw, Users, WandSparkles } from 'lucide-react'
import { Spinner } from '../components/Spinner'
import { api } from '../api'
import { getErrorMessage } from '../errors'

interface Group {
  group_id: string
  name: string
  type: string
  avatar_url?: string
  owner_name: string
  owner_avatar: string
  background_url: string
  members_count: number
}

function GroupAvatar({ group }: { group: Group }) {
  const [failed, setFailed] = useState(false)
  const fallback = (group.name || '星')[0]
  const avatar = group.avatar_url || group.owner_avatar

  if (!avatar || failed) {
    return (
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-indigo-100 bg-indigo-100 text-base font-semibold text-indigo-700 shadow-sm">
        {fallback}
      </div>
    )
  }

  return (
    <img
      src={avatar}
      alt=""
      className="h-12 w-12 shrink-0 rounded-lg border border-slate-200 object-cover shadow-sm"
      onError={() => setFailed(true)}
    />
  )
}

function formatCount(value: number) {
  if (!value) return '0'
  if (value >= 10000) return `${(value / 10000).toFixed(1)} 万`
  return value.toLocaleString()
}

export default function Groups() {
  const navigate = useNavigate()
  const [groups, setGroups] = useState<Group[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadGroups() {
    setLoading(true)
    setError('')
    try {
      const data = await api<{ groups: Group[] }>('/api/groups')
      setGroups(data.groups || [])
    } catch (err: unknown) {
      if (getErrorMessage(err, '') !== '未登录') {
        setError(getErrorMessage(err, '星球列表加载失败'))
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadGroups()
  }, [])

  if (loading) {
    return <div className="flex justify-center pt-32"><Spinner /></div>
  }

  return (
    <div className="mx-auto w-full max-w-[1600px]">
      <section className="mb-5 overflow-hidden rounded-2xl border border-white/80 bg-white/85 shadow-sm shadow-slate-200/70 backdrop-blur-xl">
        <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-center lg:justify-between lg:p-6">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700">
              <WandSparkles size={14} />
              内容炼化工作台
            </div>
            <h1 className="mt-3 text-2xl font-semibold text-slate-950">我的星球</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-500">
              选择一个星球，浏览帖子与附件，勾选后交给 Agent 生成结构化 SKILL。
            </p>
          </div>
          <div className="grid shrink-0 grid-cols-2 gap-3 lg:w-[380px]">
            <div className="rounded-lg border border-slate-200 bg-stone-50/80 px-4 py-3">
              <p className="text-xs text-slate-500">已连接星球</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">{groups.length}</p>
            </div>
            <div className="rounded-lg border border-slate-200 bg-stone-50/80 px-4 py-3">
              <p className="text-xs text-slate-500">总成员数</p>
              <p className="mt-1 text-2xl font-semibold text-slate-950">
                {formatCount(groups.reduce((sum, group) => sum + (group.members_count || 0), 0))}
              </p>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span className="flex items-center gap-2"><CircleAlert size={16} />{error}</span>
          <button onClick={loadGroups} className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 font-medium text-rose-700 shadow-sm hover:bg-rose-100">
            <RefreshCw size={14} />
            重试
          </button>
        </div>
      )}

      {groups.length === 0 && !error ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 py-16 text-center shadow-sm">
          <LayoutGrid size={34} className="mx-auto text-slate-300" />
          <p className="mt-4 text-base font-medium text-slate-800">还没有可浏览的星球</p>
          <p className="mt-1 text-sm text-slate-500">确认账号已加入知识星球后再刷新列表。</p>
          <button
            onClick={loadGroups}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-indigo-600/20 transition-colors hover:bg-indigo-700"
          >
            <RefreshCw size={15} />
            刷新列表
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-3">
          {groups.map(group => (
            <button
              key={group.group_id}
              onClick={() => navigate(`/groups/${group.group_id}/topics`, {
                state: {
                  groupName: group.name,
                  groupAvatar: group.avatar_url || group.owner_avatar,
                  groupBackground: group.background_url,
                },
              })}
              className="group overflow-hidden rounded-xl border border-white/80 bg-white text-left shadow-sm shadow-slate-200/70 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-xl hover:shadow-slate-200"
            >
              <div className="relative h-28 overflow-hidden bg-gradient-to-br from-slate-900 via-indigo-900 to-teal-700">
                {group.background_url && (
                  <img
                    src={group.background_url}
                    alt=""
                    className="h-full w-full object-cover opacity-70 transition-transform duration-300 group-hover:scale-[1.03]"
                    onError={e => {
                      e.currentTarget.style.display = 'none'
                    }}
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-slate-950/70 to-transparent" />
                <span className={`absolute right-4 top-4 rounded-full px-2.5 py-1 text-xs font-medium ${
                  group.type === 'pay' ? 'bg-amber-100 text-amber-800' : 'bg-emerald-100 text-emerald-800'
                }`}>
                  {group.type === 'pay' ? '付费星球' : '免费星球'}
                </span>
              </div>

              <div className="p-4">
                <div className="mb-3 flex items-center gap-3">
                  <GroupAvatar group={group} />
                  <div className="min-w-0">
                    <p className="line-clamp-1 text-base font-semibold text-slate-950">{group.name || '未命名星球'}</p>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-slate-500">
                      <Crown size={13} />
                      {group.owner_name || '未知星主'}
                    </p>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-3">
                  <span className="flex items-center gap-1.5 text-xs text-slate-500">
                    <Users size={14} />
                    {formatCount(group.members_count || 0)} 成员
                  </span>
                  <span className="flex items-center gap-1 text-xs font-medium text-indigo-700">
                    查看帖子
                    <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
