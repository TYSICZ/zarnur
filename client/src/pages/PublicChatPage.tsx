import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowUp, Clapperboard, LoaderCircle, RotateCcw, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'
import { apiFetch } from '@/lib/api'
import { choosePreferredZarnurModel, type ZarnurChatModel } from '@/lib/zarnur-chat-model'

type PublicModel = ZarnurChatModel

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const SUGGESTIONS = [
  'Instagram uchun zargarlik posti yoz',
  'Mijozga muloyim javob tayyorla',
  'Yangi kolleksiya uchun nom top',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload) || !isRecord(payload.error)) return fallback
  return typeof payload.error.message === 'string' ? payload.error.message : fallback
}

function assistantText(payload: unknown): string {
  if (!isRecord(payload) || !Array.isArray(payload.choices) || !isRecord(payload.choices[0])) {
    return ''
  }
  const choice = payload.choices[0]
  if (!isRecord(choice.message)) return ''
  const content = choice.message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map(block => {
    if (typeof block === 'string') return block
    return isRecord(block) && typeof block.text === 'string' ? block.text : ''
  }).join('')
}

function chatError(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason)
  if (/failed to fetch|networkerror|fetch failed/i.test(message)) {
    return 'Internet ulanishingizni tekshirib, yana urinib ko‘ring.'
  }
  return message || 'Javob olishda xatolik yuz berdi.'
}

