import { ArrowRight, Gem, Phone, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'

const jewelryTypes = [
  { title: 'Uzuklar', detail: 'Har bir lahzaga mos nafis tanlov', image: 'jewelry/ring.svg' },
  { title: 'Sirg‘alar', detail: 'Obrazingizga nozik jilo qo‘shing', image: 'jewelry/earrings.svg' },
  { title: 'Zanjirlar', detail: 'Sodda va didli bezaklar', image: 'jewelry/necklace.svg' },
  { title: 'Bilaguzuklar', detail: 'Uslubingizni yakunlovchi detal', image: 'jewelry/bracelet.svg' },
]

export default function JewelryLandingPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-5 sm:px-6 sm:pt-8">
      <div className="mb-5 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <span aria-hidden="true" />
        <p className="text-center text-[10px] font-medium tracking-[0.16em] text-muted-foreground sm:text-xs sm:tracking-[0.22em]">
          by Bilol Shaykhuddinov
        </p>
        <a
          href="tel:+998909565605"
          className="flex flex-col items-end text-right leading-tight hover:text-primary"
        >
          <span className="text-[9px] text-muted-foreground">Murojaat uchun</span>
          <span className="text-[10px] font-medium sm:text-xs">+99890 956 56 05</span>
        </a>
      </div>

      <section className="relative isolate overflow-hidden rounded-[2rem] border border-amber-900/20 bg-gradient-to-br from-stone-950 via-stone-900 to-zinc-950 text-white shadow-xl">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-24 -top-32 size-96 rounded-full bg-amber-300/10 blur-3xl"
        />
        <div className="relative grid gap-8 p-6 sm:p-10 lg:grid-cols-[1.05fr_.95fr] lg:items-center lg:p-14">
          <div className="relative z-10">
            <span className="inline-flex items-center gap-2 rounded-full border border-amber-200/20 bg-amber-100/5 px-3 py-1.5 text-[10px] font-medium tracking-[0.2em] text-amber-200">
              <Sparkles className="size-3.5" aria-hidden="true" />
              ZARGARLIK MAHORATI
            </span>
            <h1 className="mt-5 max-w-xl text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              Har bir taqinchoqda —{' '}
              <span className="text-amber-300">
                o‘zgacha nafislik
              </span>
            </h1>
            <p className="mt-4 max-w-lg text-sm leading-relaxed text-stone-300 sm:text-base">
              Zargarlik buyumlarini mahorat bilan yasaymiz va sotamiz. Did va
              kundalik uslubingizga mos nafis taqinchoqni tanlang.
            </p>
            <div className="mt-7 flex flex-wrap items-center gap-3">
              <a
                href="tel:+998909565605"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-amber-200 to-yellow-500 px-4 py-2.5 text-sm font-semibold text-stone-950 shadow-lg shadow-amber-900/20 transition hover:brightness-105"
              >
                <Phone className="size-4" aria-hidden="true" />
                Murojaat uchun
              </a>
              <a
                href="#taqinchoqlar"
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/15 px-4 py-2.5 text-sm font-medium text-stone-100 transition hover:border-amber-200/40 hover:bg-white/5"
              >
                Taqinchoqlarni ko‘rish
                <ArrowRight className="size-4" aria-hidden="true" />
              </a>
            </div>
            <p className="mt-3 text-xs font-medium tracking-wide text-amber-100/80">
              +99890 956 56 05
            </p>
          </div>

          <div className="relative mx-auto flex aspect-square w-full max-w-[22rem] items-center justify-center">
            <div aria-hidden="true" className="absolute size-[88%] rounded-full border border-amber-200/15" />
            <div aria-hidden="true" className="absolute size-[70%] rotate-12 rounded-[2.5rem] border border-amber-100/20" />
            <div
              aria-hidden="true"
              className="absolute size-[58%] rounded-full bg-amber-300/10 blur-2xl"
            />
            <div className="relative flex size-36 items-center justify-center rounded-[2rem] border border-amber-100/25 bg-gradient-to-br from-amber-100/20 to-amber-400/5 shadow-[0_20px_80px_rgba(217,160,63,0.16)] backdrop-blur sm:size-44">
              <Gem className="size-20 text-amber-200 drop-shadow-[0_0_20px_rgba(252,211,77,0.35)] sm:size-24" strokeWidth={1} aria-hidden="true" />
            </div>
            <div className="absolute bottom-[13%] right-0 rounded-2xl border border-white/10 bg-black/35 px-4 py-3 backdrop-blur">
              <p className="text-[9px] tracking-[0.2em] text-amber-200">NAFIS TANLOV</p>
              <p className="mt-1 text-xs text-stone-100">Did bilan yaratilgan</p>
            </div>
          </div>
        </div>
      </section>

      <section id="taqinchoqlar" className="py-12 sm:py-16">
        <div className="mb-6 flex flex-col gap-2 sm:mb-8">
          <p className="text-[10px] font-semibold tracking-[0.22em] text-amber-700 dark:text-amber-300">
            ZARGARLIK BUYUMLARI
          </p>
          <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
            Nafislik — mayda detallarda
          </h2>
          <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
            O‘zingizga yoki yaqin insoningizga mos taqinchoqni tanlang. Buyumlar
            va xarid bo‘yicha ma’lumot olish uchun biz bilan bog‘laning.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {jewelryTypes.map(({ title, detail, image }) => (
            <article
              key={title}
              className="group overflow-hidden rounded-2xl border bg-card shadow-sm transition hover:-translate-y-0.5 hover:border-amber-500/40 hover:shadow-md"
            >
              <img
                src={`${import.meta.env.BASE_URL}${image}`}
                alt={`Zarnur — ${title.toLowerCase()}`}
                className="aspect-[8/5] w-full object-cover transition duration-500 group-hover:scale-[1.03]"
                loading="lazy"
                decoding="async"
              />
              <div className="p-5">
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{detail}</p>
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="mb-8 flex flex-col gap-5 rounded-3xl border border-amber-300/20 bg-gradient-to-br from-stone-950 via-stone-900 to-zinc-950 p-6 text-white shadow-lg sm:flex-row sm:items-center sm:justify-between sm:p-8">
        <div>
          <p className="text-[10px] font-semibold tracking-[0.22em] text-amber-200">ZARNUR AI</p>
          <h2 className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
            Savolingiz bormi? Zarnur bilan suhbatni boshlang.
          </h2>
          <p className="mt-2 max-w-xl text-sm text-stone-300">
            Bepul AI yordamchi. Savol yozing — API kaliti shart emas.
          </p>
        </div>
        <Link
          to="/chat"
          className="inline-flex min-h-14 shrink-0 items-center justify-center gap-3 rounded-xl bg-gradient-to-r from-amber-200 to-yellow-500 px-6 py-3 text-base font-semibold text-stone-950 shadow-lg shadow-amber-950/20 transition hover:brightness-105 sm:text-lg"
        >
          Zarnur AI chatini ochish
          <ArrowRight className="size-5" aria-hidden="true" />
        </Link>
        <a
          href={`${import.meta.env.BASE_URL}zarnur-qollanma.pdf`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-100/25 px-4 py-2 text-sm font-medium text-amber-100 transition hover:bg-white/5"
        >
          Ixtiyoriy API qo‘llanma (PDF)
        </a>
      </section>

      <section className="flex flex-col gap-4 rounded-2xl border border-amber-500/20 bg-gradient-to-r from-amber-500/10 via-card to-card p-5 sm:flex-row sm:items-center sm:justify-between sm:p-7">
        <div>
          <p className="font-semibold">Taqinchoqlar haqida ma’lumot kerakmi?</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Murojaat uchun: +99890 956 56 05
          </p>
        </div>
        <a
          href="tel:+998909565605"
          className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg border px-3.5 py-2 text-sm font-medium transition hover:border-amber-500/50 hover:bg-amber-500/5"
        >
          Bog‘lanish
          <ArrowRight className="size-4" aria-hidden="true" />
        </a>
      </section>

      <footer className="mt-8 flex justify-end">
        <Link
          to="/admin"
          className="min-h-10 rounded-lg px-3 py-2 text-xs text-muted-foreground underline-offset-4 transition hover:text-foreground hover:underline"
        >
          Admin kirish
        </Link>
      </footer>
    </div>
  )
}
