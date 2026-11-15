import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { ArrowLeft, LoaderCircle, LogIn, UserPlus } from 'lucide-react'
import { apiFetch, logout, setToken } from '@/lib/api'

interface AccountStatus {
  needsSetup: boolean
  authenticated: boolean
  email: string | null
  role: 'admin' | 'user' | null
  googleEnabled: boolean
}

interface AuthResponse {
  token: string
  email: string
  role: 'admin' | 'user'
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')

export default function AccountPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [status, setStatus] = useState<AccountStatus | null>(null)
  const [registering, setRegistering] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    apiFetch<AccountStatus>('/api/auth/status')
      .then(setStatus)
      .catch(reason => setError(reason instanceof Error ? reason.message : String(reason)))

    const authError = searchParams.get('auth')
    if (authError === 'email_taken') setError('Bu email allaqachon ro‘yxatdan o‘tgan. Email va parol bilan kiring.')
    else if (authError === 'account_disabled') setError('Hisobingiz vaqtincha o‘chirilgan. Administrator bilan bog‘laning.')
    else if (authError === 'setup_required') setError('Avval administrator hisobini sozlash kerak.')
    else if (authError === 'google_error') setError('Google orqali kirib bo‘lmadi. Qayta urinib ko‘ring.')
  }, [searchParams])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const result = await apiFetch<AuthResponse>(registering ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })
      setToken(result.token)
      navigate(result.role === 'admin' ? '/admin' : '/chat', { replace: true })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(false)
    }
  }

  async function signOut() {
    await logout()
    setStatus(current => current ? { ...current, authenticated: false, email: null, role: null } : current)
    navigate('/chat', { replace: true })
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <section className="w-full max-w-md">
        <Link to="/chat" className="mb-6 inline-flex items-center gap-2 text-sm text-muted-foreground transition hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Zarnur chatiga qaytish
        </Link>

        <div className="rounded-3xl border bg-card p-6 shadow-sm sm:p-8">
          <h1 className="text-2xl font-semibold tracking-tight">Zarnur hisobi</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            Hisob ochib, administrator ulashgan AI modellaridan foydalaning. API kalitlari sizga ko‘rsatilmaydi.
          </p>

          {status?.authenticated ? (
            <div className="mt-6 space-y-4">
              <div className="rounded-xl border bg-background p-4">
                <p className="text-sm font-medium">{status.email}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {status.role === 'admin' ? 'Administrator' : 'Foydalanuvchi'}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  to={status.role === 'admin' ? '/admin' : '/chat'}
                  className="inline-flex min-h-10 items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90"
                >
                  {status.role === 'admin' ? 'Admin panelini ochish' : 'Chatni ochish'}
                </Link>
                <button
                  type="button"
                  onClick={() => void signOut()}
                  className="min-h-10 rounded-lg border px-4 text-sm transition hover:bg-muted"
                >
                  Chiqish
                </button>
              </div>
            </div>
          ) : (
            <>
              {status?.needsSetup && (
                <p className="mt-5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-foreground">
                  Foydalanuvchi ro‘yxatdan o‘tishidan oldin administrator sozlamani yakunlashi kerak.
                </p>
              )}
              <div className="mt-6 grid grid-cols-2 rounded-xl border bg-background p-1">
                <button
                  type="button"
                  onClick={() => { setRegistering(true); setError('') }}
                  aria-pressed={registering}
                  className={`min-h-10 rounded-lg px-3 text-sm transition ${registering ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Hisob ochish
                </button>
                <button
                  type="button"
                  onClick={() => { setRegistering(false); setError('') }}
                  aria-pressed={!registering}
                  className={`min-h-10 rounded-lg px-3 text-sm transition ${!registering ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                >
                  Kirish
                </button>
              </div>

              <form onSubmit={submit} className="mt-5 space-y-4">
                <label className="grid gap-1.5 text-sm font-medium">
                  Email
                  <input
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={event => setEmail(event.target.value)}
                    className="h-11 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
                <label className="grid gap-1.5 text-sm font-medium">
                  Parol
                  <input
                    type="password"
                    autoComplete={registering ? 'new-password' : 'current-password'}
                    minLength={registering ? 8 : undefined}
                    required
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                    className="h-11 rounded-lg border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </label>
                {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
                <button
                  type="submit"
                  disabled={busy || status?.needsSetup}
                  className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90 disabled:pointer-events-none disabled:opacity-50"
                >
                  {busy ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : registering ? <UserPlus className="size-4" aria-hidden="true" /> : <LogIn className="size-4" aria-hidden="true" />}
                  {registering ? 'Bepul hisob ochish' : 'Kirish'}
                </button>
              </form>

              {status?.googleEnabled && (
                <>
                  <div className="my-5 flex items-center gap-3 text-xs text-muted-foreground">
                    <span className="h-px flex-1 bg-border" />
                    yoki
                    <span className="h-px flex-1 bg-border" />
                  </div>
                  <a
                    href={`${BASE}/api/auth/google/start`}
                    className="inline-flex min-h-11 w-full items-center justify-center rounded-lg border bg-background px-4 text-sm font-medium transition hover:bg-muted"
                  >
                    Google orqali davom etish
                  </a>
                </>
              )}

              <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
                Bepul provayderlarning kvotalari cheklangan va o‘zgarishi mumkin. Administrator ulashgan kalitlardan
                foydalanish provayder limitlariga bog‘liq.
              </p>
            </>
          )}
        </div>
      </section>
    </main>
  )
}
