import { useEffect, useRef, useState, type FormEvent } from 'react'
import { LoaderCircle, MessageCircle, RefreshCw, Send, Shield, Trash2, Users, WandSparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { apiFetch } from '@/lib/api'
import type { ApiKey } from '../../../shared/types'

interface Overview {
  visitors: number
  aiUsers: number
  aiUses: number
  unreadMessages: number
}

interface Thread {
  visitorId: number
  deviceType: string
  operatingSystem: string
  firstSeenAt: string
  lastSeenAt: string
  aiUses: number
  messageCount: number
  unreadCount: number
  latestMessageAt: string
  lastMessage: string
}

interface Visitor {
  visitorId: number
  deviceType: string
  operatingSystem: string
  firstSeenAt: string
  lastSeenAt: string
  aiUses: number
  messageCount: number
}

interface SupportMessage {
  id: number
  sender: 'visitor' | 'admin'
  content: string
  createdAt: string
}

interface RegisteredUser {
  id: number
  email: string
  role: 'admin' | 'user'
  disabled: boolean
  createdAt: string
  requestsToday: number
}

const EMPTY_OVERVIEW: Overview = { visitors: 0, aiUsers: 0, aiUses: 0, unreadMessages: 0 }

function formatDate(value: string): string {
  const date = new Date(value.replace(' ', 'T') + (value.endsWith('Z') ? '' : 'Z'))
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat('uz-UZ', { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

export default function ZarnurAdminPage() {
  const [overview, setOverview] = useState<Overview>(EMPTY_OVERVIEW)
  const [threads, setThreads] = useState<Thread[]>([])
  const [visitors, setVisitors] = useState<Visitor[]>([])
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([])
  const [providerKeys, setProviderKeys] = useState<ApiKey[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [messages, setMessages] = useState<SupportMessage[]>([])
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [updatingId, setUpdatingId] = useState<number | null>(null)
  const [error, setError] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  async function refreshInbox() {
    const [stats, inbox, visitorList] = await Promise.all([
      apiFetch<Overview>('/api/support/overview'),
      apiFetch<{ threads: Thread[] }>('/api/support/threads'),
      apiFetch<{ visitors: Visitor[] }>('/api/support/visitors'),
    ])
    setOverview(stats)
    setThreads(inbox.threads)
    setVisitors(visitorList.visitors)
  }

  async function refreshMembers() {
    const result = await apiFetch<{ users: RegisteredUser[] }>('/api/admin/users')
    setRegisteredUsers(result.users)
  }

  async function refreshKeys() {
    const result = await apiFetch<ApiKey[]>('/api/keys')
    setProviderKeys(result)
  }

  async function refreshMessages(visitorId: number) {
    const result = await apiFetch<{ messages: SupportMessage[] }>(
      `/api/support/threads/${visitorId}/messages`,
    )
    setMessages(result.messages)
  }

  useEffect(() => {
    let active = true
    const load = async () => {
      try {
        await Promise.all([refreshInbox(), refreshMembers(), refreshKeys()])
        if (active) setError('')
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    const interval = window.setInterval(() => { void load() }, 10000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (selectedId === null) return
    let active = true
    const load = async () => {
      try {
        const result = await apiFetch<{ messages: SupportMessage[] }>(
          `/api/support/threads/${selectedId}/messages`,
        )
        if (active) {
          setMessages(result.messages)
          setError('')
        }
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : String(reason))
      }
    }
    void load()
    const interval = window.setInterval(() => { void load() }, 5000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [selectedId])

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [messages])

  async function sendReply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const content = draft.trim()
    if (!content || selectedId === null || sending) return
    setSending(true)
    setError('')
    try {
      await apiFetch(`/api/support/threads/${selectedId}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content }),
      })
      setDraft('')
      await Promise.all([refreshMessages(selectedId), refreshInbox()])
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setSending(false)
    }
  }

  async function deleteThread(visitorId: number) {
    if (!window.confirm('Ushbu mehmonning chat tarixi va anonim statistik ma’lumotlarini o‘chirasizmi?')) return
    try {
      await apiFetch(`/api/support/threads/${visitorId}`, { method: 'DELETE' })
      if (selectedId === visitorId) {
        setSelectedId(null)
        setMessages([])
      }
      await refreshInbox()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  async function setMemberDisabled(member: RegisteredUser, disabled: boolean) {
    if (disabled && !window.confirm(`${member.email} hisobini vaqtincha o‘chirasizmi? U qayta yoqilguncha chatga kira olmaydi.`)) return
    setUpdatingId(member.id)
    setError('')
    try {
      await apiFetch(`/api/admin/users/${member.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ disabled }),
      })
      await refreshMembers()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setUpdatingId(null)
    }
  }

  async function setKeyShared(key: ApiKey, shareWithMembers: boolean) {
    setUpdatingId(-key.id)
    setError('')
    try {
      await apiFetch(`/api/keys/${key.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ shareWithMembers }),
      })
      await refreshKeys()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setUpdatingId(null)
    }
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.18em] text-amber-700 dark:text-amber-300">ZARNUR</p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Admin paneli</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Birinchi sozlashda yaratgan hisobingiz admin hisobidir. Tashrifchilar anonim tarzda ko‘rsatiladi.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void refreshInbox()}>
          <RefreshCw className="size-4" aria-hidden="true" />
          Yangilash
        </Button>
      </header>

      {error && <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Zarnur statistikasi">
        {[
          { title: 'Rozilik bergan tashrifchilar', value: overview.visitors, icon: Users },
          { title: 'AI chatdan foydalanganlar', value: overview.aiUsers, icon: WandSparkles },
          { title: 'Muvaffaqiyatli AI so‘rovlari', value: overview.aiUses, icon: MessageCircle },
          { title: 'Javob kutayotgan xabarlar', value: overview.unreadMessages, icon: MessageCircle },
        ].map(card => (
          <article key={card.title} className="rounded-2xl border bg-card p-4 shadow-sm">
            <div className="flex items-center justify-between gap-2 text-sm text-muted-foreground">
              <span>{card.title}</span>
              <card.icon className="size-4 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" />
            </div>
            <p className="mt-3 text-3xl font-semibold tabular-nums">{card.value}</p>
          </article>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card">
        <div className="border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Users className="size-4 text-amber-600 dark:text-amber-300" aria-hidden="true" />
            <h2 className="font-semibold">Ro‘yxatdan o‘tgan foydalanuvchilar</h2>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Hisoblarni kuzating va kerak bo‘lsa vaqtincha o‘chirib qo‘ying. Har bir hisob kuniga 30 ta server AI xabaridan foydalanadi.
          </p>
        </div>
        {registeredUsers.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Hozircha hisob ochgan foydalanuvchi yo‘q.</p>
        ) : (
          <div className="divide-y">
            {registeredUsers.map(member => (
              <article key={member.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{member.email}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {member.role === 'admin' ? 'Administrator' : 'Foydalanuvchi'} · {member.requestsToday} AI xabari bugun
                    {member.disabled ? ' · Hisob o‘chirilgan' : ''}
                  </p>
                </div>
                {member.role === 'user' && (
                  <Button
                    type="button"
                    size="sm"
                    variant={member.disabled ? 'outline' : 'ghost'}
                    disabled={updatingId === member.id}
                    onClick={() => void setMemberDisabled(member, !member.disabled)}
                  >
                    {updatingId === member.id ? <LoaderCircle className="size-4 animate-spin" /> : null}
                    {member.disabled ? 'Qayta yoqish' : 'Hisobni o‘chirish'}
                  </Button>
                )}
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-2xl border bg-card">
        <div className="border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Shield className="size-4 text-amber-600 dark:text-amber-300" aria-hidden="true" />
            <h2 className="font-semibold">AI kalitlarini foydalanuvchilar bilan ulashish</h2>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Faqat siz belgilagan kalitlar foydalanuvchilarga ochiladi. Ulashilgan kalitlar provayder kvotasidan foydalanadi
            va bepul tariflar ham o‘zgarishi mumkin.
          </p>
        </div>
        {providerKeys.filter(key => !key.keyless && key.platform !== 'custom').length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Ulashish mumkin bo‘lgan provayder kaliti topilmadi.</p>
        ) : (
          <div className="divide-y">
            {providerKeys.filter(key => !key.keyless && key.platform !== 'custom').map(key => (
              <article key={key.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{key.label || key.platform}</p>
                  <p className="mt-1 truncate text-xs text-muted-foreground">
                    {key.platform} · {key.maskedKey} · {key.enabled ? key.status : 'o‘chirilgan'}
                  </p>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant={key.shareWithMembers ? 'default' : 'outline'}
                  disabled={updatingId === -key.id}
                  onClick={() => void setKeyShared(key, !key.shareWithMembers)}
                >
                  {updatingId === -key.id ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  {key.shareWithMembers ? 'Ulashilgan' : 'Ulashish'}
                </Button>
              </article>
            ))}
          </div>
        )}
      </section>

      <p className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs leading-relaxed text-muted-foreground">
        Qurilma ma’lumoti faqat umumiy tur (telefon/planshet/kompyuter) va operatsion tizimdan iborat.
        Aniq telefon modeli, IP-manzil va to‘liq brauzer ma’lumoti saqlanmaydi. Statistikaga maxfiylik roziligini
        bergan tashrifchilar kiradi.
      </p>

      <section className="overflow-hidden rounded-2xl border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="font-semibold">Tashrifchilar qurilmalari</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Telefonlar iPhone/iOS yoki Android kabi umumiy ko‘rinishda ko‘rsatiladi; aniq model olinmaydi.
          </p>
        </div>
        {visitors.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">Rozilik bergan tashrifchilar hozircha yo‘q.</p>
        ) : (
          <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-3">
            {visitors.map(visitor => (
              <article key={visitor.visitorId} className="bg-card p-4">
                <p className="text-sm font-medium">
                  Mehmon #{visitor.visitorId} · {visitor.deviceType} · {visitor.operatingSystem}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {visitor.aiUses} AI so‘rovi · {visitor.messageCount} yordam xabari
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Oxirgi faollik: {formatDate(visitor.lastSeenAt)}
                </p>
              </article>
            ))}
          </div>
        )}
      </section>

      <section className="grid min-h-[32rem] overflow-hidden rounded-2xl border bg-card lg:grid-cols-[minmax(17rem,.75fr)_minmax(0,1.4fr)]">
        <aside className="border-b lg:border-b-0 lg:border-r">
          <div className="border-b px-4 py-3">
            <h2 className="font-semibold">Yordam chatlari</h2>
            <p className="mt-1 text-xs text-muted-foreground">Yangi xabarlar avtomatik tekshiriladi.</p>
          </div>
          <div className="max-h-[28rem] overflow-y-auto lg:max-h-[38rem]">
            {loading && threads.length === 0 && (
              <p className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                Yuklanmoqda…
              </p>
            )}
            {!loading && threads.length === 0 && (
              <p className="p-4 text-sm text-muted-foreground">Hozircha yordam chatida xabar yo‘q.</p>
            )}
            {threads.map(thread => (
              <button
                key={thread.visitorId}
                type="button"
                onClick={() => setSelectedId(thread.visitorId)}
                className={`w-full border-b px-4 py-3 text-left transition hover:bg-muted/60 ${
                  selectedId === thread.visitorId ? 'bg-muted' : ''
                }`}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">
                    Mehmon #{thread.visitorId} · {thread.deviceType} · {thread.operatingSystem}
                  </span>
                  {thread.unreadCount > 0 && (
                    <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] text-primary-foreground">
                      {thread.unreadCount}
                    </span>
                  )}
                </span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">{thread.lastMessage}</span>
                <span className="mt-1 block text-[10px] text-muted-foreground">
                  {thread.aiUses} AI so‘rovi · {formatDate(thread.latestMessageAt)}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <div className="flex min-h-[24rem] flex-col">
          {selectedId === null ? (
            <div className="flex flex-1 flex-col items-center justify-center p-8 text-center text-muted-foreground">
              <MessageCircle className="size-8 text-amber-600/70" aria-hidden="true" />
              <p className="mt-3 text-sm">Javob yozish uchun chap tomondan suhbatni tanlang.</p>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
                <div>
                  <h2 className="font-semibold">Mehmon #{selectedId}</h2>
                  <p className="text-xs text-muted-foreground">
                    {threads.find(thread => thread.visitorId === selectedId)?.deviceType ?? '—'} ·{' '}
                    {threads.find(thread => thread.visitorId === selectedId)?.operatingSystem ?? '—'}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Chatni va anonim tashrif ma’lumotini o‘chirish"
                  onClick={() => void deleteThread(selectedId)}
                >
                  <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                </Button>
              </div>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4" aria-live="polite">
                {messages.map(message => (
                  <div key={message.id} className={`flex ${message.sender === 'admin' ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 ${
                      message.sender === 'admin' ? 'bg-primary text-primary-foreground' : 'border bg-background'
                    }`}>
                      <p className="whitespace-pre-wrap text-sm">{message.content}</p>
                      <p className={`mt-1 text-[10px] ${message.sender === 'admin' ? 'text-primary-foreground/70' : 'text-muted-foreground'}`}>
                        {formatDate(message.createdAt)}
                      </p>
                    </div>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              <form onSubmit={sendReply} className="flex items-end gap-2 border-t p-3">
                <textarea
                  value={draft}
                  onChange={event => setDraft(event.target.value)}
                  maxLength={2000}
                  rows={2}
                  placeholder="Javob yozing…"
                  aria-label="Tashrifchiga javob"
                  className="min-h-10 flex-1 resize-y rounded-xl border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  disabled={sending}
                />
                <Button type="submit" size="icon" aria-label="Javobni yuborish" disabled={sending || !draft.trim()}>
                  {sending ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
                </Button>
              </form>
            </>
          )}
        </div>
      </section>

      <p className="text-xs text-muted-foreground">
        Oxirgi faollik va tashriflar uchun qo‘shimcha ma’lumot tashrifchi rozilik berganidan keyin qayd qilinadi.
      </p>
    </div>
  )
}
