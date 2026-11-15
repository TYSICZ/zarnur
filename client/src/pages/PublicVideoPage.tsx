import { useEffect, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, Clapperboard, Download, LoaderCircle, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { apiFetch, clearToken, getToken, UNAUTHORIZED_EVENT } from '@/lib/api'
import VideoMontageEditor from '@/components/VideoMontageEditor'

interface VideoModel {
  id: number
  modelId: string
  displayName: string
  provider: string
  quotaLabel: string | null
}

interface AccountStatus {
  authenticated: boolean
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

function responseError(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const error = (payload as { error?: unknown }).error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message
  }
  return ''
}

export default function PublicVideoPage() {
  const [mode, setMode] = useState<'generate' | 'edit'>('generate')
  const [authenticated, setAuthenticated] = useState<boolean | null>(null)
  const [models, setModels] = useState<VideoModel[]>([])
  const [modelId, setModelId] = useState<number | null>(null)
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const generationController = useRef<AbortController | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    async function load() {
      try {
        const status = await apiFetch<AccountStatus>('/api/auth/status', { signal: controller.signal })
        setAuthenticated(status.authenticated)
        if (!status.authenticated) return
        const result = await apiFetch<{ models: VideoModel[] }>('/api/member/video/models', { signal: controller.signal })
        setModels(result.models)
        setModelId(result.models[0]?.id ?? null)
      } catch (reason) {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    }
    void load()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!videoUrl) return
    return () => URL.revokeObjectURL(videoUrl)
  }, [videoUrl])

  useEffect(() => () => generationController.current?.abort(), [])

  async function generate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!modelId || !prompt.trim() || generating) return
    setGenerating(true)
    setError('')
    setVideoUrl(null)
    const controller = new AbortController()
    generationController.current = controller
    try {
      const token = getToken()
      const response = await fetch(`${BASE}/api/member/video/generations`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ modelDbId: modelId, prompt: prompt.trim() }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const payload: unknown = await response.json().catch(() => null)
        if (response.status === 401 && responseError(payload) === 'Authentication required') {
          clearToken()
          window.dispatchEvent(new CustomEvent(UNAUTHORIZED_EVENT))
        }
        throw new Error(responseError(payload) || `Video yaratilmadi (HTTP ${response.status}).`)
      }
      const blob = await response.blob()
      if (blob.size === 0 || !blob.type.startsWith('video/')) {
        throw new Error('Server video faylini noto‘g‘ri formatda qaytardi.')
      }
      setVideoUrl(URL.createObjectURL(blob))
    } catch (reason) {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (generationController.current === controller) generationController.current = null
      if (!controller.signal.aborted) setGenerating(false)
    }
  }

  return (
    <main className="min-h-dvh bg-background">
      <header className="flex items-center justify-between border-b px-4 py-3 sm:px-6">
        <Link to="/chat" className="inline-flex min-h-10 items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Zarnur chatiga qaytish
        </Link>
        <Link to="/account" className="max-w-40 truncate text-xs text-muted-foreground transition hover:text-foreground sm:max-w-none">
          Hisob / kirish
        </Link>
      </header>

      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
        <div className="max-w-2xl">
          <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Zarnur video studiyasi</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            AI yordamida yangi video yarating yoki mavjud kliplaringizni telefoningizda montaj qiling.
          </p>
        </div>

        <div className="mt-6 inline-flex rounded-lg bg-muted p-1" role="group" aria-label="Video vositalari">
          <button
            type="button"
            aria-pressed={mode === 'generate'}
            onClick={() => setMode('generate')}
            className={`min-h-10 rounded-md px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === 'generate' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            AI video yaratish
          </button>
          <button
            type="button"
            aria-pressed={mode === 'edit'}
            onClick={() => setMode('edit')}
            className={`min-h-10 rounded-md px-4 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${mode === 'edit' ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'}`}
          >
            Video montaj
          </button>
        </div>

        {mode === 'edit' ? <VideoMontageEditor /> : (
        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <section className="space-y-5">
            {loading ? (
              <div className="space-y-3" role="status" aria-label="Video modeli tekshirilmoqda">
                <div className="h-5 w-40 animate-pulse rounded bg-muted" />
                <div className="h-28 animate-pulse rounded-xl bg-muted" />
                <div className="h-11 animate-pulse rounded-lg bg-muted" />
              </div>
            ) : authenticated === false ? (
              <div className="rounded-2xl border bg-card p-5">
                <p className="text-sm font-medium">Video yaratish uchun hisobga kiring</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Administrator ulashgan bepul video modelidan foydalanish uchun Zarnur hisob kerak.
                </p>
                <Link
                  to="/account"
                  className="mt-4 inline-flex min-h-11 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Kirish yoki hisob ochish
                </Link>
              </div>
            ) : error && models.length === 0 ? (
              <div className="rounded-2xl border bg-card p-5">
                <p className="text-sm font-medium">Video xizmatiga ulanib bo‘lmadi</p>
                <p role="alert" className="mt-1 text-sm leading-relaxed text-destructive">{error}</p>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="mt-4 inline-flex min-h-10 items-center rounded-lg border px-3 text-sm font-medium transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Qayta urinish
                </button>
              </div>
            ) : models.length === 0 ? (
              <div className="rounded-2xl border bg-card p-5">
                <p className="text-sm font-medium">Bepul video modeli hozircha ulashilmagan</p>
                <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                  Admin NovAI kalitini qo‘shib, foydalanuvchilar bilan ulashishi va CogVideoX Flash modelini yoqishi kerak.
                </p>
                {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
              </div>
            ) : (
              <form onSubmit={generate} className="space-y-4 rounded-2xl border bg-card p-5">
                <div className="flex items-center justify-between gap-3">
                  <label htmlFor="video-model" className="text-sm font-medium">Video modeli</label>
                  <select
                    id="video-model"
                    value={modelId ?? ''}
                    onChange={event => setModelId(Number(event.target.value))}
                    disabled={generating}
                    className="h-10 max-w-52 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
                  >
                    {models.map(model => (
                      <option key={model.id} value={model.id}>{model.displayName} · {model.provider}</option>
                    ))}
                  </select>
                </div>
                <label htmlFor="video-prompt" className="block text-sm font-medium">Video tavsifi</label>
                <textarea
                  id="video-prompt"
                  value={prompt}
                  onChange={event => setPrompt(event.target.value)}
                  maxLength={2000}
                  rows={6}
                  placeholder="Masalan: Tinch ko‘l ustidan quyosh chiqmoqda, suvda mayin to‘lqinlar..."
                  className="min-h-36 w-full resize-y rounded-xl border bg-background px-3 py-3 text-sm leading-relaxed outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={generating}
                />
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-muted-foreground">{prompt.length}/2000</span>
                  <button
                    type="submit"
                    disabled={generating || !prompt.trim() || !modelId}
                    className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50"
                  >
                    {generating
                      ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                      : <Sparkles className="size-4" aria-hidden="true" />}
                    {generating ? 'Video tayyorlanmoqda…' : 'Video yaratish'}
                  </button>
                </div>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Hozircha faqat matndan, bepul CogVideoX Flash modeli ishlaydi. Bu so‘rov kunlik 30 ta chat/video limitiga kiradi;
                  NovAI’ning o‘z kunlik kvotasi ham amal qiladi. Rasmni videoga aylantirish hozircha bepul rejimda yoqilmagan.
                </p>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              </form>
            )}
          </section>

          <section aria-label="Video natijasi" className="min-w-0">
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-2xl border bg-muted/40">
              {videoUrl ? (
                <video src={videoUrl} controls playsInline className="h-full w-full object-contain">
                  Brauzeringiz video ijrosini qo‘llab-quvvatlamaydi.
                </video>
              ) : generating ? (
                <div className="px-6 text-center" role="status">
                  <LoaderCircle className="mx-auto size-7 animate-spin text-muted-foreground" aria-hidden="true" />
                  <p className="mt-3 text-sm font-medium">Video tayyorlanmoqda</p>
                  <p className="mt-1 text-xs text-muted-foreground">Bu bir necha daqiqa olishi mumkin. Sahifani ochiq qoldiring.</p>
                </div>
              ) : (
                <div className="px-6 text-center">
                  <Clapperboard className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
                  <p className="mt-3 text-sm font-medium">Tayyor video shu yerda chiqadi</p>
                  <p className="mt-1 text-xs text-muted-foreground">Video yaratish tugmasini bosgach, shu oynada ko‘ring.</p>
                </div>
              )}
            </div>
            {videoUrl && (
              <a
                href={videoUrl}
                download="zarnur-video.mp4"
                className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm font-medium transition hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Download className="size-4" aria-hidden="true" />
                MP4 videoni yuklab olish
              </a>
            )}
          </section>
        </div>
        )}
      </div>
    </main>
  )
}
