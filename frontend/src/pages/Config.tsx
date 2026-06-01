import { useEffect, useState } from 'react'
import { CheckCircle, CircleAlert, Eye, EyeOff, KeyRound, ListRestart, Loader2, Save, Server, ShieldCheck, Wifi } from 'lucide-react'
import { Spinner } from '../components/Spinner'
import { useToast } from '../components/Toast'
import { api } from '../api'
import { getErrorMessage } from '../errors'

type Provider = 'anthropic' | 'openai'
type OpenAIMode = 'responses' | 'chat'
type StatusType = 'success' | 'error' | 'warning' | 'info'

interface ModelFetchStatus {
  type: StatusType
  title: string
  detail: string
  endpoint?: string
}

interface LLMConfig {
  llm_provider: Provider
  anthropic_base_url: string
  anthropic_api_key: string
  anthropic_model: string
  openai_base_url: string
  openai_api_key: string
  openai_model: string
  openai_api_mode: OpenAIMode
  keep_topics_after_refine: boolean
  refine_batch_concurrency: number
  screen_batch_size: number
  screen_batch_concurrency: number
}

const emptyConfig: LLMConfig = {
  llm_provider: 'anthropic',
  anthropic_base_url: '',
  anthropic_api_key: '',
  anthropic_model: 'claude-sonnet-4-5',
  openai_base_url: '',
  openai_api_key: '',
  openai_model: 'gpt-4o',
  openai_api_mode: 'responses',
  keep_topics_after_refine: false,
  refine_batch_concurrency: 2,
  screen_batch_size: 20,
  screen_batch_concurrency: 2,
}

