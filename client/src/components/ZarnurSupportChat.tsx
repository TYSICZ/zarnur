import { useEffect, useState, type FormEvent } from 'react'
import { LoaderCircle, MessageCircle, Send, ShieldCheck, X } from 'lucide-react'
import {
  Dialog,
  DialogClose,
  DialogDescription,
  DialogPopup,
  DialogTitle,
} from '@/components/ui/dialog'

interface SupportMessage {
  id: number
  sender: 'visitor' | 'admin'
  content: string
  createdAt: string
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
const CONSENT_KEY = 'zarnur-privacy-consent'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function responseError(payload: unknown, fallback: string): string {
  if (!isRecord(payload) || !isRecord(payload.error)) return fallback
  return typeof payload.error.message === 'string' ? payload.error.message : fallback
}

function parseMessages(payload: unknown): SupportMessage[] {
  if (!isRecord(payload) || !Array.isArray(payload.messages)) return []
  return payload.messages.filter((message): message is SupportMessage =>
    isRecord(message) &&
    typeof message.id === 'number' &&
    (message.sender === 'visitor' || message.sender === 'admin') &&
    typeof message.content === 'string' &&
    typeof message.createdAt === 'string',
  )
}

async function request(path: string, init?: RequestInit): Promise<unknown> {
  const response = await fetch(`${BASE}${path}`, {
    credentials: 'same-origin',
    ...init,
  })
  const payload: unknown = await response.json()
  if (!response.ok) throw new Error(responseError(payload, 'So‘rov bajarilmadi.'))
  return payload
}

export default function ZarnurSupportChat() {
  const [consented, setConsented] = useState(() => {
    try {
      return window.localStorage.getItem(CONSENT_KEY) === 'accepted'
    } catch {
      return false
    }
  })
  const [declined, setDeclined] = useState(() => {
    try {
      return window.localStorage.getItem(CONSENT_KEY) === 'declined'
    } catch {
      return false
    }
  })
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (consented) {
      request('/api/public/visitors/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: true }),
      }).then(() => setConsented(true)).catch(() => setConsented(false))
    }
  }, [consented])

  useEffect(() => {
    if (!open || !consented) return
    let active = true
    const loadMessages = async () => {
      try {
        const payload = await request('/api/public/support/messages')
        if (active) {
          setMessages(parseMessages(payload))
          setError('')
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadMessages()
    const interval = window.setInterval(() => { void loadMessages() }, 6000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [open, consented])

  async function acceptConsent() {
    setError('')
    try {
      await request('/api/public/visitors/visit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ consent: true }),
      })
      try {
        window.localStorage.setItem(CONSENT_KEY, 'accepted')
      } catch {
        setError('Brauzer rozilikni saqlay olmadi. Brauzer sozlamalarini tekshiring.')
        return
      }
      setConsented(true)
      setDeclined(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  function declineConsent() {
    try {
      window.localStorage.setItem(CONSENT_KEY, 'declined')
    } catch {
      // The visitor can still continue without analytics or the support inbox.
    }
    setDeclined(true)
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || sending) return
    setSending(true)
    setError('')
    try {
      await request('/api/public/support/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      setDraft('')
      const payload = await request('/api/public/support/messages')
      setMessages(parseMessages(payload))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSending(false)
    }
  }

  return (
    <>
      {!consented && !declined && (
        <aside className="fixed bottom-4 left-4 z-40 w-[min(26rem,calc(100vw-2rem))] rounded-2xl border bg-card p-4 text-card-foreground shadow-xl">
          <div className="flex items-start gap-3">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-amber-600" aria-hidden="true" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">Maxfiylik va yordam chati</p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                Rozilik bersangiz, tashrif va AI foydalanish soni hamda qurilmaning umumiy turi saqlanadi.
                Aniq telefon modeli, IP-manzil va API kalitingiz saqlanmaydi. Yordam chatidagi xabarlarni
                Zarnur administratori ko‘radi.
              </p>
              {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void acceptConsent()}
                  className="inline-flex min-h-9 items-center rounded-lg bg-primary px-3 text-xs font-medium text-primary-foreground"
                >
                  Roziman va davom etish
                </button>
                <button
                  type="button"
                  onClick={declineConsent}
                  className="inline-flex min-h-9 items-center rounded-lg border px-3 text-xs font-medium"
                >
                  Hozircha yo‘q
                </button>
              </div>
            </div>
          </div>
        </aside>
      )}

      {declined && (
        <button
          type="button"
          onClick={() => setDeclined(false)}
          className="fixed bottom-4 left-4 z-40 rounded-full border bg-card px-4 py-2.5 text-xs font-medium text-card-foreground shadow-lg"
        >
          Yordam va maxfiylik sozlamalari
        </button>
      )}

      {consented && (
        <>
          <button
            type="button"
            onClick={() => { setLoading(true); setOpen(true) }}
            aria-label="Zarnur administratori bilan yozishish"
            className="fixed bottom-4 left-4 z-40 inline-flex min-h-11 items-center gap-2 rounded-full border border-amber-300/30 bg-stone-950 px-4 text-sm font-medium text-amber-100 shadow-xl transition hover:bg-stone-900"
          >
            <MessageCircle className="size-4" aria-hidden="true" />
            Yordam
          </button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogPopup className="flex h-[min(82dvh,42rem)] flex-col p-0" maxWidth="max-w-md">
              <div className="flex shrink-0 items-start justify-between border-b px-5 py-4">
                <div>
                  <DialogTitle>Admin bilan chat</DialogTitle>
                  <DialogDescription className="mt-1">
                    API kalit yaratish yoki Zarnurdan foydalanish bo‘yicha savol bering.
                  </DialogDescription>
                </div>
                <DialogClose
                  aria-label="Chatni yopish"
                  className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="size-4" aria-hidden="true" />
                </DialogClose>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4" aria-live="polite">
                {messages.length === 0 && !loading && (
                  <p className="rounded-xl bg-muted p-3 text-sm text-muted-foreground">
                    Salom! Qaysi providerda API kalit yaratish yoki chatni ishlatish bo‘yicha yordam kerak?
                  </p>
                )}
                {messages.map(message => (
                  <div key={message.id} className={`flex ${message.sender === 'visitor' ? 'justify-end' : 'justify-start'}`}>
                    <p className={`max-w-[88%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${
                      message.sender === 'visitor' ? 'bg-primary text-primary-foreground' : 'border bg-card'
                    }`}>
                      {message.content}
                    </p>
                  </div>
                ))}
                {loading && messages.length === 0 && (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                    Xabarlar yuklanmoqda…
                  </p>
                )}
              </div>
              <div className="shrink-0 border-t p-4">
                {error && <p role="alert" className="mb-2 text-xs text-destructive">{error}</p>}
                <form onSubmit={sendMessage} className="flex items-end gap-2">
                  <textarea
                    value={draft}
                    onChange={event => setDraft(event.target.value)}
                    maxLength={2000}
                    rows={2}
                    placeholder="Xabaringizni yozing…"
                    aria-label="Admin uchun xabar"
                    className="min-h-10 flex-1 resize-y rounded-xl border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    disabled={sending}
                  />
                  <button
                    type="submit"
                    aria-label="Yordam xabarini yuborish"
                    disabled={sending || !draft.trim()}
                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground disabled:opacity-40"
                  >
                    {sending ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
                  </button>
                </form>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  API kalitingizni bu chatga yubormang.
                </p>
              </div>
            </DialogPopup>
          </Dialog>
        </>
      )}
    </>
  )
}
