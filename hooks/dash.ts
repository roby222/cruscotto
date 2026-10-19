import type { Limit, Reading, Sample, Snap } from '../types'

export const WINDOW_MS = 5 * 60 * 1000

export const INITIAL: Snap = {
  model: '',
  ctxPct: null,
  ctxTokens: null,
  ctxWindow: null,
  compactPct: null,
  limits: [],
  usd: null,
  trip: 0,
  turns: [],
  live: 0,
  samples: [],
  burn: [],
  cacheHit: null,
  lastSeconds: null,
  lastTools: 0,
  toolsRunning: 0,
  agents: [],
  hasError: false,
}

// Quadro notturno: traccia scura, riempimento avorio, ambra e rosso solo oltre soglia.
const AMBER = '#d9a441'
const RED = '#d96b5a'

type Skin = { text: string; muted: string; track: string; lampOff: string; ok: string; warn?: string; bad?: string }
/** The skins: night (the default, for dark themes), amber (one-color amber cluster), paper (for light themes), mono. */
export const SKINS: Record<string, Skin> = {
  night: { text: '#e6e4df', muted: '#8f8e8a', track: '#34363a', lampOff: '#3a3b40', ok: '#86b3a4' },
  // amber's healthy color is amber itself, so attention is a warm white and error a saturated red: the two must stand apart from the base.
  amber: { text: '#f0b84a', muted: '#a8864a', track: '#3a2e14', lampOff: '#4a3c1c', ok: '#f0b84a', warn: '#f6f3ea', bad: '#ff4538' },
  paper: { text: '#2a2a28', muted: '#6b6964', track: '#d9d6cf', lampOff: '#c4c1ba', ok: '#3f8f78' },
  mono: { text: '#e6e4df', muted: '#8f8e8a', track: '#34363a', lampOff: '#3a3b40', ok: '#bdbbb5' },
}

/** The userConfig values; `register` copies the plugin's options over these defaults. */
export const settings = { skin: 'night', warnAt: 20, badAt: 5, lamps: true, coldCacheBelow: 50 }
const skin = (): Skin => SKINS[settings.skin] ?? (SKINS.night as Skin)
const FONT = "'Segoe UI','Helvetica Neue',Arial,sans-serif"

export type Tone = 'ok' | 'warn' | 'bad'
const toneColor = (t: Tone): string => (t === 'ok' ? skin().ok : t === 'warn' ? skin().warn ?? AMBER : skin().bad ?? RED)
const RANK: Record<Tone, number> = { ok: 0, warn: 1, bad: 2 }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))
const f1 = (n: number) => n.toFixed(1)
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;')

export const tokensOf = (u: {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens: number
  cache_creation_input_tokens: number
}) => u.input_tokens + u.output_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens

/** The tokens a turn adds: input, output and cache writes. Cache reads are the context read again, not new work. */
export const freshOf = (u: { input_tokens: number; output_tokens: number; cache_creation_input_tokens: number }) =>
  u.input_tokens + u.output_tokens + u.cache_creation_input_tokens

export const pushSample = (samples: Sample[], s: Sample): Sample[] =>
  [...samples, s].filter(x => s.t - x.t <= WINDOW_MS)

/** Token al minuto sugli ultimi 5 minuti. */
export const ratePerMin = (samples: Sample[], now: number): number => {
  const live = samples.filter(x => x.t <= now && now - x.t <= WINDOW_MS)
  const sum = live.reduce((a, x) => a + x.tokens, 0)
  return sum / (WINDOW_MS / 60000)
}

export const millions = (tokens: number): string => (tokens / 1_000_000).toFixed(3)

export const compactTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : n >= 1000 ? `${Math.round(n / 1000)} k` : `${Math.round(n)}`