export default function Config() {
  const toast = useToast()
  const [config, setConfig] = useState<LLMConfig>(emptyConfig)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [loadingModels, setLoadingModels] = useState(false)
  const [testing, setTesting] = useState(false)
  const [models, setModels] = useState<string[]>([])
  const [error, setError] = useState('')
  const [modelStatus, setModelStatus] = useState<ModelFetchStatus | null>(null)
  const [testStatus, setTestStatus] = useState<ModelFetchStatus | null>(null)
  const [showKeys, setShowKeys] = useState(false)

  useEffect(() => {
    api<LLMConfig>('/api/config')
      .then(data => setConfig({
        ...emptyConfig,
        ...data,
        refine_batch_concurrency: normalizeRefineConcurrency(data.refine_batch_concurrency),
        screen_batch_size: normalizeScreenBatchSize(data.screen_batch_size),
        screen_batch_concurrency: normalizeScreenConcurrency(data.screen_batch_concurrency),
      }))
      .catch((err: unknown) => setError(getErrorMessage(err, '配置加载失败')))
      .finally(() => setLoading(false))
  }, [])

  function update<K extends keyof LLMConfig>(key: K, value: LLMConfig[K]) {
    setConfig(prev => ({ ...prev, [key]: value }))
    if (key === 'llm_provider') {
      setModels([])
      setModelStatus(null)
      setTestStatus(null)
    }
    if (key === 'openai_api_mode') {
      setTestStatus(null)
    }
  }

  async function handleSave() {
    setSaving(true)
    setError('')
    try {
      await api('/api/config', {
        method: 'POST',
        body: JSON.stringify(config),
      })
      toast.success('模型配置已保存')
    } catch (err: unknown) {
      const message = getErrorMessage(err, '配置保存失败')
      setError(message)
      toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  async function fetchModels() {
    const baseUrl = config.llm_provider === 'anthropic' ? config.anthropic_base_url : config.openai_base_url
    const apiKey = config.llm_provider === 'anthropic' ? config.anthropic_api_key : config.openai_api_key
    const endpoint = getEndpointPreview(baseUrl, config.llm_provider).models

    if (!baseUrl.trim() || !apiKey.trim() || apiKey.trim() === '***') {
      const title = '请先填写当前提供商的 Base URL 和 API Key'
      setModelStatus({ type: 'warning', title, detail: '模型列表现在由前端直接请求中转站接口，需要可用的真实 API Key。', endpoint })
      toast.warning(title)
      return
    }

    setLoadingModels(true)
    setModelStatus({ type: 'info', title: '正在请求模型列表', detail: '前端正在直接访问你配置的模型服务。', endpoint })
    try {
      const res = await fetch(endpoint, {
        method: 'GET',
        headers: modelListHeaders(config.llm_provider, apiKey),
      })

      const raw = await res.text()
      const data = parseJson(raw)

      if (!res.ok) {
        const diagnosis = diagnoseModelListError(res.status, raw)
        setModels([])
        setModelStatus({
          type: 'error',
          title: diagnosis.title,
          detail: diagnosis.detail,
          endpoint,
        })
        toast.error(diagnosis.title)
        return
      }

      const nextModels = extractModelIds(data)
      setModels(nextModels)
      if (nextModels.length) {
        setModelStatus({
          type: 'success',
          title: `已获取 ${nextModels.length} 个模型`,
          detail: '模型列表来自你配置的中转站 /v1/models 接口。',
          endpoint,
        })
        toast.success(`已获取 ${nextModels.length} 个模型`)
      } else {
        setModelStatus({
          type: 'warning',
          title: '接口返回了空模型列表',
          detail: '接口请求成功，但响应里没有解析到模型 ID。可以手动填写模型名后点击测试连接。',
          endpoint,
        })
        toast.warning('模型列表为空')
      }
    } catch (err: unknown) {
      const message = err instanceof TypeError ? '浏览器无法直接访问模型服务' : getErrorMessage(err, '模型列表获取失败')
      const detail = err instanceof TypeError
        ? '这通常是中转站没有开放 CORS，或网络/证书被浏览器拦截。可以先手动填写模型名，然后用测试连接验证后端调用。'
        : getErrorMessage(err, '未知错误')
      setModels([])
      setModelStatus({ type: 'error', title: message, detail, endpoint })
      toast.error(message)
    } finally {
      setLoadingModels(false)
    }
  }

  async function testConfig() {
    const endpoint = getEndpointPreview(
      config.llm_provider === 'anthropic' ? config.anthropic_base_url : config.openai_base_url,
      config.llm_provider,
      config.openai_api_mode,
    ).chat

    setTesting(true)
    setTestStatus({ type: 'info', title: '正在测试连接', detail: '后端正在用当前配置发起一次真实模型调用。', endpoint })
    try {
      const data = await api<{ message?: string }>('/api/config/test', {
        method: 'POST',
        body: JSON.stringify(config),
      })
      const message = data.message ? `模型连接正常：${data.message}` : '模型连接正常'
      setTestStatus({ type: 'success', title: '模型连接正常', detail: data.message || '模型服务已成功返回响应。', endpoint })
      toast.success(message)
    } catch (err: unknown) {
      setTestStatus({
        type: 'error',
        title: '模型测试失败',
        detail: getErrorMessage(err, '模型连接测试失败'),
        endpoint,
      })
      toast.error('模型测试失败')
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return <div className="flex justify-center pt-32"><Spinner /></div>
  }

  const activeBaseUrl = config.llm_provider === 'anthropic' ? config.anthropic_base_url : config.openai_base_url
  const activeModel = config.llm_provider === 'anthropic' ? config.anthropic_model : config.openai_model
  const activeKey = config.llm_provider === 'anthropic' ? config.anthropic_api_key : config.openai_api_key
  const ready = Boolean(activeBaseUrl && activeModel && activeKey)
  const endpointPreview = getEndpointPreview(activeBaseUrl, config.llm_provider, config.openai_api_mode)

  return (
    <div className="mx-auto w-full max-w-6xl">
      <section className="mb-5 border-b border-slate-200 pb-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-slate-950">模型配置</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-600">
              这里配置炼化、筛选和后续 Agent 调用使用的模型。NewAPI、sub2api、One API 这类中转站通常选择 OpenAI 兼容。
            </p>
          </div>
          <div className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
            ready ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-200 bg-amber-50 text-amber-800'
          }`}>
            {ready ? <CheckCircle size={16} /> : <CircleAlert size={16} />}
            {ready ? '当前提供商已配置' : '当前提供商配置未完整'}
          </div>
        </div>
      </section>

      {error && (
        <div className="mb-5 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          <CircleAlert size={16} />
          {error}
        </div>
      )}

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm shadow-slate-200/60">
        <div className="border-b border-slate-200 p-4 sm:p-5">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div className="min-w-0">
              <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                <button
                  onClick={() => update('llm_provider', 'openai')}
                  className={`flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors ${
                    config.llm_provider === 'openai' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <Server size={15} />
                  OpenAI 兼容
                </button>
                <button
                  onClick={() => update('llm_provider', 'anthropic')}
                  className={`flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors ${
                    config.llm_provider === 'anthropic' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                  }`}
                >
                  <ShieldCheck size={15} />
                  Anthropic
                </button>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {config.llm_provider === 'anthropic'
                  ? 'Messages 协议会请求 /v1/messages，模型列表请求 /v1/models。'
                  : `${config.openai_api_mode === 'responses' ? 'Responses 模式会请求 /v1/responses' : 'Chat Completions 模式会请求 /v1/chat/completions'}，模型列表请求 /v1/models。Base URL 填根域名或带 /v1 都可以。`}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 xl:justify-end">
              <button
                onClick={testConfig}
                disabled={testing}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 text-sm font-medium text-emerald-700 transition-colors hover:bg-emerald-100 disabled:opacity-60"
              >
                {testing ? <Loader2 size={15} className="animate-spin" /> : <Wifi size={15} />}
                测试连接
              </button>
              <button
                onClick={fetchModels}
                disabled={loadingModels}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-indigo-200 bg-indigo-50 px-3 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100 disabled:opacity-60"
              >
                {loadingModels ? <Loader2 size={15} className="animate-spin" /> : <ListRestart size={15} />}
                获取模型列表
              </button>
              <button
                onClick={() => setShowKeys(value => !value)}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
              >
                {showKeys ? <EyeOff size={15} /> : <Eye size={15} />}
                {showKeys ? '隐藏密钥' : '显示密钥'}
              </button>
            </div>
          </div>
        </div>

        <div className="p-4 sm:p-5">
          {config.llm_provider === 'anthropic' ? (
            <div className="grid gap-4">
              <Field label="Base URL" value={config.anthropic_base_url} onChange={value => update('anthropic_base_url', value)} placeholder="https://api.anthropic.com" />
              <Field label="API Key" value={config.anthropic_api_key} onChange={value => update('anthropic_api_key', value)} placeholder="sk-ant-..." type={showKeys ? 'text' : 'password'} icon />
              <ModelField
                label="Model"
                value={config.anthropic_model}
                onChange={value => update('anthropic_model', value)}
                placeholder="claude-sonnet-4-5"
                models={models}
              />
            </div>
          ) : (
            <div className="grid gap-4">
              <Field label="Base URL" value={config.openai_base_url} onChange={value => update('openai_base_url', value)} placeholder="https://api.openai.com" />
              <Field label="API Key" value={config.openai_api_key} onChange={value => update('openai_api_key', value)} placeholder="sk-..." type={showKeys ? 'text' : 'password'} icon />
              <div>
                <span className="mb-1.5 block text-xs font-medium text-slate-500">调用接口</span>
                <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-1">
                  <button
                    onClick={() => update('openai_api_mode', 'responses')}
                    className={`h-9 rounded-md px-3 text-sm font-medium transition-colors ${
                      config.openai_api_mode === 'responses' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Responses
                  </button>
                  <button
                    onClick={() => update('openai_api_mode', 'chat')}
                    className={`h-9 rounded-md px-3 text-sm font-medium transition-colors ${
                      config.openai_api_mode === 'chat' ? 'bg-white text-slate-950 shadow-sm' : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    Chat Completions
                  </button>
                </div>
                <p className="mt-1.5 text-xs leading-5 text-slate-500">cc-switch 当前 Codex 配置常用 Responses；如果你的中转站只兼容传统 OpenAI，就切到 Chat Completions。</p>
              </div>
              <ModelField
                label="Model"
                value={config.openai_model}
                onChange={value => update('openai_model', value)}
                placeholder="gpt-4o"
                models={models}
              />
            </div>
          )}

          <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
            <div className="flex flex-col gap-2 text-xs leading-6 sm:flex-row sm:items-center sm:justify-between">
              <div className="font-medium text-slate-900">接口预览</div>
              <div className="text-slate-500">获取模型列表会由前端直接请求模型服务；测试连接仍由后端验证真实调用。</div>
            </div>
            <div className="mt-2 grid gap-2 font-mono text-[12px] text-slate-600 lg:grid-cols-2">
              <code className="rounded-md border border-slate-200 bg-white px-2 py-1.5">GET {endpointPreview.models}</code>
              <code className="rounded-md border border-slate-200 bg-white px-2 py-1.5">POST {endpointPreview.chat}</code>
            </div>
          </div>

          {modelStatus && (
            <StatusPanel status={modelStatus} />
          )}

          {testStatus && (
            <StatusPanel status={testStatus} />
          )}

          <div className="mt-5 rounded-lg border border-slate-200 bg-stone-50 px-4 py-3">
            <div className="mb-4 flex flex-col gap-1 border-b border-slate-200 pb-3">
              <span className="text-sm font-medium text-slate-900">炼化运行参数</span>
              <span className="text-xs leading-5 text-slate-500">控制筛选和总结的批处理方式；中转站限速明显时调低并发。</span>
            </div>
            <div className="grid gap-4 lg:grid-cols-[1fr_180px_180px_180px] lg:items-start">
            <label className="flex items-start gap-3 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={config.keep_topics_after_refine}
                onChange={e => update('keep_topics_after_refine', e.target.checked)}
                className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
              />
              <span>
                <span className="font-medium text-slate-900">炼化后保留临时帖子和附件</span>
                <span className="mt-1 block text-xs leading-5 text-slate-500">适合调试和复盘；关闭时会按原逻辑清理临时文件。</span>
              </span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">分批摘要并发数</span>
              <input
                type="number"
                min={1}
                max={8}
                step={1}
                value={config.refine_batch_concurrency}
                onChange={e => update('refine_batch_concurrency', normalizeRefineConcurrency(e.target.value))}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500"
              />
              <span className="mt-1 block text-xs leading-5 text-slate-500">默认 2；批次很多时会自动限流。</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">筛选每批帖子数</span>
              <input
                type="number"
                min={5}
                max={50}
                step={5}
                value={config.screen_batch_size}
                onChange={e => update('screen_batch_size', normalizeScreenBatchSize(e.target.value))}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500"
              />
              <span className="mt-1 block text-xs leading-5 text-slate-500">默认 20；内容很长时可调小。</span>
            </label>
            <label className="block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">筛选并发数</span>
              <input
                type="number"
                min={1}
                max={8}
                step={1}
                value={config.screen_batch_concurrency}
                onChange={e => update('screen_batch_concurrency', normalizeScreenConcurrency(e.target.value))}
                className="h-10 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 focus:border-indigo-500"
              />
              <span className="mt-1 block text-xs leading-5 text-slate-500">默认 2；200 条约 10 批。</span>
            </label>
            </div>
          </div>

          <div className="mt-6 flex justify-end">
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-slate-950 px-4 text-sm font-medium text-white transition-colors hover:bg-slate-800 disabled:opacity-60"
            >
              {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
              保存配置
            </button>
          </div>
        </div>
      </section>
    </div>
  )
}

function modelListHeaders(provider: Provider, apiKey: string): Record<string, string> {
  if (provider === 'anthropic') {
    return {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    }
  }
  return {
    Authorization: `Bearer ${apiKey}`,
  }
}

function normalizeRefineConcurrency(value: unknown) {
  const next = Number.parseInt(String(value ?? 2), 10)
  if (!Number.isFinite(next)) return 2
  return Math.max(1, Math.min(8, next))
}

function normalizeScreenBatchSize(value: unknown) {
  const next = Number.parseInt(String(value ?? 20), 10)
  if (!Number.isFinite(next)) return 20
  return Math.max(5, Math.min(50, next))
}

function normalizeScreenConcurrency(value: unknown) {
  const next = Number.parseInt(String(value ?? 2), 10)
  if (!Number.isFinite(next)) return 2
  return Math.max(1, Math.min(8, next))
}

function parseJson(raw: string) {
  if (!raw) return null
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

function extractModelIds(data: unknown) {
  const record = data && typeof data === 'object' ? data as Record<string, unknown> : {}
  const rawModels = Array.isArray(record.data) ? record.data : Array.isArray(record.models) ? record.models : []
  return Array.from(new Set(rawModels.map(item => {
    if (typeof item === 'string') return item
    if (item && typeof item === 'object') {
      const model = item as Record<string, unknown>
      return String(model.id || model.name || model.model || model.model_name || '')
    }
    return ''
  }).filter(Boolean))).sort()
}

function diagnoseModelListError(status: number, raw: string) {
  const compact = raw.replace(/\s+/g, ' ').trim()
  if (status === 401) {
    return {
      title: 'API Key 无效或没有权限',
      detail: compact || '模型服务返回 401。请检查中转站 Key 是否填错、是否已启用、余额是否正常，或这个 Key 是否允许访问模型列表。',
    }
  }
  if (status === 403) {
    return {
      title: 'API Key 权限不足',
      detail: compact || '模型服务返回 403。这个 Key 可能没有模型列表权限，或被分组/额度策略限制。',
    }
  }
  if (status === 404) {
    return {
      title: '模型列表接口不存在',
      detail: compact || '模型服务返回 404。sub2api/newapi 的 OpenAI 兼容模型列表通常是 /v1/models，请确认 Base URL 是否填成了管理后台地址或多带了一段路径。',
    }
  }
  return {
    title: `模型服务返回 HTTP ${status}`,
    detail: compact || '模型服务返回了非成功状态。可以手动填写模型名后点击测试连接继续验证。',
  }
}

function StatusPanel({ status }: { status: ModelFetchStatus }) {
  const styles: Record<StatusType, string> = {
    success: 'border-emerald-200 bg-emerald-50 text-emerald-900',
    error: 'border-rose-200 bg-rose-50 text-rose-900',
    warning: 'border-amber-200 bg-amber-50 text-amber-900',
    info: 'border-sky-200 bg-sky-50 text-sky-900',
  }

  return (
    <div className={`mt-4 rounded-lg border px-4 py-3 text-sm leading-6 ${styles[status.type]}`}>
      <div className="font-medium">{status.title}</div>
      {status.endpoint && <div className="mt-1 break-all font-mono text-xs opacity-80">{status.endpoint}</div>}
      <div className="mt-1 break-words text-xs opacity-80">{status.detail}</div>
    </div>
  )
}

function normalizeBaseUrl(value: string) {
  const base = value.trim().replace(/\/+$/, '')
  if (!base) return '<Base URL>'
  return base.endsWith('/v1') ? base : `${base}/v1`
}

function getEndpointPreview(baseUrl: string, provider: Provider, openaiMode: OpenAIMode = 'responses') {
  const v1Base = normalizeBaseUrl(baseUrl)
  if (provider === 'anthropic') {
    return {
      models: `${v1Base}/models`,
      chat: `${v1Base}/messages`,
    }
  }
  return {
    models: `${v1Base}/models`,
    chat: openaiMode === 'responses' ? `${v1Base}/responses` : `${v1Base}/chat/completions`,
  }
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  icon = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  type?: 'text' | 'password'
  icon?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-500">{label}</span>
      <div className="relative">
        {icon && <KeyRound size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />}
        <input
          type={type}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500 ${icon ? 'pl-9' : ''}`}
        />
      </div>
    </label>
  )
}

function ModelField({
  label,
  value,
  onChange,
  placeholder,
  models,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  models: string[]
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-slate-500">{label}</span>
      <div className="grid gap-2 sm:grid-cols-[1fr_220px]">
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 focus:border-indigo-500"
        />
        <select
          value={models.includes(value) ? value : ''}
          onChange={e => {
            if (e.target.value) onChange(e.target.value)
          }}
          disabled={models.length === 0}
          className="h-11 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-700 disabled:bg-slate-50 disabled:text-slate-400"
        >
          <option value="">{models.length ? '从列表选择' : '先获取模型列表'}</option>
          {models.map(model => (
            <option key={model} value={model}>{model}</option>
          ))}
        </select>
      </div>
    </label>
  )
}
