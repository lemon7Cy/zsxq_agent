import { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Copy, Download, FileText, RefreshCw } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import { api } from '../api'
import { getErrorMessage } from '../errors'

interface SkillData {
  id: number
  group_id: string
  group_name: string
  title: string
  version: number
  file_path: string
  created_at: string
  content: string
  topics: { topic_id: string; added_at_version: number }[]
}

export default function SkillDetail() {
  const { skillId } = useParams<{ skillId: string }>()
  const navigate = useNavigate()
  const toast = useToast()
  const [skill, setSkill] = useState<SkillData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    api<SkillData>(`/api/skills/${skillId}`)
      .then(setSkill)
      .catch((err: unknown) => setError(getErrorMessage(err, 'SKILL 加载失败')))
      .finally(() => setLoading(false))
  }, [skillId])

  if (loading) {
    return <div className="flex justify-center pt-32"><Spinner /></div>
  }

  if (!skill) {
    return (
      <div className="mx-auto max-w-xl rounded-2xl border border-dashed border-slate-300 bg-white/70 py-16 text-center shadow-sm">
        <FileText size={34} className="mx-auto text-slate-300" />
        <p className="mt-4 text-base font-medium text-slate-800">{error || 'SKILL 不存在'}</p>
        <button onClick={() => navigate('/skills')} className="mt-5 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-indigo-700">
          返回记录
        </button>
      </div>
    )
  }

  async function copyContent() {
    if (!skill) return
    try {
      await navigator.clipboard.writeText(skill.content)
      toast.success('已复制到剪贴板')
    } catch {
      toast.error('复制失败')
    }
  }

  async function exportPackage() {
    if (!skill) return
    try {
      const res = await fetch(`/api/skills/${skill.id}/download`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${skill.title || 'skill'}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('导出失败')
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <section className="mb-5 rounded-2xl border border-white/80 bg-white/85 p-5 shadow-sm shadow-slate-200/70 backdrop-blur-xl sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 gap-3">
            <button
              onClick={() => navigate('/skills')}
              className="mt-0.5 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950"
            >
              <ArrowLeft size={18} />
            </button>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold text-slate-950">{skill.title}</h1>
                <span className="rounded-full bg-indigo-50 px-2.5 py-1 text-xs font-medium text-indigo-700">v{skill.version}</span>
              </div>
              <p className="mt-2 text-sm text-slate-500">
                来源：{skill.group_name} / 帖子：{skill.topics.length} 条 / 生成：{skill.created_at?.slice(0, 16).replace('T', ' ') || '-'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              onClick={copyContent}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Copy size={15} />复制
            </button>
            <button
              onClick={exportPackage}
              className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              <Download size={15} />导出 ZIP
            </button>
            <button
              onClick={() => navigate(`/groups/${skill.group_id}/topics`, {
                state: { groupName: skill.group_name, iterateSkillId: skill.id }
              })}
              className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-3 py-2 text-sm font-medium text-white shadow-lg shadow-indigo-600/20 transition-colors hover:bg-indigo-700"
            >
              <RefreshCw size={15} />迭代优化
            </button>
          </div>
        </div>
      </section>

      <article className="rounded-2xl border border-white/80 bg-white p-5 shadow-sm shadow-slate-200/70 sm:p-7">
        <div className="markdown-body text-sm leading-relaxed">
          <ReactMarkdown>{skill.content || '文件内容为空。'}</ReactMarkdown>
        </div>
      </article>
    </div>
  )
}