export const untilReset = (iso: string | undefined, now: number): string => {
  if (!iso) return '--'
  const ms = Date.parse(iso) - now
  if (!(ms > 0)) return 'now'
  const m = Math.round(ms / 60000)
  const parts = m >= 1440
    ? [`${Math.floor(m / 1440)} d`, Math.floor((m % 1440) / 60) ? `${Math.floor((m % 1440) / 60)} h` : '']
    : [m >= 60 ? `${Math.floor(m / 60)} h` : '', m % 60 ? `${m % 60} min` : '']
  return parts.filter(Boolean).join(' ') || 'now'
}

export const BURN_WINDOW_MS = 90 * 60 * 1000
export const BURN_MIN_SPAN_MS = 5 * 60 * 1000

export const pushReading = (burn: Reading[], r: Reading): Reading[] =>
  [...burn, r].filter(x => r.t - x.t <= BURN_WINDOW_MS)

export type Range =
  | { status: 'measuring' }
  | { status: 'lasts'; spare: number }
  | { status: 'runsOut'; msToEmpty: number; msToReset: number | null }

/** Autonomia della finestra 5 h: a questo ritmo, finisce prima del reset? */
export const range = (snap: Snap, now: number): Range => {
  const recent = snap.burn.filter(x => now - x.t <= BURN_WINDOW_MS)
  // A reading well under the one before it means the window reset: the pace starts over from there.
  // Ten points, so a small correction of a reading is not taken for a reset.
  const drop = recent.findLastIndex((x, i) => i > 0 && x.pct < (recent[i - 1]?.pct ?? x.pct) - 10)
  const live = drop > 0 ? recent.slice(drop) : recent
  if (live.length < 2) return { status: 'measuring' }
  const first = live[0] as Reading
  const last = live[live.length - 1] as Reading
  if (last.t - first.t < BURN_MIN_SPAN_MS) return { status: 'measuring' }
  const slope = (last.pct - first.pct) / (last.t - first.t)
  const five = snap.limits.find(l => l.kind === 'five_hour')
  const msToReset = five?.resetsAt ? Date.parse(five.resetsAt) - now : null
  // spare: the share of the window still unused when the reset comes, at this pace.
  if (slope <= 0) return { status: 'lasts', spare: Math.round(100 - last.pct) }
  const msToEmpty = ((100 - last.pct) / slope)
  if (msToReset != null && msToEmpty >= msToReset) {
    return { status: 'lasts', spare: Math.round(100 - last.pct - slope * msToReset) }
  }
  return { status: 'runsOut', msToEmpty, msToReset }
}

export const SOON_MS = 30 * 60 * 1000

/** The Range color, shared by its bar and the lamp: red if empty within 30 min, amber if empty 30 min or more before the reset. Reaching the reset is fine however little is left: the reset is the refill. */
export const rangeTone = (r: Range): Tone =>
  r.status !== 'runsOut' || (r.msToReset != null && r.msToReset - r.msToEmpty < SOON_MS)
    ? 'ok'
    : r.msToEmpty < SOON_MS ? 'bad' : 'warn'

const spanText = (ms: number): string => untilReset(new Date(ms).toISOString(), 0)

/** Soglie sulla quota rimasta: ambra al 20%, rossa al 5%. */

/** Nome di una finestra come nel pannello Usage: `five_hour`, `seven_day`, `seven_day_fable`... */
export const limitLabel = (kind: string): string => {
  const [head, rest] = kind.startsWith('five_hour') ? ['Session 5 h', kind.slice('five_hour'.length)]
    : kind.startsWith('seven_day') ? ['Weekly', kind.slice('seven_day'.length)]
    : kind === 'spend_limit' ? ['Spend', '']
    : [kind.replace(/_/g, ' '), '']
  const suffix = rest.replace(/^_/, '').replace(/_/g, ' ')
  return suffix ? `${head} ${suffix.charAt(0).toUpperCase()}${suffix.slice(1)}` : head
}

export const leftOf = (l: Limit): number => clamp(100 - l.pct, 0, 100)
export const leftTone = (left: number | null): Tone => (left == null ? 'ok' : left <= settings.badAt ? 'bad' : left <= settings.warnAt ? 'warn' : 'ok')

