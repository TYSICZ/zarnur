import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const playground = readFileSync(path.join(here, 'PlaygroundPage.tsx'), 'utf8')
const publicChat = readFileSync(path.join(here, 'PublicChatPage.tsx'), 'utf8')
const jewelry = readFileSync(path.join(here, 'JewelryLandingPage.tsx'), 'utf8')
const admin = readFileSync(path.join(here, 'ZarnurAdminPage.tsx'), 'utf8')
const support = readFileSync(path.join(here, '../components/ZarnurSupportChat.tsx'), 'utf8')
const app = readFileSync(path.join(here, '../App.tsx'), 'utf8')
const publicDir = path.join(here, '../../public')
const manifest = JSON.parse(readFileSync(path.join(publicDir, 'manifest.webmanifest'), 'utf8')) as {
  name: string
  short_name: string
  start_url: string
  scope: string
  display: string
  icons: { src: string; sizes: string; type: string; purpose: string }[]
}
const html = readFileSync(path.join(here, '../../index.html'), 'utf8')

describe('Zarnur assistant onboarding', () => {
  it('shows Zarnur in navigation and brands the shared chat', () => {
    expect(app).toContain("{ to: '/playground', labelKey: 'nav.playground', label: 'Zarnur' }")
    expect(app).toContain('item.label ?? t(item.labelKey)')
    expect(playground).toContain('aria-label="Zarnur AI"')
  })

  it('shows the jewelry storefront at the app entrance and starts the PWA there', () => {
    expect(app).toContain("if (location.pathname === '/')")
    expect(app).toContain('<JewelryLandingPage />')
    expect(manifest.start_url).toBe('./')
    expect(jewelry).toContain('by Bilol Shaykhuddinov')
    expect(jewelry).toContain('Har bir taqinchoqda')
    expect(jewelry).toContain('href="tel:+998909565605"')
    expect(jewelry).toContain('Zarnur AI chatini ochish')
    expect(jewelry).toContain('to="/chat"')
    expect(app).toContain('<PublicChatPage />')
    expect(app).toContain('<ZarnurSupportChat />')
    expect(publicChat).toContain('/api/public/chat/completions')
    expect(publicChat).toContain('window.isSecureContext')
    expect(publicChat).toContain('API kaliti shart emas')
    expect(publicChat).not.toContain('apiKey')
    expect(publicChat).toContain('Maxfiy ma’lumot yubormang.')
    expect(jewelry).toContain('zarnur-qollanma.pdf')
    expect(support).toContain('/api/public/support/messages')
    expect(admin).toContain('/api/support/overview')
    expect(existsSync(path.join(publicDir, 'zarnur-qollanma.pdf'))).toBe(true)
    for (const image of ['ring.svg', 'earrings.svg', 'necklace.svg', 'bracelet.svg']) {
      expect(existsSync(path.join(publicDir, 'jewelry', image))).toBe(true)
    }
  })

  it('shows the contact number in the chat header as a tap-to-call link', () => {
    expect(playground).toContain('href="tel:+998909565605"')
    expect(playground).toContain('Murojaat uchun')
    expect(playground).toContain('+99890 956 56 05')
  })

  it('directs users without configured models to provider keys', () => {
    expect(playground).toContain('{availableModels.length === 0 ? (')
    expect(playground).toContain('<Link')
    expect(playground).toContain('to="/keys"')
    expect(playground).toContain("{t('playground.noModels')}")
  })

  it('provides standalone install metadata and icons for iOS and Android', () => {
    expect(manifest.name).toBe('Zarnur AI')
    expect(manifest.short_name).toBe('Zarnur')
    expect(manifest.start_url).toBe('./')
    expect(manifest.scope).toBe('./')
    expect(manifest.display).toBe('standalone')
    expect(manifest.icons.map(icon => icon.sizes)).toEqual(['192x192', '512x512'])
    expect(manifest.icons.every(icon => icon.type === 'image/png' && icon.purpose === 'any maskable')).toBe(true)
    const iconPaths = manifest.icons.map(icon => path.join(publicDir, icon.src.slice(2)))
    expect(iconPaths.every(existsSync)).toBe(true)
    expect(existsSync(path.join(publicDir, 'zarnur-icon-180.png'))).toBe(true)
    expect(html).toContain('rel="manifest"')
    expect(html).toContain('apple-mobile-web-app-capable')
    expect(html).toContain('apple-touch-icon')
  })
})
