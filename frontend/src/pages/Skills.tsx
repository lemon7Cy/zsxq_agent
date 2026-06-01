import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowRight, BookOpen, CircleAlert, FileText, RefreshCw, Trash2 } from 'lucide-react'
import { Spinner } from '../components/Spinner'
import { ConfirmButton } from '../components/ConfirmButton'
import { useToast } from '../components/Toast'
import { api } from '../api'
import { getErrorMessage } from '../errors'

interface Skill {
  id: number
  group_id: string
  group_name: string
  title: string
  version: number
  created_at: string
  topic_count: number
}

export default function Skills() {
  const navigate = useNavigate()
  const toast = useToast()
  const [skills, setSkills] = useState<Skill[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  async function loadSkills() {
    setLoading(true)
    setError('')
    try {
      const data = await api<{ skills: Skill[] }>('/api/skills')
      setSkills(data.skills || [])
    } catch (err: unknown) {
      setError(getErrorMessage(err, '炼化记录加载失败'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSkills()
  }, [])

  async function handleDelete(id: number) {
    try {
      await api(`/api/skills/${id}`, { method: 'DELETE' })
      setSkills(prev => prev.filter(s => s.id !== id))
      toast.success('已删除')
    } catch {
      toast.error('删除失败')
    }
  }

  if (loading) {
    return <div className="flex justify-center pt-32"><Spinner /></div>
  }

  return (
    <div className="mx-auto max-w-7xl">
      <section className="mb-6 rounded-2xl border border-white/80 bg-white/85 p-6 shadow-sm shadow-slate-200/70 backdrop-blur-xl">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-teal-50 px-3 py-1 text-xs font-medium text-teal-700">
              <BookOpen size={14} />
              SKILL Library
            </div>
            <h1 className="mt-4 text-2xl font-semibold text-slate-950">炼化记录</h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">查看、导出和迭代已有 SKILL 文件。</p>
          </div>
          <div className="rounded-lg border border-slate-200 bg-stone-50 px-4 py-3">
            <p className="text-xs text-slate-500">已生成</p>
            <p className="mt-1 text-2xl font-semibold text-slate-950">{skills.length}</p>
          </div>
        </div>
      </section>

      {error && (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <span className="flex items-center gap-2"><CircleAlert size={16} />{error}</span>
          <button onClick={loadSkills} className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 font-medium text-rose-700 shadow-sm hover:bg-rose-100">
            <RefreshCw size={14} />
            重试
          </button>
        </div>
      )}

      {skills.length === 0 && !error ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 py-16 text-center shadow-sm">
          <FileText size={34} className="mx-auto text-slate-300" />
          <p className="mt-4 text-base font-medium text-slate-800">还没有炼化过任何 SKILL</p>
          <p className="mt-1 text-sm text-slate-500">从星球帖子开始，生成后的文件会出现在这里。</p>
          <button
            onClick={() => navigate('/groups')}
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-indigo-600/20 transition-colors hover:bg-indigo-700"
          >
            去星球选帖子
            <ArrowRight size={15} />
          </button>
        </div>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-white/80 bg-white shadow-sm shadow-slate-200/70">
          <div className="hidden grid-cols-[1fr_180px_90px_90px_130px_52px] gap-3 border-b border-slate-100 bg-stone-50 px-5 py-3 text-xs font-semibold uppercase text-slate-500 lg:grid">
            <span>标题</span>
            <span>来源星球</span>
            <span>版本</span>
            <span>帖子数</span>
            <span>创建时间</span>
            <span />
          </div>

          <div className="divide-y divide-slate-100">
            {skills.map(skill => (
              <div
                key={skill.id}
                onClick={() => navigate(`/skills/${skill.id}`)}
                className="grid cursor-pointer gap-3 px-5 py-4 transition-colors hover:bg-indigo-50/40 lg:grid-cols-[1fr_180px_90px_90px_130px_52px] lg:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-slate-950">{skill.title}</p>
                  <p className="mt-1 text-xs text-slate-400 lg:hidden">{skill.group_name} / v{skill.version}</p>
                </div>
                <div>
                  <span className="inline-flex max-w-full rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">
                    <span className="truncate">{skill.group_name}</span>
                  </span>
                </div>
                <span className="hidden text-sm text-indigo-700 lg:block">v{skill.version}</span>
                <span className="hidden text-sm text-slate-600 lg:block">{skill.topic_count}</span>
                <span className="hidden text-sm text-slate-500 lg:block">{skill.created_at?.slice(0, 10) || '-'}</span>
                <div className="flex justify-end">
                  <ConfirmButton
                    onConfirm={() => handleDelete(skill.id)}
                    className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600"
                  >
                    <Trash2 size={16} />
                  </ConfirmButton>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