/** Spia e motivo: ambra quando una riserva scende, rossa in zona critica. */
/** Every issue as a short text, for the terminal line and the report; the worst tone with them. */
export const lamp = (snap: Snap, now: number): { tone: Tone; reasons: string[] } => {
  const issues: { tone: Tone; text: string }[] = []
  // No context issue until the engine has said where auto-compaction sits.
  if (snap.ctxPct != null && snap.compactPct != null) {
    const compactAt = snap.compactPct / 100
    const f = snap.ctxPct / 100
    if (f >= compactAt - 0.05) issues.push({ tone: 'bad', text: 'context almost full' })
    else if (f >= compactAt - 0.2) issues.push({ tone: 'warn', text: 'context high' })
  }
  for (const l of snap.limits) {
    const left = leftOf(l)
    const label = limitLabel(l.kind)
    const name = label.charAt(0).toLowerCase() + label.slice(1)
    if (left <= 0) issues.push({ tone: 'bad', text: `${name} limit used up` })
    else if (left <= settings.badAt) issues.push({ tone: 'bad', text: `${name} limit almost used up` })
    else if (left <= settings.warnAt) issues.push({ tone: 'warn', text: `${name} limit running low` })
  }
  const r = range(snap, now)
  const rt = rangeTone(r)
  if (rt !== 'ok') issues.push({ tone: rt, text: rt === 'bad' ? 'session 5 h runs out within 30 min' : 'session 5 h runs out well before reset' })
  if (snap.hasError) issues.push({ tone: 'bad', text: 'last turn failed' })

  issues.sort((a, b) => RANK[b.tone] - RANK[a.tone])
  const tone = issues[0]?.tone ?? 'ok'
  return { tone, reasons: issues.map(i => i.text) }
}

const text = (x: number, y: number, t: string, size: number, fill: string, anchor = 'start', weight = 400) =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" text-anchor="${anchor}" font-weight="${weight}" font-family="${FONT}" style="font-variant-numeric:tabular-nums">${esc(t)}</text>`

