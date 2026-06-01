import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  CheckCircle,
  ChevronDown,
  CircleAlert,
  ClipboardCheck,
  Copy,
  Download,
  FileText,
  Layers3,
  Loader2,
  MessagesSquare,
  PanelTopOpen,
  Sparkles,
  WandSparkles,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { useToast } from '../components/Toast'
import { getErrorMessage } from '../errors'

interface RefineState {
  group_id: string
  group_name: string
  topic_ids: string[]
  title: string
  save_mode: string
  skill_id?: number | null
}

type ProcessEventType = 'log' | 'step' | 'batch_summary' | 'error'

interface ProcessEvent {
  id: number
  type: ProcessEventType
  message: string
  summary?: string
  batchIndex?: number
  totalBatches?: number
}

function responseMessage(data: unknown) {
  if (!data || typeof data !== 'object') return ''
  const record = data as Record<string, unknown>
  if (typeof record.detail === 'string') return record.detail
  if (typeof record.message === 'string') return record.message
  return ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object')
}

function eventTitle(event: ProcessEvent) {
  if (event.type === 'batch_summary') {
    return `批次 ${event.batchIndex || '-'} 摘要`
  }
  if (event.type === 'step') return event.message
  if (event.type === 'error') return '处理失败'
  return '工作日志'
}

function eventTone(event: ProcessEvent) {
  if (event.type === 'error') return 'border-rose-200 bg-rose-50 text-rose-900'
  if (event.type === 'batch_summary') return 'border-blue-200 bg-blue-50 text-blue-950'
  if (event.type === 'step') return 'border-slate-300 bg-white text-slate-950'
  return 'border-slate-200 bg-white/80 text-slate-700'
}

function eventIcon(event: ProcessEvent) {
  if (event.type === 'error') return CircleAlert
  if (event.type === 'batch_summary') return Layers3
  if (event.type === 'step') return Sparkles
  return MessagesSquare
}