export default function PublicChatPage() {
  const secureChatAllowed = window.isSecureContext
  const [models, setModels] = useState<PublicModel[]>([])
  const [account, setAccount] = useState<{ email: string; role: string } | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [loadingModels, setLoadingModels] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  const selectedModel = useMemo(
    () => choosePreferredZarnurModel(models),
    [models],
  )

  useEffect(() => {
    const controller = new AbortController()
    async function loadModels() {
      let guestModels: PublicModel[] = []
      let guestError = ''
      try {
        const response = await fetch(`${BASE}/api/public/chat/models`, { signal: controller.signal })
        const payload: unknown = await response.json()
        if (!response.ok) throw new Error(errorMessage(payload, 'Modellarni yuklab bo‘lmadi.'))
        if (!isRecord(payload) || !Array.isArray(payload.models)) {
          throw new Error('Server model ro‘yxatini noto‘g‘ri yubordi.')
        }
        guestModels = payload.models.flatMap((model): PublicModel[] =>
          isRecord(model) &&
          typeof model.platform === 'string' &&
          typeof model.provider === 'string' &&
          typeof model.modelId === 'string' &&
          typeof model.displayName === 'string'
            ? [{
              platform: model.platform,
              provider: model.provider,
              modelId: model.modelId,
              displayName: model.displayName,
              access: 'guest',
            }]
            : [],
        )
      } catch (reason) {
        if (controller.signal.aborted) return
        guestError = reason instanceof Error ? reason.message : String(reason)
      }

      let memberModels: PublicModel[] = []
      try {
        const status = await apiFetch<{ authenticated: boolean; email: string | null; role: string | null }>(
          '/api/auth/status',
          { signal: controller.signal },
        )
        if (status.authenticated && status.email) {
          setAccount({ email: status.email, role: status.role ?? 'user' })
          const payload = await apiFetch<unknown>('/api/member/chat/models', { signal: controller.signal })
          if (isRecord(payload) && Array.isArray(payload.models)) {
            memberModels = payload.models.flatMap((model): PublicModel[] =>
              isRecord(model) &&
              typeof model.id === 'number' &&
              typeof model.platform === 'string' &&
              typeof model.provider === 'string' &&
              typeof model.modelId === 'string' &&
              typeof model.displayName === 'string'
                ? [{
                  access: 'member',
                  modelDbId: model.id,
                  platform: model.platform,
                  provider: model.provider,
                  modelId: model.modelId,
                  displayName: model.displayName,
                }]
                : [],
            )
          }
        }
      } catch {
        // Guest chat remains available if account status or shared models cannot load.
      }

      if (controller.signal.aborted) return
      const availableModels = [...memberModels, ...guestModels]
      setModels(availableModels)
      if (availableModels.length === 0 && guestError) setError(guestError)
      setLoadingModels(false)
    }

    void loadModels()
    return () => controller.abort()
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages, sending])

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || !selectedModel || sending || !secureChatAllowed) return

    const previousMessages = messages
    const nextMessages = [...messages, { role: 'user' as const, content }]
    setMessages(nextMessages)
    setDraft('')
    setError('')
    setSending(true)

    try {
      let payload: unknown
      if (selectedModel.access === 'automatic') {
        payload = await apiFetch<unknown>('/api/member/chat/completions', {
          method: 'POST',
          body: JSON.stringify({
            automatic: true,
            messages: nextMessages.slice(-20),
          }),
        })
      } else {
        const response = await fetch(`${BASE}/api/public/chat/completions`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            platform: selectedModel.platform,
            modelId: selectedModel.modelId,
            messages: nextMessages.slice(-20),
          }),
        })
        payload = await response.json()
        if (!response.ok) throw new Error(errorMessage(payload, 'Javob olishda xatolik yuz berdi.'))
      }
      const answer = assistantText(payload)
      if (!answer) throw new Error('Model bo‘sh javob qaytardi. Boshqa modelni tanlab ko‘ring.')
      setMessages(current => [...current, { role: 'assistant', content: answer }])
    } catch (reason) {
      setMessages(previousMessages)
      setDraft(content)
      setError(chatError(reason))
    } finally {
      setSending(false)
    }
  }

  return (
    <main className="flex h-dvh min-h-[520px] flex-col bg-background">
      <header className="flex shrink-0 items-center justify-between border-b px-4 py-3 sm:px-6">
        <Link to="/" className="inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Bosh sahifa
        </Link>
        <div className="flex items-center gap-3">
          <Link to="/video" className="inline-flex min-h-10 items-center gap-1.5 rounded-lg border px-2.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground">
            <Clapperboard className="size-3.5" aria-hidden="true" />
            Video
          </Link>
          <Link to="/account" className="max-w-36 truncate text-xs text-muted-foreground transition hover:text-foreground sm:max-w-none">
            {account?.email ?? 'Kirish / hisob ochish'}
          </Link>
          <div className="text-right">
            <p className="text-sm font-semibold">Zarnur AI</p>
            <p className="text-[11px] text-muted-foreground">Bepul chat · API kaliti shart emas</p>
          </div>
        </div>
      </header>

      <section className="mx-auto w-full max-w-4xl shrink-0 px-4 py-4 sm:px-6">
        <div className="flex items-center rounded-xl border bg-card px-4 py-3">
          <div>
            <p className="text-sm font-medium">
              {loadingModels
                ? 'AI modellar yuklanmoqda…'
                : selectedModel?.access === 'automatic'
                  ? 'Administrator boshqaradigan avtomatik model'
                  : 'Mehmonlar uchun bepul model'}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {selectedModel?.access === 'automatic'
                ? 'Administrator yoqqan va ulashgan Google, Groq, Cloudflare hamda boshqa modellar avtomatik ishlatiladi; foydalanuvchilar tanlamaydi.'
                : 'API kaliti kerak emas. Mehmonlar uchun umumiy soatlik limit mavjud.'}
            </p>
          </div>
        </div>
      </section>

      <section
        className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-y-auto px-4 pb-4 sm:px-6"
        aria-label="Zarnur AI suhbat"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center py-10 text-center">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-amber-500/10 text-amber-600 dark:text-amber-300">
              <Sparkles className="size-7" aria-hidden="true" />
            </div>
            <h1 className="mt-4 text-xl font-semibold">Salom, men Zarnur.</h1>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              O‘zbekcha savollaringizga o‘zbekcha javob berishga harakat qilaman. Hisobga kirgach, administrator yoqqan va ulashgan AI modellari orasida avtomatik yo‘naltiraman.
            </p>
            {models.length > 0 && (
              <div className="mt-6 flex max-w-xl flex-wrap justify-center gap-2">
                {SUGGESTIONS.map(suggestion => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setDraft(suggestion)}
                    className="min-h-10 rounded-full border bg-card px-3.5 text-xs text-foreground transition hover:border-amber-500/50 hover:bg-amber-500/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
            {!loadingModels && models.length === 0 && (
              <p className="mt-4 max-w-md text-sm text-destructive">
                {error || 'Bepul AI hozircha javob bera olmaydi. Birozdan keyin qayta urinib ko‘ring.'}
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-4 py-4">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <p className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
                  message.role === 'user'
                    ? 'bg-primary text-primary-foreground'
                    : 'border bg-card'
                }`}>
                  {message.content}
                </p>
              </div>
            ))}
            {sending && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                Zarnur javob tayyorlamoqda…
              </div>
            )}
            <div ref={endRef} />
          </div>
        )}
      </section>

      {account && !models.some(model => model.access === 'member') && (
        <p className="mx-auto w-full max-w-4xl px-4 pb-2 text-xs text-muted-foreground sm:px-6">
          Umumiy AI modeli yo‘q. Administrator /admin sahifasida kerakli kalitni yoqib, “Ulashish”ni belgilashi kerak.
        </p>
      )}

      <footer className="shrink-0 border-t bg-background px-4 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-6">
        <div className="mx-auto max-w-4xl">
          {error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}
          <form onSubmit={sendMessage} className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-sm">
            <textarea
              value={draft}
              onChange={event => setDraft(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  event.currentTarget.form?.requestSubmit()
                }
              }}
              maxLength={6000}
              rows={2}
              placeholder={selectedModel ? 'Zarnurga savolingizni yozing…' : 'Bepul AI ulanmoqda…'}
              aria-label="Xabar"
              className="max-h-36 min-h-10 flex-1 resize-y bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
              disabled={sending || !secureChatAllowed || !selectedModel}
            />
            <button
              type="submit"
              aria-label="Xabarni yuborish"
              disabled={sending || !secureChatAllowed || !selectedModel || !draft.trim()}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
            >
              {sending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-5" />}
            </button>
          </form>
          <p className="mt-2 text-center text-[11px] leading-relaxed text-muted-foreground">
            Xabarlar bepul AI provayderiga yuboriladi va xizmatni yaxshilash uchun qayd qilinishi mumkin.
            Maxfiy ma’lumot yubormang.
          </p>
          {!secureChatAllowed && (
            <p role="alert" className="mt-2 text-center text-xs text-destructive">
              Xavfsiz ulanish uchun Zarnur’ni HTTPS manzilidan oching.
            </p>
          )}
          {messages.length > 0 && (
            <button
              type="button"
              onClick={() => { setMessages([]); setError('') }}
              className="mt-2 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"
            >
              <RotateCcw className="size-3" aria-hidden="true" />
              Yangi suhbat
            </button>
          )}
        </div>
      </footer>
    </main>
  )
}