/** Barra sottile: traccia piena, riempimento in un colore solo, tacca opzionale. */
const bar = (x: number, y: number, w: number, frac: number | null, tone: Tone, marker?: number | null): string => {
  const h = 4
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="2" fill="${skin().track}"/>`
  if (frac != null && frac > 0) {
    s += `<rect x="${x}" y="${y}" width="${f1(Math.max(h, w * clamp(frac, 0, 1)))}" height="${h}" rx="2" fill="${toneColor(tone)}"/>`
  }
  if (marker != null) {
    const mx = x + clamp(marker, 0, 1) * w
    s += `<rect x="${f1(mx - 0.5)}" y="${y - 3}" width="1" height="${h + 6}" fill="${skin().muted}"/>`
  }
  return s
}

export type LampKey = 'failed' | 'cold' | 'tools' | 'agents'
export type Lamp = { key: LampKey; on: boolean; tone: Tone; count?: number; word: string }

/** The four lamps: one state each, none for what a bar or a counter already shows. */
export const lamps = (snap: Snap, _now: number): Lamp[] => {
  const cache = snap.cacheHit != null ? Math.round(snap.cacheHit * 100) : null
  return [
    { key: 'failed', on: snap.hasError, tone: 'bad', word: 'FAILED' },
    { key: 'cold', on: cache != null && cache < settings.coldCacheBelow, tone: 'warn', word: 'COLD' },
    { key: 'tools', on: snap.toolsRunning > 0, tone: 'ok', count: snap.toolsRunning, word: 'TOOLS' },
    { key: 'agents', on: snap.agents.length > 0, tone: 'ok', count: snap.agents.length, word: 'AGENTS' },
  ]
}

/** Lit lamps as words, for the terminal line and the report. */
export const lampWords = (list: Lamp[]): string[] =>
  list.filter(l => l.on).map(l => (l.count != null ? `${l.word} ${l.count}` : l.word))

// 14 x 14 glyphs, stroke based, designed with a render loop at 1x and 4x (docs/skins.ts draws them); COLOR is replaced when drawn.
const GLYPHS: Record<LampKey, string> = {
  failed:
    '<path d="M7 1.5 L13.25 12.5 H0.75 Z" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 6 V8" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="10.4" r="0.9" fill="COLOR"/>',
  cold:
    '<path d="M7 12.5 L7 1.5 M2.24 9.75 L11.76 4.25 M2.24 4.25 L11.76 9.75 M10.64 4.9 L10.64 3.7 M10.64 4.9 L11.68 5.5 M7 2.8 L5.96 2.2 M7 2.8 L8.04 2.2 M3.36 4.9 L2.32 5.5 M3.36 4.9 L3.36 3.7 M3.36 9.1 L3.36 10.3 M3.36 9.1 L2.32 8.5 M7 11.2 L8.04 11.8 M7 11.2 L5.96 11.8 M10.64 9.1 L11.68 8.5 M10.64 9.1 L10.64 10.3" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  tools:
    '<path d="M8.32 3.84 A0.6 0.6 0 0 0 8.32 4.69 L9.31 5.68 A0.6 0.6 0 0 0 10.16 5.68 L12.24 3.6 A3.4 3.4 0 0 1 7.8 8.04 L3.66 12.18 A1.3 1.3 0 0 1 1.82 10.34 L5.96 6.2 A3.4 3.4 0 0 1 10.4 1.76 Z" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  agents:
    '<circle cx="5" cy="3.75" r="2" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M1.25 12.5 V12 A3.75 3.75 0 0 1 8.75 12 V12.5" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.75 1.75 A2 2 0 0 1 9.75 5.75" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.75 12.5 V12 A3.75 3.75 0 0 0 9.97 8.38" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
}

/** Header blocks share one grammar: the value on the top line, a small caps label under it. */
const label = (x: number, y: number, t: string, color: string, anchor = 'start'): string => text(x, y, t, 7, color, anchor, 600)

const LAMP_PITCH = 32

/** The lamp row: one block per lamp, the glyph over its word, the count as a badge on the glyph's corner. */
const lampRow = (x: number, y: number, list: Lamp[]): string => {
  let s = ''
  list.forEach((l, i) => {
    // The first word, centred on its glyph, starts on the column edge rather than its glyph doing so.
    const cx = x + i * LAMP_PITCH + LAMP_PITCH / 2 - 4
    const color = l.on ? toneColor(l.tone) : skin().lampOff
    s += `<g transform="translate(${f1(cx - 7)} ${y})">${GLYPHS[l.key].replaceAll('COLOR', color)}</g>`
    if (l.on && l.count != null) s += text(cx + 9, y + 5, String(l.count), 8, color, 'start', 700)
    s += label(cx, y + 26, l.word, l.on ? toneColor(l.tone) : skin().muted, 'middle')
  })
  return s
}

/** Full scale of the rate meter: fresh tokens per minute, cache reads excluded. */
export const VU_FULL = 60_000
const VU_SEGMENTS = 10

/** Segments lit for a rate: 0 to VU_SEGMENTS. */
export const vuLit = (rate: number): number => Math.min(VU_SEGMENTS, Math.round((rate / VU_FULL) * VU_SEGMENTS))

/** A VU meter of the 5-minute token rate: ten segments, green then amber then red, and a peak-hold outline from the last 20 s. */
// While a turn runs, the engine gives the plugin no tokens, so the meter cannot measure: it shows the work
// instead, a wave of light running over the unlit segments (SVG animation, which the VS Code webview draws).
const WAVE = (i: number) => `<animate attributeName="fill-opacity" values="0;0.9;0" dur="1.6s" begin="${(i * 0.16).toFixed(2)}s" repeatCount="indefinite"/>`

const vuMeter = (x: number, y: number, snap: Snap, now: number, working: boolean): string => {
  const rate = ratePerMin(snap.samples, now)
  const lit = vuLit(rate)
  const peak = Math.max(...[0, 5, 10, 15, 20].map(sec => vuLit(ratePerMin(snap.samples, now - sec * 1000))))
  // A throughput meter, not an alarm: the strip's amber and red mean attention and stop, and a fast turn is neither.
  const color = (i: number) => (i < 8 ? skin().ok : skin().text)
  let s = '<g>'
  for (let i = 0; i < VU_SEGMENTS; i++) {
    const sx = x + i * 8
    if (i < lit) {
      s += `<rect x="${sx}" y="${y}" width="6" height="12" rx="1" fill="${color(i)}"/>`
      // over lit segments the wave runs dark, so a full meter still shows the work
      if (working) s += `<rect x="${sx}" y="${y}" width="6" height="12" rx="1" fill="${skin().track}" fill-opacity="0">${WAVE(i)}</rect>`
    } else if (i === peak - 1 && !working) s += `<rect x="${sx + 0.5}" y="${y + 0.5}" width="5" height="11" rx="1" fill="none" stroke="${color(i)}" stroke-width="1"/>`
    else {
      s += `<rect x="${sx}" y="${y}" width="6" height="12" rx="1" fill="${skin().track}"/>`
      if (working) s += `<rect x="${sx}" y="${y}" width="6" height="12" rx="1" fill="${color(i)}" fill-opacity="0">${WAVE(i)}</rect>`
    }
  }
  return s + '</g>'
}
const VU_W = VU_SEGMENTS * 8 - 2

/** A spectrum of the last eight turns: one column each, as tall as its tokens against the heaviest of the eight. */
const spectrum = (x: number, y: number, turns: number[] | undefined, live = 0): string => {
  // A session that loaded before these fields existed carries no turns yet. The turn in progress, if any,
  // is the last column, an outline that grows with the context as the turn goes on.
  const done = (turns ?? []).slice(live > 0 ? -7 : -8)
  const last = live > 0 ? [...done, live] : done
  const top = Math.max(1, ...last)
  let s = '<g>'
  for (let i = 0; i < 8; i++) {
    const t = last[i - (8 - last.length)]
    const h = t == null ? 1 : Math.max(1, Math.round((t / top) * 12))
    const isLive = live > 0 && i === 7
    s += isLive
      ? `<rect x="${x + i * 7 + 0.5}" y="${y + 12 - h + 0.5}" width="4" height="${Math.max(1, h - 1)}" rx="1" fill="none" stroke="${skin().ok}" stroke-width="1"><animate attributeName="stroke-opacity" values="1;0.3;1" dur="1.2s" repeatCount="indefinite"/></rect>`
      : `<rect x="${x + i * 7}" y="${y + 12 - h}" width="5" height="${h}" rx="1" fill="${t == null ? skin().track : skin().ok}"/>`
  }
  return s + '</g>'
}

type Row = { name: string; frac: number | null; tone: Tone; value: string; caption: string; marker?: number | null }

/** The strip; `working` while the engine says a turn is in progress, when the meters move instead of measuring. */
export const buildSvg = (snap: Snap, now: number, working = false): string => {
  const ctx = snap.ctxPct
  const compactAt = snap.compactPct != null ? snap.compactPct / 100 : 0.8
  const ctxFrac = ctx != null ? ctx / 100 : null
  // Until the engine has told where auto-compaction sits, no tick and no amber: a guess would mislead.
  const ctxTone: Tone = ctxFrac == null || snap.compactPct == null ? 'ok' : ctxFrac >= compactAt - 0.05 ? 'bad' : ctxFrac >= compactAt - 0.2 ? 'warn' : 'ok'

  // One grammar for every block: small caps label (static), one large live value, a short caption, the bar where there is one.
  const r = range(snap, now)
  const rangeCell: Row = r.status === 'measuring'
    ? { name: 'Range', frac: null, tone: 'ok', value: 'n/a', caption: 'measuring, 5 min of use' }
    : r.status === 'lasts'
      ? { name: 'Range', frac: null, tone: 'ok', value: `${r.spare}% spare`, caption: 'lasts to the reset' }
      : {
        name: 'Range', frac: null, tone: rangeTone(r), value: spanText(r.msToEmpty),
        // The number is the time to empty; the caption says what that costs: the wait for the reset after it.
        caption: r.msToReset != null ? `empty, then ${spanText(r.msToReset - r.msToEmpty)} wait` : 'runs out before reset',
      }
  const limits: Row[] = snap.limits.map((l): Row => {
    const left = leftOf(l)
    return { name: limitLabel(l.kind), frac: left / 100, tone: leftTone(left), value: `${Math.round(left)}% left`, caption: untilReset(l.resetsAt, now) === 'now' ? 'resets now' : `resets in ${untilReset(l.resetsAt, now)}` }
  })
  if (limits.length === 0) {
    limits.push({ name: 'Session 5 h', frac: null, tone: 'ok', value: 'n/a', caption: 'no data yet' }, { name: 'Weekly', frac: null, tone: 'ok', value: 'n/a', caption: 'no data yet' })
  }
  // Context first, then the 5 h window with its range verdict beside it, then the other windows.
  const cells: Row[] = [
    {
      name: 'Context', frac: ctxFrac, tone: ctxTone, marker: snap.compactPct != null ? compactAt : null,
      value: ctx != null ? `${Math.round(ctx)}%` : 'n/a',
      caption: ctx != null ? `${compactTokens(snap.ctxTokens ?? 0)} of ${compactTokens(snap.ctxWindow ?? 0)}` : 'no data yet',
    },
    limits[0] as Row,
    rangeCell,
    ...limits.slice(1),
  ]

  const W = STRIP_W
  const L = 0
  const GAP = 20
  // The right edge of everything drawn: the last tile ends one GAP before W, like every other.
  const R = W - GAP
  // Up to four tiles on a row; five or six go three by three, so no row holds one tile alone.
  const cols = cells.length <= 4 ? cells.length : 3
  // Columns are exact fractions of W; every tile ends one GAP before the next column starts.
  const COL = W / cols
  const ROW = 60
  const rows = Math.ceil(cells.length / cols)
  // The tiles, then a meter row: the rate VU meter and the spectrum of the last turns on the left, the
  // counters on the right. The lamps live in their own Svg (buildLampsSvg), drawn by the host on the buttons' row.
  const FOOT = 8 + rows * ROW
  // The image ends where the last tile does (R), so tiles, odometer and the host's button row share one right edge.
  const H = FOOT + 30
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${R} ${H}" width="${R}" height="${H}">`

  // Tiles: label on the row's top baseline, the live value 22 below, the caption 36 below, the bar at 44.
  const cell = (c: Row, x: number, y: number, w: number) => {
    s += text(x, y, c.name.toUpperCase(), 7, skin().muted, 'start', 600)
    s += text(x, y + 22, c.value, 18, c.tone === 'ok' ? skin().text : toneColor(c.tone), 'start', 700)
    s += text(x, y + 36, c.caption, 9, skin().muted)
    if (c.frac != null || c.marker != null) s += bar(x, y + 44, w, c.frac, c.tone, c.marker)
  }
  cells.forEach((c, i) => cell(c, L + (i % cols) * COL, 8 + ROW * Math.floor(i / cols), COL - GAP))

  // Meters share the tiles' grammar: small caps label on the row's baseline, the instrument under it.
  s += text(L, FOOT + 6, 'TOKENS / MIN', 7, skin().muted, 'start', 600)
  s += vuMeter(L, FOOT + 10, snap, now, working)
  s += text(L + VU_W + GAP, FOOT + 6, 'LAST TURNS', 7, skin().muted, 'start', 600)
  s += spectrum(L + VU_W + GAP, FOOT + 10, snap.turns, snap.live ?? 0)

  // One text run anchored at the right edge, so nothing can overlap: this session's tokens, then what they
  // would have cost on an API key, two labelled values in one color, on the meters' bottom line.
  s += `<text x="${R}" y="${FOOT + 21}" text-anchor="end" font-family="${FONT}" style="font-variant-numeric:tabular-nums">`
    + `<tspan font-size="7" font-weight="600" fill="${skin().muted}">TOKENS</tspan>`
    + `<tspan dx="3" font-size="11" font-weight="700" fill="${skin().text}">${esc(millions(snap.trip))} M</tspan>`
    + `<tspan dx="12" font-size="7" font-weight="600" fill="${skin().muted}">COST</tspan>`
    + `<tspan dx="3" font-size="11" font-weight="700" fill="${skin().text}">${esc(usdAll(snap))}</tspan></text>`

  s += `</svg>`
  return s
}

