// Draws one sample per skin into docs/: `node docs/skins.ts` (Node 22.6+ strips the types).
import { writeFileSync } from 'node:fs'
import { INITIAL, SKINS, buildSvg, settings } from '../hooks/dash.ts'

const h = 3_600_000
const now = 10 * h
const snap = {
  ...INITIAL,
  model: 'claude-fable-5-1', total: 5_878_000,
  ctxPct: 21, ctxTokens: 212_000, ctxWindow: 1_000_000, compactPct: 95,
  limits: [
    { kind: 'five_hour', pct: 56, resetsAt: new Date(now + 2 * h + 18 * 60_000).toISOString() },
    { kind: 'seven_day', pct: 70, resetsAt: new Date(now + 3 * h + 38 * 60_000).toISOString() },
  ],
  burn: [{ t: now - h, pct: 44 }, { t: now, pct: 56 }],
  // a few lamps lit, to show them: cold cache, two tools and one agent running
  cacheHit: 0.3, toolsRunning: 2, agentsRunning: 1,
}
const BG: Record<string, string> = { night: '#1b1c1e', amber: '#1a1408', paper: '#f4f2ec', mono: '#1b1c1e' }
for (const skin of Object.keys(SKINS)) {
  settings.skin = skin
  // A background and 12 px of padding, which the composer's panel gives the strip in the app.
  const raw = buildSvg(snap, now)
  const [, w, h] = raw.match(/viewBox="0 0 (\d+) (\d+)"/)!.map(Number)
  const body = raw.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w + 24} ${h + 24}" width="${w + 24}" height="${h + 24}">`
    + `<rect width="100%" height="100%" rx="8" fill="${BG[skin]}"/><g transform="translate(12 12)">${body}</g></svg>`
  writeFileSync(new URL(`./skin-${skin}.svg`, import.meta.url), svg)
  console.log(skin, svg.length, 'bytes', svg.includes('spare') ? 'range ok' : 'range?')
}
