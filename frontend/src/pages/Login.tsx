import { useCallback, useEffect, useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { CheckCircle, CircleAlert, FlaskConical, Loader2, RotateCw, ScanLine } from 'lucide-react'
import { Spinner } from '../components/Spinner'
import { api } from '../api'
import { getErrorMessage } from '../errors'

type LoginStatus = 'loading' | 'pending' | 'scanned' | 'success' | 'expired' | 'cancelled' | 'error'

export default function Login() {
  const navigate = useNavigate()
  const [qrUrl, setQrUrl] = useState('')
  const [status, setStatus] = useState<LoginStatus>('loading')
  const [message, setMessage] = useState('')
  const polling = useRef(false)

  const startPolling = useCallback(async (uid: string) => {
    if (polling.current) return
    polling.current = true
    while (polling.current) {
      try {
        const data = await api<{ status: string; error?: string }>(`/api/login/check/${uid}`)
        if (data.status === 'success') {
          polling.current = false
          setStatus('success')
          setTimeout(() => navigate('/groups', { replace: true }), 800)
          return
        }
        if (data.status === 'scanned' || data.status === 'exchanging') {
          setStatus('scanned')
        }
        if (data.status === 'expired' || data.status === 'cancelled' || data.status === 'error') {
          polling.current = false
          setStatus(data.status === 'cancelled' ? 'cancelled' : data.status === 'error' ? 'error' : 'expired')
          setMessage(data.error || (data.status === 'error' ? '登录确认失败，请重新扫码' : ''))
          return
        }
      } catch (err: unknown) {
        setMessage(getErrorMessage(err, '登录状态检查失败'))
      }
      await new Promise(r => setTimeout(r, 1500))
    }
  }, [navigate])

  const createQrCode = useCallback(async () => {
    polling.current = false
    setStatus('loading')
    setMessage('')
    setQrUrl('')
    try {
      const data = await api<{ qr_url: string; uuid: string }>('/api/login/qrcode', { method: 'POST' })
      setQrUrl(data.qr_url)
      setStatus('pending')
      startPolling(data.uuid)
    } catch (err: unknown) {
      setStatus('error')
      setMessage(getErrorMessage(err, '二维码生成失败'))
    }
  }, [startPolling])

  useEffect(() => {
    api<{ logged_in: boolean }>('/api/login/status')
      .then(data => {
        if (data.logged_in) {
          navigate('/groups', { replace: true })
        } else {
          createQrCode()
        }
      })
      .catch((err: unknown) => {
        setStatus('error')
        setMessage(getErrorMessage(err, '无法连接登录服务'))
      })
    return () => { polling.current = false }
  }, [createQrCode, navigate])

  const steps = ['扫码', '确认', '完成']
  const stepIndex = status === 'pending' ? 0 : status === 'scanned' ? 1 : status === 'success' ? 2 : 0
  const canRetry = status === 'expired' || status === 'cancelled' || status === 'error'

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_top_left,_rgba(79,70,229,0.18),_transparent_34%),linear-gradient(135deg,#fbfaf7_0%,#eef2ff_48%,#ecfeff_100%)] p-4">
      <div className="absolute left-8 top-8 hidden items-center gap-3 md:flex">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-lg shadow-indigo-600/20">
          <FlaskConical size={21} />
        </div>
        <div>
          <p className="text-sm font-semibold text-slate-950">炼化星球</p>
          <p className="text-xs text-slate-500">Knowledge Refinery Agent</p>
        </div>
      </div>

      <div className="grid w-full max-w-5xl overflow-hidden rounded-2xl border border-white/80 bg-white/80 shadow-2xl shadow-slate-900/10 backdrop-blur-xl lg:grid-cols-[1.05fr_0.95fr]">
        <section className="hidden border-r border-white/70 bg-slate-950 p-8 text-white lg:block">
          <div className="flex h-full flex-col justify-between">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/10 px-3 py-1 text-xs text-indigo-100">
                <ScanLine size={14} />
                微信扫码登录
              </div>
              <h1 className="mt-6 max-w-sm text-4xl font-semibold leading-tight tracking-normal">
                把星球内容沉淀成可复用的 SKILL
              </h1>
              <p className="mt-4 max-w-md text-sm leading-6 text-slate-300">
                登录后选择星球帖子，自动下载附件和文本素材，再交给 Agent 整理为结构化知识资产。
              </p>
            </div>
            <div className="grid grid-cols-3 gap-3">
              {['选帖', '炼化', '归档'].map(label => (
                <div key={label} className="rounded-lg border border-white/10 bg-white/10 p-3">
                  <p className="text-xs text-slate-400">Step</p>
                  <p className="mt-1 text-sm font-medium">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="p-6 sm:p-8">
          <div className="mx-auto max-w-sm">
            <div className="mb-7 text-center">
              <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-lg shadow-indigo-600/20 lg:hidden">
                <FlaskConical size={23} />
              </div>
              <h2 className="text-xl font-semibold text-slate-950">登录工作台</h2>
              <p className="mt-1 text-sm text-slate-500">使用微信扫描知识星球授权二维码</p>
            </div>

            <div className="mb-8 flex items-center justify-center gap-2">
              {steps.map((label, i) => (
                <div key={label} className="flex items-center gap-2">
                  <div className={`flex items-center gap-1.5 text-xs font-medium ${
                    i <= stepIndex ? 'text-indigo-700' : 'text-slate-300'
                  }`}>
                    <div className={`h-2 w-2 rounded-full ${i <= stepIndex ? 'bg-indigo-600' : 'bg-slate-200'}`} />
                    {label}
                  </div>
                  {i < steps.length - 1 && (
                    <div className={`h-px w-8 ${i < stepIndex ? 'bg-indigo-600' : 'bg-slate-200'}`} />
                  )}
                </div>
              ))}
            </div>

            <div className="flex min-h-[286px] items-center justify-center rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              {status === 'loading' && (
                <div className="text-center">
                  <Spinner />
                  <p className="mt-4 text-sm text-slate-500">正在生成二维码...</p>
                </div>
              )}

              {status === 'success' && (
                <div className="text-center">
                  <CheckCircle size={48} className="mx-auto mb-3 text-emerald-500" />
                  <p className="text-base font-medium text-slate-950">登录成功</p>
                  <p className="mt-1 text-sm text-slate-500">正在进入工作台...</p>
                </div>
              )}

              {(status === 'pending' || status === 'scanned') && qrUrl && (
                <div className="text-center">
                  <div className="inline-block rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
                    <img src={qrUrl} alt="微信扫码登录二维码" className="block h-[206px] w-[206px]" />
                  </div>
                  <p className="mt-4 flex items-center justify-center gap-2 text-sm">
                    {status === 'pending' && <span className="text-slate-500">请使用微信扫描二维码</span>}
                    {status === 'scanned' && (
                      <>
                        <Loader2 size={14} className="animate-spin text-emerald-600" />
                        <span className="text-emerald-700">已扫码，请在手机端确认</span>
                      </>
                    )}
                  </p>
                  {message && <p className="mt-2 text-xs text-amber-700">{message}</p>}
                </div>
              )}

              {canRetry && (
                <div className="text-center">
                  <CircleAlert size={46} className="mx-auto mb-3 text-amber-500" />
                  <p className="text-base font-semibold text-slate-950">
                    {status === 'expired' ? '二维码已过期' : status === 'cancelled' ? '已取消登录' : '登录遇到问题'}
                  </p>
                  <p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-slate-500">
                    {message || '请重新生成二维码后再试一次。'}
                  </p>
                  <button
                    onClick={createQrCode}
                    className="mt-5 inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2.5 text-sm font-medium text-white shadow-lg shadow-indigo-600/20 transition-colors hover:bg-indigo-700"
                  >
                    <RotateCw size={15} />
                    重新生成二维码
                  </button>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
