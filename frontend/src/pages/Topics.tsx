import { useCallback, useEffect, useState } from 'react'
import { useParams, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  Archive,
  CircleAlert,
  Eye,
  FileDown,
  Image as ImageIcon,
  Loader2,
  MessageCircle,
  RefreshCw,
  Sparkles,
  ThumbsUp,
  Zap,
} from 'lucide-react'
import { Spinner } from '../components/Spinner'
import { ImagePreview } from '../components/ImagePreview'
import { useToast } from '../components/Toast'
import { api } from '../api'
import { getErrorMessage } from '../errors'
import { readCurrentGroup, writeCurrentGroup } from '../currentGroup'

interface TopicImage {
  image_id: string
  thumbnail: string
  large: string
}

interface TopicFile {
  file_id: string
  name: string
  size: number
}

interface Topic {
  topic_id: string
  type: string
  text: string
  create_time: string
  author_name: string
  author_avatar: string
  images: TopicImage[]
  files: TopicFile[]
  likes_count: number
  comments_count: number
  reading_count: number
}

interface TopicLocationState {
  groupName?: string
  groupAvatar?: string
  groupBackground?: string
  iterateSkillId?: number
}

interface TopicJudgement {
  kind: 'knowledge' | 'noise' | 'thin'
  label: string
  reason: string
  source?: 'rule' | 'llm'
}

interface LlmScreenResult {
  topic_id: string
  include: boolean
  label: '知识内容' | '疑似广告' | '无关内容' | '内容不足' | '待确认'
  reason: string
}

function formatSize(bytes: number): string {
  if (!bytes) return '0 B'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}

