import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowUp, KeyRound, LoaderCircle, RotateCcw, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'

interface PublicModel {
  platform: string
  provider: string
  modelId: string
  displayName: string
}

interface Message {
  role: 'user' | 'assistant'
  content: string
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const MODEL_KEY = (model: PublicModel) => JSON.stringify([model.platform, model.modelId])

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

export default function PublicChatPage() {
  const secureChatAllowed = window.isSecureContext
  const [models, setModels] = useState<PublicModel[]>([])
  const [modelKey, setModelKey] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [messages, setMessages] = useState<Message[]>([])
  const [draft, setDraft] = useState('')
  const [loadingModels, setLoadingModels] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  const selectedModel = useMemo(
    () => models.find(model => MODEL_KEY(model) === modelKey),
    [models, modelKey],
  )

  useEffect(() => {
    const controller = new AbortController()
    fetch(`${BASE}/api/public/chat/models`, { signal: controller.signal })
      .then(async response => {
        const payload: unknown = await response.json()
        if (!response.ok) throw new Error(errorMessage(payload, 'Modellarni yuklab bo‘lmadi.'))
        if (!isRecord(payload) || !Array.isArray(payload.models)) {
          throw new Error('Server model ro‘yxatini noto‘g‘ri yubordi.')
        }
        const validModels = payload.models.filter((model): model is PublicModel =>
          isRecord(model) &&
          typeof model.platform === 'string' &&
          typeof model.provider === 'string' &&
          typeof model.modelId === 'string' &&
          typeof model.displayName === 'string',
        )
        setModels(validModels)
        if (validModels[0]) setModelKey(MODEL_KEY(validModels[0]))
      })
      .catch(reason => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : String(reason))
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingModels(false)
      })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages, sending])

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || !apiKey.trim() || !selectedModel || sending || !secureChatAllowed) return

    const nextMessages = [...messages, { role: 'user' as const, content }]
    setMessages(nextMessages)
    setDraft('')
    setError('')
    setSending(true)

    try {
      const response = await fetch(`${BASE}/api/public/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          platform: selectedModel.platform,
          modelId: selectedModel.modelId,
          apiKey: apiKey.trim(),
          messages: [
            { role: 'system', content: 'You are Zarnur, a helpful AI assistant. Reply in the language used by the user.' },
            ...nextMessages.slice(-19),
          ],
        }),
      })
      const payload: unknown = await response.json()
      if (!response.ok) throw new Error(errorMessage(payload, 'Javob olishda xatolik yuz berdi.'))
      const answer = assistantText(payload)
      if (!answer) throw new Error('Model bo‘sh javob qaytardi. Boshqa modelni tanlab ko‘ring.')
      setMessages(current => [...current, { role: 'assistant', content: answer }])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
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
        <div className="text-right">
          <p className="text-sm font-semibold">Zarnur AI</p>
          <p className="text-[11px] text-muted-foreground">Shaxsiy API kalitingiz bilan chat</p>
          <a href={`${BASE}/zarnur-qollanma.pdf`} target="_blank" rel="noreferrer" className="text-[11px] text-amber-700 underline dark:text-amber-300">
            API kalit qo‘llanmasi (PDF)
          </a>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-4xl shrink-0 gap-3 px-4 py-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)] sm:px-6">
        <label className="grid gap-1.5 text-xs font-medium">
          Model
          <select
            value={modelKey}
            onChange={event => setModelKey(event.target.value)}
            disabled={loadingModels || models.length === 0 || sending}
            className="h-10 min-w-0 rounded-lg border bg-background px-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {loadingModels && <option value="">Modellar yuklanmoqda…</option>}
            {!loadingModels && models.length === 0 && <option value="">Model topilmadi</option>}
            {models.map(model => (
              <option key={MODEL_KEY(model)} value={MODEL_KEY(model)}>
                {model.provider} — {model.displayName}
              </option>
            ))}
          </select>
        </label>

        <label className="grid gap-1.5 text-xs font-medium">
          Provider API kaliti
          <span className="relative">
            <KeyRound className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              maxLength={4096}
              value={apiKey}
              onChange={event => setApiKey(event.target.value)}
              placeholder="O‘zingizning provider kalitingiz"
              disabled={!secureChatAllowed}
              className="h-10 w-full rounded-lg border bg-background pl-9 pr-3 text-sm font-normal outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            />
          </span>
          <span className={`font-normal ${secureChatAllowed ? 'text-muted-foreground' : 'text-destructive'}`}>
            {secureChatAllowed
              ? 'Kalit so‘rov uchun uzatiladi, serverda saqlanmaydi. Provider limitlari amal qiladi.'
              : 'API kalitni yuborish uchun HTTPS kerak. Saytning xavfsiz HTTPS manzilini oching.'}
          </span>
        </label>
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
            <h1 className="mt-4 text-xl font-semibold">Zarnur bilan suhbatni boshlang</h1>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Modelni tanlang, o‘z API kalitingizni kiriting va savolingizni yozing.
            </p>
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

      <footer className="shrink-0 border-t bg-background px-4 py-3 sm:px-6">
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
              placeholder={apiKey ? 'Xabaringizni yozing…' : 'Avval provider API kalitini kiriting'}
              aria-label="Xabar"
              className="max-h-36 min-h-10 flex-1 resize-y bg-transparent px-2 py-2 text-sm outline-none placeholder:text-muted-foreground"
              disabled={sending || !secureChatAllowed}
            />
            <button
              type="submit"
              aria-label="Xabarni yuborish"
              disabled={sending || !secureChatAllowed || !apiKey.trim() || !selectedModel || !draft.trim()}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
            >
              {sending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-5" />}
            </button>
          </form>
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