/** Width of the strip in viewBox units, and the lamps Svg's share of it: a Box of that width scales the lamps like the strip. */
export const STRIP_W = 560
export const LAMPS_W = 4 * LAMP_PITCH
// The image is STRIP_W minus one gap wide; the engine takes whole percentages only, so the scale is within 1%.
export const LAMPS_SHARE = `${Math.round((LAMPS_W / (STRIP_W - 20)) * 100)}%`

/** The lamp row alone, for the host's button row: no width or height attributes, so it fills its Box. */
export const buildLampsSvg = (snap: Snap, now: number): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LAMPS_W} 36">${lampRow(0, 2, lamps(snap, now))}</svg>`

/** This session's API-price value as a dollar figure. */
export const usdAll = (snap: Snap): string => `$${(snap.usd ?? 0).toFixed(2)}`

/** Riga di testo per la superficie senza Svg. */
export const buildLine = (snap: Snap, now: number): string => {
  const rate = ratePerMin(snap.samples, now)
  const ctx = snap.ctxPct != null ? `${Math.round(snap.ctxPct)}%` : '--'
  const limits = snap.limits.map(l => `${limitLabel(l.kind)} ${Math.round(leftOf(l))}% left`).join(' | ')
  const { reasons } = lamp(snap, now)
  const lit = settings.lamps ? lampWords(lamps(snap, now)) : []
  const warn = [...lit, ...reasons].length ? ` | ${[...lit, ...reasons].join(', ')}` : ''
  return `${compactTokens(rate)} tok/min | ctx ${ctx}${limits ? ' | ' + limits : ''} | session ${millions(snap.trip)}M ${usdAll(snap)}${warn}`
}