function decodeAttrValue(value: string) {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

function normalizeTopicText(text = '') {
  return text
    .replace(/<e\b[^>]*\btitle=["']([^"']+)["'][^>]*\/?>/gi, (_, title: string) => decodeAttrValue(title))
    .replace(/<e\b[^>]*\/?>/gi, '')
    .replace(/&nbsp;/g, ' ')
    .trim()
}

function mergeUniqueTopics(base: Topic[], incoming: Topic[]) {
  const seen = new Set<string>()
  const merged: Topic[] = []
  for (const topic of [...base, ...incoming]) {
    if (seen.has(topic.topic_id)) continue
    seen.add(topic.topic_id)
    merged.push(topic)
  }
  return merged
}

function judgeTopic(topic: Topic): TopicJudgement {
  const text = normalizeTopicText(topic.text)
  const lower = text.toLowerCase()
  const filesCount = (topic.files || []).length
  const imagesCount = (topic.images || []).length
  const urlCount = (text.match(/https?:\/\/|www\./gi) || []).length
  const adTerms = [
    '广告', '推广', '优惠', '福利', '返利', '抽奖', '秒杀', '购买', '下单', '价格',
    '加微信', '微信号', '私信', '联系我', '咨询', '报名', '招生', '接单', '代做',
    'vx', 'v信', 'qq', '群二维码',
  ]
  const knowledgeTerms = [
    '原理', '分析', '复现', '总结', '笔记', '教程', '步骤', '方案', '问题', '解决',
    '源码', '代码', '算法', '接口', '协议', '签名', '加密', '解密', '逆向', '调试',
    'hook', 'frida', 'ast', 'jsvmp', 'wasm', 'token', 'cookie', 'debug', 'trace',
    'python', 'javascript', 'typescript', 'android', '抓包', '报错', '环境', '实现',
  ]

  const adHits = adTerms.filter(term => lower.includes(term))
  const knowledgeHits = knowledgeTerms.filter(term => lower.includes(term.toLowerCase()))
  const hasCodeLikeText = /```|function\s+\w+|class\s+\w+|import\s+|const\s+\w+|def\s+\w+|[A-Za-z0-9_]+\([^)]*\)/.test(text)

  if (text.length < 24 && filesCount === 0) {
    return { kind: 'thin', label: '内容不足', reason: '正文较短且没有附件，默认不参与炼化' }
  }

  if (adHits.length > 0 && knowledgeHits.length === 0 && filesCount === 0) {
    return { kind: 'noise', label: '疑似广告', reason: `命中 ${adHits.slice(0, 2).join('、')}，默认不参与炼化` }
  }

  if (urlCount > 0 && text.length < 80 && filesCount === 0) {
    return { kind: 'noise', label: '疑似推广', reason: '短文本里包含链接，默认不参与炼化' }
  }

  if (knowledgeHits.length > 0 || hasCodeLikeText || filesCount > 0 || text.length >= 120) {
    const reason = knowledgeHits.length > 0
      ? `命中 ${knowledgeHits.slice(0, 2).join('、')}`
      : filesCount > 0
        ? '包含附件'
        : hasCodeLikeText
          ? '包含代码/调用痕迹'
          : '正文信息量较高'
    return { kind: 'knowledge', label: '知识内容', reason }
  }

  if (imagesCount > 0 && text.length < 60) {
    return { kind: 'thin', label: '待确认', reason: '图片为主、文本较少，建议人工确认' }
  }

  return { kind: 'thin', label: '待确认', reason: '未命中明显知识信号，建议人工确认' }
}

function ExpandableText({ text = '' }: { text?: string }) {
  const [expanded, setExpanded] = useState(false)
  const displayText = normalizeTopicText(text)
  const needsExpand = displayText.length > 300 || displayText.split('\n').length > 5

  if (!displayText.trim()) {
    return <p className="text-sm italic text-slate-400">这条帖子没有文本内容</p>
  }

  return (
    <div>
      <p className={`whitespace-pre-wrap text-sm leading-7 text-slate-700 ${!expanded && needsExpand ? 'line-clamp-4' : ''}`}>
        {displayText}
      </p>
      {needsExpand && (
        <button onClick={() => setExpanded(value => !value)} className="mt-1 text-xs font-medium text-indigo-700 hover:text-indigo-900">
          {expanded ? '收起' : '展开全文'}
        </button>
      )}
    </div>
  )
}

export default function Topics() {
  const { groupId } = useParams<{ groupId: string }>()
  const location = useLocation()
  const navigate = useNavigate()
  const toast = useToast()
  const state = (location.state as TopicLocationState | null) || {}
  const cachedGroup = readCurrentGroup()
  const isCachedGroup = Boolean(cachedGroup && cachedGroup.id === groupId)
  const groupName = state.groupName || (isCachedGroup && cachedGroup ? cachedGroup.name : '') || '星球'
  const iterateSkillId = state.iterateSkillId

  const [topics, setTopics] = useState<Topic[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [loadingMore, setLoadingMore] = useState(false)
  const [loadingAll, setLoadingAll] = useState(false)
  const [screening, setScreening] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [llmJudgements, setLlmJudgements] = useState<Record<string, LlmScreenResult>>({})
  const [skillTitle, setSkillTitle] = useState('')
  const [saveMode, setSaveMode] = useState<'temp' | 'permanent'>('temp')
  const [previewImg, setPreviewImg] = useState<string | null>(null)

  useEffect(() => {
    if (!groupId || groupName === '星球') return
    writeCurrentGroup({
      id: groupId,
      name: groupName,
      avatar: state.groupAvatar || (isCachedGroup && cachedGroup ? cachedGroup.avatar : ''),
      background: state.groupBackground || (isCachedGroup && cachedGroup ? cachedGroup.background : ''),
    })
  }, [
    cachedGroup?.avatar,
    cachedGroup?.background,
    cachedGroup?.id,
    groupId,
    groupName,
    isCachedGroup,
    state.groupAvatar,
    state.groupBackground,
  ])

  const loadTopics = useCallback(async (endTime = '') => {
    const data = await api<{ topics: Topic[]; has_more: boolean }>(
      `/api/groups/${groupId}/topics?count=20&end_time=${encodeURIComponent(endTime)}`
    )
    return {
      topics: data.topics || [],
      has_more: Boolean(data.has_more),
    }
  }, [groupId])

  const refreshTopics = useCallback(async () => {
    setLoading(true)
    setError('')
    setSelected(new Set())
    setLlmJudgements({})
    try {
      const data = await loadTopics()
      setTopics(data.topics)
      setHasMore(data.has_more)
    } catch (err: unknown) {
      setError(getErrorMessage(err, '帖子加载失败'))
    } finally {
      setLoading(false)
    }
  }, [loadTopics])

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshTopics()
  }, [refreshTopics])

  async function loadMore() {
    if (!topics.length || loadingMore) return
    setLoadingMore(true)
    try {
      const lastTime = topics[topics.length - 1].create_time
      const data = await loadTopics(lastTime)
      setTopics(prev => mergeUniqueTopics(prev, data.topics))
      setHasMore(data.has_more)
      if (!data.topics.length) {
        toast.warning('没有更多帖子了')
      }
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, '加载更多失败'))
    } finally {
      setLoadingMore(false)
    }
  }

  async function loadAll() {
    if (!topics.length || loadingAll) return
    setLoadingAll(true)
    try {
      let all = [...topics]
      let more = hasMore
      let cursorTime = all[all.length - 1]?.create_time || ''
      while (more && cursorTime) {
        const data = await loadTopics(cursorTime)
        if (!data.topics.length) {
          more = false
          break
        }
        cursorTime = data.topics[data.topics.length - 1].create_time
        all = mergeUniqueTopics(all, data.topics)
        more = data.has_more
      }
      setTopics(all)
      setHasMore(false)
      toast.success(`已加载 ${all.length} 条帖子`)
    } catch (err: unknown) {
      toast.error(getErrorMessage(err, '加载全部失败'))
    } finally {
      setLoadingAll(false)
    }
  }

  async function selectKnowledgeTopics() {
    if (!topics.length) return

    setScreening(true)
    try {
      const data = await api<{
        results: LlmScreenResult[]
        batch_count?: number
        batch_size?: number
        concurrency?: number
      }>('/api/topics/screen', {
        method: 'POST',
        body: JSON.stringify({
          group_name: groupName,
          topics: topics.map(topic => ({
            topic_id: topic.topic_id,
            text: normalizeTopicText(topic.text),
            author_name: topic.author_name,
            create_time: topic.create_time,
            image_count: (topic.images || []).length,
            file_names: (topic.files || []).map(file => file.name),
          })),
        }),
      })

      const nextJudgements = Object.fromEntries(data.results.map(result => [result.topic_id, result]))
      const knowledgeIds = data.results
        .filter(result => result.include)
        .map(result => result.topic_id)
      setLlmJudgements(nextJudgements)
      setSelected(new Set(knowledgeIds))
      const batchText = data.batch_count
        ? `，${data.batch_count} 批 / 并发 ${data.concurrency || 1}`
        : ''
      toast.success(`LLM 已筛选 ${knowledgeIds.length} 条知识帖${batchText}`)
    } catch (err: unknown) {
      const knowledgeIds = topics
        .filter(topic => judgeTopic(topic).kind === 'knowledge')
        .map(topic => topic.topic_id)
      setSelected(new Set(knowledgeIds))
      toast.error(`${getErrorMessage(err, 'LLM 筛选失败')}，已使用本地规则兜底`)
    } finally {
      setScreening(false)
    }

    if (hasMore) {
      toast.warning('当前还有未加载帖子，建议先一键加载全部后再筛选')
    }
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function selectAll() {
    if (!topics.length) return
    if (selected.size === topics.length) {
      setSelected(new Set())
    } else {
      setSelected(new Set(topics.map(t => t.topic_id)))
    }
  }

  function handleRefine() {
    if (selected.size === 0) {
      toast.warning('请先勾选要炼化的帖子')
      return
    }
    navigate('/refine', {
      state: {
        group_id: groupId,
        group_name: groupName,
        topic_ids: Array.from(selected),
        title: skillTitle,
        save_mode: saveMode,
        skill_id: iterateSkillId || null,
      },
    })
  }

  async function handleDownload(fileId: string) {
    try {
      const data = await api<{ download_url: string }>(`/api/files/${fileId}/download_url`)
      window.open(data.download_url, '_blank', 'noopener,noreferrer')
    } catch {
      toast.error('获取下载链接失败')
    }
  }

  if (loading) {
    return <div className="flex justify-center pt-32"><Spinner /></div>
  }

  const allSelected = selected.size === topics.length && topics.length > 0
  const someSelected = selected.size > 0 && selected.size < topics.length
  const getJudgement = (topic: Topic): TopicJudgement => {
    const llm = llmJudgements[topic.topic_id]
    if (!llm) return { ...judgeTopic(topic), source: 'rule' }
    if (llm.include) return { kind: 'knowledge', label: llm.label, reason: llm.reason, source: 'llm' }
    return {
      kind: llm.label === '疑似广告' || llm.label === '无关内容' ? 'noise' : 'thin',
      label: llm.label,
      reason: llm.reason,
      source: 'llm',
    }
  }
  const knowledgeCount = topics.filter(topic => getJudgement(topic).kind === 'knowledge').length
  const excludedCount = topics.length - knowledgeCount
  const hasLlmJudgement = Object.keys(llmJudgements).length > 0

  return (
    <div className="mx-auto max-w-5xl">
      <section className="mb-5 overflow-hidden rounded-2xl border border-white/80 bg-white/85 shadow-sm shadow-slate-200/70 backdrop-blur-xl">
        <div className="p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex min-w-0 gap-3">
              <button onClick={() => navigate('/groups')} className="mt-0.5 rounded-lg p-2 text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-950">
                <ArrowLeft size={18} />
              </button>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="truncate text-2xl font-semibold text-slate-950">{groupName}</h1>
                  {iterateSkillId && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-teal-50 px-2.5 py-1 text-xs font-medium text-teal-700">
                      <RefreshCw size={12} />
                      迭代模式
                    </span>
                  )}
                </div>
                <p className="mt-1 text-sm text-slate-500">勾选帖子后开始炼化，附件会在流程中自动下载和提取。</p>
              </div>
            </div>
            <div className="flex gap-2">
              <div className="rounded-lg border border-slate-200 bg-stone-50 px-3 py-2 text-center">
                <p className="text-xs text-slate-500">已加载</p>
                <p className="text-base font-semibold text-slate-950">{topics.length}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-stone-50 px-3 py-2 text-center">
                <p className="text-xs text-slate-500">已选</p>
                <p className="text-base font-semibold text-indigo-700">{selected.size}</p>
              </div>
              <div className="rounded-lg border border-slate-200 bg-stone-50 px-3 py-2 text-center">
                <p className="text-xs text-slate-500">知识候选</p>
                <p className="text-base font-semibold text-emerald-700">{knowledgeCount}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {error && (
        <div className="mb-5 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-2"><CircleAlert size={16} />{error}</span>
            <button onClick={refreshTopics} className="inline-flex items-center gap-2 rounded-lg bg-white px-3 py-1.5 font-medium text-rose-700 shadow-sm hover:bg-rose-100">
              <RefreshCw size={14} />
              重试
            </button>
          </div>
        </div>
      )}

      <div className="sticky top-4 z-10 mb-4 rounded-2xl border border-white/80 bg-white/90 p-4 shadow-lg shadow-slate-200/60 backdrop-blur-xl">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={allSelected}
              ref={el => { if (el) el.indeterminate = someSelected }}
              onChange={selectAll}
              disabled={!topics.length}
              className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            全选当前已加载帖子
          </label>
          <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
            {hasMore && (
              <button
                onClick={loadAll}
                disabled={loadingAll}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-slate-950 px-3 text-sm font-medium text-white shadow-lg shadow-slate-950/10 transition-colors hover:bg-slate-800 disabled:opacity-50"
              >
                {loadingAll && <Loader2 size={14} className="animate-spin" />}
                一键加载全部
              </button>
            )}
            <button
              onClick={selectKnowledgeTopics}
              disabled={!topics.length || screening}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-100 disabled:opacity-50"
            >
              {screening ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
              {screening ? 'LLM 筛选中' : 'LLM 筛选知识帖'}
            </button>
            <input
              type="text"
              placeholder={iterateSkillId ? '留空则沿用原 SKILL 标题' : 'SKILL 标题，可留空'}
              value={skillTitle}
              onChange={e => setSkillTitle(e.target.value)}
              className="h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-500 sm:w-64"
            />
            <div className="grid grid-cols-2 overflow-hidden rounded-lg border border-slate-200 bg-white">
              <button
                onClick={() => setSaveMode('temp')}
                className={`h-10 px-3 text-sm transition-colors ${saveMode === 'temp' ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                临时
              </button>
              <button
                onClick={() => setSaveMode('permanent')}
                className={`h-10 px-3 text-sm transition-colors ${saveMode === 'permanent' ? 'bg-slate-950 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
              >
                归档
              </button>
            </div>
            <button
              onClick={handleRefine}
              disabled={selected.size === 0}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-indigo-600 px-4 text-sm font-medium text-white shadow-lg shadow-indigo-600/20 transition-colors hover:bg-indigo-700 disabled:opacity-50"
            >
              <Zap size={15} />
              {iterateSkillId ? '迭代炼化' : '开始炼化'} ({selected.size})
            </button>
          </div>
        </div>
        <div className="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-xs leading-5 text-slate-500">
          {hasLlmJudgement
            ? '当前标签来自 LLM 筛选，会重点识别广告、推广、加联系方式、无关闲聊和真正可沉淀的知识内容。'
            : '未运行 LLM 筛选前，标签使用本地规则兜底；点击 LLM 筛选知识帖后会调用模型重新判断。'
          }
          当前已加载 {topics.length} 条，知识候选 {knowledgeCount} 条，默认排除/待确认 {excludedCount} 条；勾选框仍可手动调整。
        </div>
      </div>

      {topics.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-300 bg-white/70 py-16 text-center shadow-sm">
          <Archive size={34} className="mx-auto text-slate-300" />
          <p className="mt-4 text-base font-medium text-slate-800">当前没有可处理的帖子</p>
          <p className="mt-1 text-sm text-slate-500">换一个星球，或稍后刷新再试。</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {topics.map(topic => {
            const selectedTopic = selected.has(topic.topic_id)
            const judgement = getJudgement(topic)
            return (
              <article
                key={topic.topic_id}
                className={`rounded-2xl border bg-white p-4 shadow-sm shadow-slate-200/60 transition-all duration-200 ${
                  selectedTopic ? 'border-indigo-300 ring-2 ring-indigo-100' : 'border-white/80 hover:border-slate-200 hover:shadow-md'
                }`}
              >
                <div className="flex gap-3">
                  <input
                    type="checkbox"
                    checked={selectedTopic}
                    onChange={() => toggleSelect(topic.topic_id)}
                    className="mt-1 h-4 w-4 shrink-0 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                    aria-label="选择帖子"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      {topic.author_avatar ? (
                        <img src={topic.author_avatar} alt="" className="h-8 w-8 rounded-lg object-cover" />
                      ) : (
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-xs font-medium text-slate-500">
                          {topic.author_name?.[0] || '?'}
                        </div>
                      )}
                      <span className="text-sm font-semibold text-slate-800">{topic.author_name || '匿名成员'}</span>
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{topic.create_time?.slice(0, 10) || '未知时间'}</span>
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        judgement.kind === 'knowledge'
                          ? 'bg-emerald-50 text-emerald-700'
                          : judgement.kind === 'noise'
                            ? 'bg-rose-50 text-rose-700'
                            : 'bg-amber-50 text-amber-700'
                      }`}>
                        {judgement.source === 'llm' ? 'LLM ' : ''}{judgement.label}
                      </span>
                    </div>

                    <ExpandableText text={topic.text} />

                    {(topic.images || []).length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {topic.images.slice(0, 4).map(img => (
                          <button key={img.image_id} onClick={() => setPreviewImg(img.large)} className="overflow-hidden rounded-lg border border-slate-200">
                            <img src={img.thumbnail} className="h-20 w-20 object-cover transition-transform duration-200 hover:scale-105" alt="" />
                          </button>
                        ))}
                        {topic.images.length > 4 && (
                          <span className="flex h-20 w-20 items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 text-xs text-slate-400">
                            <ImageIcon size={13} /> +{topic.images.length - 4}
                          </span>
                        )}
                      </div>
                    )}

                    {(topic.files || []).length > 0 && (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {topic.files.map(f => (
                          <button
                            key={f.file_id}
                            onClick={() => handleDownload(f.file_id)}
                            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-stone-50 px-3 py-2 text-xs text-slate-700 transition-colors hover:border-indigo-200 hover:bg-indigo-50 hover:text-indigo-800"
                          >
                            <FileDown size={13} />
                            <span className="max-w-[220px] truncate">{f.name}</span>
                            <span className="text-slate-400">{formatSize(f.size)}</span>
                          </button>
                        ))}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-4 text-xs text-slate-400">
                      <span className="flex items-center gap-1"><Eye size={13} /> {topic.reading_count || 0}</span>
                      <span className="flex items-center gap-1"><ThumbsUp size={13} /> {topic.likes_count || 0}</span>
                      <span className="flex items-center gap-1"><MessageCircle size={13} /> {topic.comments_count || 0}</span>
                      <span className="flex items-center gap-1 text-indigo-600"><Sparkles size={13} /> {selectedTopic ? '已加入炼化队列' : '可选'}</span>
                      <span className="text-slate-400">{judgement.reason}</span>
                    </div>
                  </div>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {hasMore && topics.length > 0 && (
        <div className="my-6 flex flex-wrap justify-center gap-3">
          <button
            onClick={loadMore}
            disabled={loadingMore}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-5 py-2.5 text-sm font-medium text-slate-700 shadow-sm transition-colors hover:bg-slate-50 disabled:opacity-50"
          >
            {loadingMore && <Loader2 size={14} className="animate-spin" />}
            加载更多
          </button>
        </div>
      )}

      {previewImg && <ImagePreview src={previewImg} onClose={() => setPreviewImg(null)} />}
    </div>
  )
}
