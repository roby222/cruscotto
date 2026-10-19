// Draws one sample per skin into docs/: `node docs/skins.ts` (Node 22.6+ strips the types).
import { writeFileSync } from 'node:fs'
import { INITIAL, SKINS, buildLampsSvg, buildSvg, settings } from '../hooks/dash.ts'

const h = 3_600_000
const now = 10 * h
const snap = {
  ...INITIAL,
  model: 'claude-fable-5-1', trip: 5_878_000,
  ctxPct: 21, ctxTokens: 212_000, ctxWindow: 1_000_000, compactPct: 95,
  limits: [
    { kind: 'five_hour', pct: 56, resetsAt: new Date(now + 2 * h + 18 * 60_000).toISOString() },
    { kind: 'seven_day', pct: 70, resetsAt: new Date(now + 3 * h + 38 * 60_000).toISOString() },
  ],
  burn: [{ t: now - h, pct: 44 }, { t: now, pct: 56 }],
  // a few lamps lit, to show them: cold cache, two tools and one agent running
  cacheHit: 0.3, toolsRunning: 2, agents: ['a1'],
  usd: 12.4,
}
const BG: Record<string, string> = { night: '#1b1c1e', amber: '#1a1408', paper: '#f4f2ec', mono: '#1b1c1e' }
for (const skin of Object.keys(SKINS)) {
  settings.skin = skin
  // A background and 12 px of padding, which the composer's panel gives the strip in the app.
  // The strip, then the lamps Svg below it on the left, where the host draws them beside the buttons.
  const raw = buildSvg(snap, now)
  const [, w, h] = raw.match(/viewBox="0 0 (\d+) (\d+)"/)!.map(Number)
  const body = raw.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
  const lampsBody = buildLampsSvg(snap, now).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
  // The buttons, which the host draws in the editor theme's colors: here in the skin's greys, right-aligned on the lamps' row.
  const t = SKINS[skin]
  let x = w
  let buttons = ''
  for (const label of ['⚙', 'Hurry up', 'Commit and push', 'Go ahead']) {
    const bw = label === '⚙' ? 16 : label.length * 4.4 + 14
    x -= bw
    buttons += `<rect x="${x}" y="9" width="${bw}" height="14" rx="3" fill="${t.track}"/>`
      + `<text x="${x + bw / 2}" y="19" font-family="-apple-system, Helvetica, Arial, sans-serif" font-size="8" font-weight="600" fill="${t.text}" text-anchor="middle">${label}</text>`
    x -= 8
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w + 24} ${h + 60}" width="${w + 24}" height="${h + 60}">`
    + `<rect width="100%" height="100%" rx="8" fill="${BG[skin]}"/><g transform="translate(12 12)">${body}</g>`
    + `<g transform="translate(12 ${h + 12})">${lampsBody}${buttons}</g></svg>`
  writeFileSync(new URL(`./skin-${skin}.svg`, import.meta.url), svg)
  console.log(skin, svg.length, 'bytes', svg.includes('spare') ? 'range ok' : 'range?')
}