/** Le letture grezze, per confrontarle col pannello Usage. */
export const buildReport = (snap: Snap, now: number): string => {
  const lines = [
    `model: ${snap.model || '(no turn yet)'}`,
    `context: ${snap.ctxPct ?? '--'}% (${snap.ctxTokens ?? '--'} of ${snap.ctxWindow ?? '--'} tokens), compaction at ${snap.compactPct != null ? Math.round(snap.compactPct) + '%' : '--'}`,
    ...snap.limits.map(l => `${l.kind}: used ${l.pct}%, left ${Math.round(leftOf(l))}%, resets in ${untilReset(l.resetsAt, now)} (${l.resetsAt ?? '--'})`),
    `tokens this session: ${snap.trip} (${millions(snap.trip)} M)`,
    `rate: ${Math.round(ratePerMin(snap.samples, now))} fresh tokens/min over the last 5 minutes, cache reads excluded (meter full scale ${VU_FULL})`,
    `last turns: ${(snap.turns ?? []).join(', ') || 'none yet'}${snap.live ? `; in progress about ${Math.round(snap.live)}` : ''}`,
    `cost this session at API prices: ${snap.usd != null ? '$' + snap.usd.toFixed(4) : '--'}, cache ${snap.cacheHit != null ? Math.round(snap.cacheHit * 100) + '%' : '--'}`,
    `last turn: ${snap.lastSeconds ?? '--'} s, ${snap.lastTools} tools${snap.hasError ? ', ended in error' : ''}`,
    `lamps: ${lampWords(lamps(snap, now)).join(', ') || 'none lit'}; running now ${snap.toolsRunning} tools, ${snap.agents.length} agents`,
  ]
  if (snap.limits.length === 0) lines.push('rate-limit windows: none reported (off a subscription, or no response yet)')
  return lines.join('\n')
}