export default function Refine() {
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const params = location.state as RefineState | null

  const [processEvents, setProcessEvents] = useState<ProcessEvent[]>([])
  const [expanded, setExpanded] = useState<Record<number, boolean>>({})
  const [finalContent, setFinalContent] = useState('')
  const [status, setStatus] = useState<'running' | 'done' | 'error'>('running')
  const [skillId, setSkillId] = useState<number | null>(null)
  const [skillTitle, setSkillTitle] = useState('')
  const endRef = useRef<HTMLDivElement>(null)
  const eventIdRef = useRef(0)

  function pushEvent(event: Omit<ProcessEvent, 'id'>) {
    const id = eventIdRef.current++
    const nextEvent = { id, ...event }
    setProcessEvents(prev => [...prev, nextEvent])
    if (event.type === 'step' || event.type === 'error') {
      setExpanded(prev => ({ ...prev, [id]: true }))
    }
  }

  useEffect(() => {
    if (!params) {
      navigate('/groups', { replace: true })
      return
    }

    const abortController = new AbortController()

    async function startRefine() {
      try {
        const resp = await fetch('/api/refine/stream', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            group_id: params!.group_id,
            group_name: params!.group_name,
            topic_ids: params!.topic_ids,
            title: params!.title,
            save_mode: params!.save_mode,
            skill_id: params!.skill_id || null,
          }),
          signal: abortController.signal,
        })

        if (!resp.ok) {
          let message = `请求失败: HTTP ${resp.status}`
          try {
            const data = await resp.json() as unknown
            message = responseMessage(data) || message
          } catch {
            // keep HTTP message
          }
          throw new Error(message)
        }

        const reader = resp.body?.getReader()
        if (!reader) {
          throw new Error('浏览器没有收到流式响应')
        }

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const rawLine of lines) {
            const line = rawLine.trimEnd()
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6)) as unknown
              if (!isRecord(event) || typeof event.type !== 'string') continue

              if (event.type === 'log' || event.type === 'step') {
                pushEvent({
                  type: event.type,
                  message: typeof event.message === 'string' ? event.message : '收到一条处理事件',
                  batchIndex: typeof event.batch_index === 'number' ? event.batch_index : undefined,
                  totalBatches: typeof event.total_batches === 'number' ? event.total_batches : undefined,
                })
              } else if (event.type === 'batch_summary') {
                pushEvent({
                  type: 'batch_summary',
                  message: typeof event.message === 'string' ? event.message : '批次摘要完成',
                  summary: typeof event.summary === 'string' ? event.summary : '',
                  batchIndex: typeof event.batch_index === 'number' ? event.batch_index : undefined,
                  totalBatches: typeof event.total_batches === 'number' ? event.total_batches : undefined,
                })
              } else if (event.type === 'final') {
                setFinalContent(typeof event.content === 'string' ? event.content : '')
                if (typeof event.title === 'string') setSkillTitle(event.title)
              } else if (event.type === 'done') {
                setStatus('done')
                setSkillId(typeof event.skill_id === 'number' ? event.skill_id : null)
                if (typeof event.title === 'string') setSkillTitle(event.title)
              } else if (event.type === 'error') {
                pushEvent({
                  type: 'error',
                  message: typeof event.message === 'string' ? event.message : '炼化失败',
                })
                setStatus('error')
              }
            } catch {
              pushEvent({ type: 'error', message: '收到了一条无法解析的 Agent 事件' })
            }
          }
        }
      } catch (e: unknown) {
        if (!(e instanceof DOMException && e.name === 'AbortError')) {
          pushEvent({ type: 'error', message: `连接失败: ${getErrorMessage(e, '未知错误')}` })
          setStatus('error')
        }
      }
    }

    startRefine()
    return () => abortController.abort()
  }, [navigate, params])

  const batchCount = useMemo(
    () => processEvents.filter(event => event.type === 'batch_summary').length,
    [processEvents],
  )

  if (!params) return null
  const refineParams = params

  async function copyFinal() {
    if (!finalContent) return
    try {
      await navigator.clipboard.writeText(finalContent)
      toast.success('已复制 Markdown')
    } catch {
      toast.error('复制失败')
    }
  }

  async function downloadFinal() {
    if (!skillId) return
    try {
      const res = await fetch(`/api/skills/${skillId}/download`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `${skillTitle || refineParams.title || 'skill'}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('下载失败')
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-64px)] max-w-7xl flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50 shadow-xl shadow-slate-200/70">
      <header className="shrink-0 border-b border-slate-200 bg-white px-5 py-4 sm:px-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-950 text-white shadow-sm">
              <WandSparkles size={20} />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-lg font-semibold text-slate-950">
                  {params.skill_id ? '迭代炼化' : '炼化'} · {params.group_name}
                </h1>
                <span className="rounded-md bg-slate-100 px-2 py-1 text-xs font-medium text-slate-600">
                  {params.topic_ids.length} 条帖子
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-500">流式展示处理过程，最终 SKILL.md 完成后一次性生成</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {status === 'running' && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-blue-50 px-3 py-2 text-xs font-medium text-blue-700">
                <Loader2 size={14} className="animate-spin" />Agent 工作中
              </span>
            )}
            {status === 'done' && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
                <CheckCircle size={14} />完成
              </span>
            )}
            {status === 'error' && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-3 py-2 text-xs font-medium text-rose-700">
                <CircleAlert size={14} />失败
              </span>
            )}
            {finalContent && (
              <>
                <button
                  onClick={copyFinal}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <Copy size={14} />复制
                </button>
                <button
                  onClick={downloadFinal}
                  disabled={!skillId}
                  className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <Download size={14} />下载 ZIP
                </button>
              </>
            )}
            {status === 'done' && skillId && (
              <button
                onClick={() => navigate(`/skills/${skillId}`)}
                className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-xs font-medium text-white shadow-sm transition-colors hover:bg-slate-800"
              >
                <FileText size={14} />查看 SKILL
              </button>
            )}
          </div>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(420px,1.1fr)]">
        <section className="flex min-h-0 flex-col border-b border-slate-200 bg-white lg:border-b-0 lg:border-r">
          <div className="shrink-0 border-b border-slate-200 px-5 py-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-950">Agent 工作日志</p>
                <p className="mt-1 text-xs text-slate-500">这里展示可公开的处理过程和批次摘要</p>
              </div>
              <div className="flex items-center gap-2 text-xs text-slate-500">
                <span className="rounded-md bg-slate-100 px-2 py-1">{processEvents.length} 条事件</span>
                <span className="rounded-md bg-blue-50 px-2 py-1 text-blue-700">{batchCount} 批摘要</span>
              </div>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto px-4 py-4 sm:px-5">
            {processEvents.length === 0 && (
              <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-center">
                <div>
                  <Loader2 size={28} className="mx-auto animate-spin text-blue-600" />
                  <p className="mt-4 text-sm font-medium text-slate-800">正在连接炼化 Agent</p>
                  <p className="mt-1 text-xs text-slate-500">读取帖子和附件后会开始返回工作日志</p>
                </div>
              </div>
            )}

            <div className="space-y-3">
              {processEvents.map(event => {
                const Icon = eventIcon(event)
                const isOpen = expanded[event.id] ?? false
                const body = event.type === 'batch_summary' ? event.summary : event.message
                const canToggle = event.type !== 'log' || event.message.length > 120
                return (
                  <article key={event.id} className={`rounded-lg border shadow-sm ${eventTone(event)}`}>
                    <button
                      type="button"
                      onClick={() => canToggle && setExpanded(prev => ({ ...prev, [event.id]: !isOpen }))}
                      className="flex w-full items-start gap-3 px-3 py-3 text-left"
                    >
                      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white/80 text-current shadow-sm">
                        <Icon size={15} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold">{eventTitle(event)}</span>
                        {event.type === 'log' && (
                          <span className="mt-1 block truncate text-xs font-normal opacity-80">{event.message}</span>
                        )}
                        {event.type === 'batch_summary' && (
                          <span className="mt-1 block text-xs font-normal opacity-80">
                            {event.batchIndex}/{event.totalBatches} · 已压缩成本批可复用线索
                          </span>
                        )}
                      </span>
                      {canToggle && (
                        <ChevronDown
                          size={16}
                          className={`mt-1 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`}
                        />
                      )}
                    </button>

                    {(isOpen || !canToggle) && body && (
                      <div className="border-t border-current/10 px-4 py-3">
                        {event.type === 'batch_summary' ? (
                          <div className="markdown-body text-sm leading-relaxed">
                            <ReactMarkdown>{body}</ReactMarkdown>
                          </div>
                        ) : (
                          <p className="whitespace-pre-wrap break-words text-sm leading-6">{body}</p>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}
              {status === 'running' && processEvents.length > 0 && (
                <div className="flex items-center gap-2 px-1 py-2 text-sm text-blue-700">
                  <span className="animate-pulse-dot">●</span>
                  <span>持续处理中，最终文档会在综合完成后出现</span>
                </div>
              )}
              <div ref={endRef} />
            </div>
          </div>
        </section>

        <section className="min-h-0 overflow-auto bg-slate-50 p-4 sm:p-5">
          {finalContent ? (
            <article className="rounded-lg border border-slate-200 bg-white shadow-sm">
              <div className="flex flex-col gap-3 border-b border-slate-200 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-emerald-50 text-emerald-700">
                    <ClipboardCheck size={18} />
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-950">{skillTitle || '最终 SKILL.md'}</p>
                    <p className="mt-1 text-xs text-slate-500">最终产物已生成并写入本地 SKILL 记录</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={copyFinal}
                    className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <Copy size={14} />复制
                  </button>
                  <button
                    onClick={downloadFinal}
                    disabled={!skillId}
                    className="inline-flex items-center gap-2 rounded-md bg-slate-950 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-slate-800"
                  >
                    <Download size={14} />下载 ZIP
                  </button>
                </div>
              </div>
              <div className="markdown-body px-5 py-5 text-sm leading-relaxed sm:px-6">
                <ReactMarkdown>{finalContent}</ReactMarkdown>
              </div>
            </article>
          ) : (
            <div className="flex h-full min-h-[420px] items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-center">
              <div className="max-w-xs px-6">
                {status === 'error' ? (
                  <CircleAlert size={30} className="mx-auto text-rose-500" />
                ) : (
                  <PanelTopOpen size={30} className="mx-auto text-slate-400" />
                )}
                <p className="mt-4 text-sm font-semibold text-slate-900">
                  {status === 'error' ? '最终文档尚未生成' : '等待最终 SKILL.md'}
                </p>
                <p className="mt-2 text-xs leading-5 text-slate-500">
                  {status === 'error'
                    ? '左侧日志保留了失败前的处理过程，可以根据错误继续排查。'
                    : '当前只流式展示处理过程。批次摘要完成并综合后，这里会一次性显示最终 Markdown。'}
                </p>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
