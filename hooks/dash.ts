import type { Limit, Reading, Sample, Snap } from '../types'

export const WINDOW_MS = 5 * 60 * 1000
export const RATE_STEPS = [10_000, 50_000, 100_000, 500_000, 1_000_000, 5_000_000, 20_000_000]

export const INITIAL: Snap = {
  model: '',
  ctxPct: null,
  ctxTokens: null,
  ctxWindow: null,
  compactPct: null,
  limits: [],
  usd: null,
  total: 0,
  trip: 0,
  samples: [],
  burn: [],
  cacheHit: null,
  lastSeconds: null,
  lastTools: 0,
  toolsRunning: 0,
  agents: [],
  hasError: false,
  isHidden: false,
}

// Quadro notturno: traccia scura, riempimento avorio, ambra e rosso solo oltre soglia.
const AMBER = '#d9a441'
const RED = '#d96b5a'

type Skin = { text: string; muted: string; track: string; lampOff: string; ok: string; warn?: string; bad?: string }
/** The skins: night (the default, for dark themes), amber (one-color nineties cluster), paper (for light themes), mono. */
export const SKINS: Record<string, Skin> = {
  night: { text: '#e6e4df', muted: '#8f8e8a', track: '#34363a', lampOff: '#3a3b40', ok: '#86b3a4' },
  // amber's healthy color is amber itself, so attention is a warm white and error a saturated red: the two must stand apart from the base.
  amber: { text: '#f0b84a', muted: '#a8864a', track: '#3a2e14', lampOff: '#4a3c1c', ok: '#f0b84a', warn: '#f6f3ea', bad: '#ff4538' },
  paper: { text: '#2a2a28', muted: '#6b6964', track: '#d9d6cf', lampOff: '#c4c1ba', ok: '#3f8f78' },
  mono: { text: '#e6e4df', muted: '#8f8e8a', track: '#34363a', lampOff: '#3a3b40', ok: '#bdbbb5' },
}

/** The userConfig values; `register` copies the plugin's options over these defaults. */
export const settings = { skin: 'night', warnAt: 20, badAt: 5, lamps: true, costAlertUsd: 10, coldCacheBelow: 50, turboAt: 200000 }
const skin = (): Skin => SKINS[settings.skin] ?? SKINS.night
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

export const pushSample = (samples: Sample[], s: Sample): Sample[] =>
  [...samples, s].filter(x => s.t - x.t <= WINDOW_MS)

/** Token al minuto sugli ultimi 5 minuti. */
export const ratePerMin = (samples: Sample[], now: number): number => {
  const live = samples.filter(x => now - x.t <= WINDOW_MS)
  const sum = live.reduce((a, x) => a + x.tokens, 0)
  return sum / (WINDOW_MS / 60000)
}

export const rateMax = (rate: number): number =>
  RATE_STEPS.find(s => s >= rate * 1.15) ?? RATE_STEPS[RATE_STEPS.length - 1]

export const shortModel = (id: string): string => {
  const m = /claude-([a-z]+)-(\d+)(?:-(\d+))?/.exec(id)
  if (!m) return id ? id.slice(0, 16) : 'unknown model'
  const name = m[1][0].toUpperCase() + m[1].slice(1)
  return `${name} ${m[2]}${m[3] ? '.' + m[3] : ''}`
}

export const millions = (tokens: number): string => (tokens / 1_000_000).toFixed(3)

export const compactTokens = (n: number): string =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)} M` : n >= 1000 ? `${Math.round(n / 1000)} k` : `${Math.round(n)}`

export const untilReset = (iso: string | undefined, now: number): string => {
  if (!iso) return '--'
  const ms = Date.parse(iso) - now
  if (!(ms > 0)) return '0 min'
  const m = Math.round(ms / 60000)
  const parts = m >= 1440
    ? [`${Math.floor(m / 1440)} d`, Math.floor((m % 1440) / 60) ? `${Math.floor((m % 1440) / 60)} h` : '']
    : [m >= 60 ? `${Math.floor(m / 60)} h` : '', m % 60 ? `${m % 60} min` : '']
  return parts.filter(Boolean).join(' ') || '0 min'
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
  const live = snap.burn.filter(x => now - x.t <= BURN_WINDOW_MS)
  if (live.length < 2) return { status: 'measuring' }
  const first = live[0]
  const last = live[live.length - 1]
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
  r.status === 'runsOut'
    ? r.msToEmpty < SOON_MS ? 'bad' : r.msToReset != null && r.msToReset - r.msToEmpty >= SOON_MS ? 'warn' : 'ok'
    : 'ok'

const spanText = (ms: number): string => untilReset(new Date(ms).toISOString(), 0)

/** Soglie sulla quota rimasta: ambra al 20%, rossa al 5%. */

/** Nome di una finestra come nel pannello Usage: `five_hour`, `seven_day`, `seven_day_fable`... */
export const limitLabel = (kind: string): string => {
  const [head, rest] = kind.startsWith('five_hour') ? ['Session 5 h', kind.slice('five_hour'.length)]
    : kind.startsWith('seven_day') ? ['Weekly', kind.slice('seven_day'.length)]
    : kind === 'spend_limit' ? ['Spend', '']
    : [kind.replace(/_/g, ' '), '']
  const suffix = rest.replace(/^_/, '').replace(/_/g, ' ')
  return suffix ? `${head} ${suffix[0].toUpperCase()}${suffix.slice(1)}` : head
}

export const leftOf = (l: Limit): number => clamp(100 - l.pct, 0, 100)
export const leftTone = (left: number | null): Tone => (left == null ? 'ok' : left <= settings.badAt ? 'bad' : left <= settings.warnAt ? 'warn' : 'ok')

/** Spia e motivo: ambra quando una riserva scende, rossa in zona critica. */
/** Every issue as a short text, for the terminal line and the report; the worst tone with them. */
export const lamp = (snap: Snap, now: number): { tone: Tone; reasons: string[] } => {
  const issues: { tone: Tone; text: string }[] = []
  const compactAt = snap.compactPct != null ? snap.compactPct / 100 : 0.8

  if (snap.ctxPct != null) {
    const f = snap.ctxPct / 100
    if (f >= compactAt - 0.05) issues.push({ tone: 'bad', text: 'context almost full' })
    else if (f >= compactAt - 0.2) issues.push({ tone: 'warn', text: 'context high' })
  }
  for (const l of snap.limits) {
    const left = leftOf(l)
    const label = limitLabel(l.kind)
    const name = label[0].toLowerCase() + label.slice(1)
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

export type LampKey = 'failed' | 'cost' | 'cold' | 'tools' | 'agents' | 'turbo'
export type Lamp = { key: LampKey; on: boolean; tone: Tone; count?: number; word: string; title: string }

/** The six lamps: one state each, none for what a bar already shows. */
export const lamps = (snap: Snap, now: number): Lamp[] => {
  const rate = ratePerMin(snap.samples, now)
  const cache = snap.cacheHit != null ? Math.round(snap.cacheHit * 100) : null
  return [
    { key: 'failed', on: snap.hasError, tone: 'bad', word: 'FAILED', title: snap.hasError ? 'The last turn ended in error' : 'Lights red when a turn ends in error' },
    {
      key: 'cost', on: settings.costAlertUsd > 0 && snap.usd != null && snap.usd >= settings.costAlertUsd, tone: 'warn', word: 'COST',
      title: `Session cost ${snap.usd != null ? '$' + snap.usd.toFixed(2) : 'unknown'}; lights amber at $${settings.costAlertUsd}`,
    },
    {
      key: 'cold', on: cache != null && cache < settings.coldCacheBelow, tone: 'warn', word: 'COLD',
      title: `Cache hit ${cache != null ? cache + '%' : 'unknown'} on the last turn; lights amber under ${settings.coldCacheBelow}%`,
    },
    { key: 'tools', on: snap.toolsRunning > 0, tone: 'ok', count: snap.toolsRunning, word: 'TOOLS', title: `${snap.toolsRunning} tool call${snap.toolsRunning === 1 ? '' : 's'} running` },
    { key: 'agents', on: snap.agents.length > 0, tone: 'ok', count: snap.agents.length, word: 'AGENTS', title: `${snap.agents.length} subagent${snap.agents.length === 1 ? '' : 's'} running` },
    {
      key: 'turbo', on: settings.turboAt > 0 && rate >= settings.turboAt, tone: 'ok', word: 'TURBO',
      title: `${compactTokens(rate)} tokens/min over the last 5 minutes; lights at ${compactTokens(settings.turboAt)}`,
    },
  ]
}

/** Lit lamps as words, for the terminal line and the report. */
export const lampWords = (list: Lamp[]): string[] =>
  list.filter(l => l.on).map(l => (l.count != null ? `${l.word} ${l.count}` : l.word))

// 14 x 14 glyphs, stroke based, designed with a render loop at 1x and 4x (docs/skins.ts draws them); COLOR is replaced when drawn.
const GLYPHS: Record<LampKey, string> = {
  failed:
    '<path d="M7 1.5 L13.25 12.5 H0.75 Z" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M7 6 V8" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="10.4" r="0.9" fill="COLOR"/>',
  cost:
    '<path d="M2.75 3.5 H11.25 Q12.5 3.5 12.5 4.75 V9.25 Q12.5 10.5 11.25 10.5 H2.75 Q1.5 10.5 1.5 9.25 V4.75 Q1.5 3.5 2.75 3.5 Z" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="7" cy="7" r="1.25" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 6.5 V7.5 M10.5 6.5 V7.5" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  cold:
    '<path d="M7 12.5 L7 1.5 M2.24 9.75 L11.76 4.25 M2.24 4.25 L11.76 9.75 M10.64 4.9 L10.64 3.7 M10.64 4.9 L11.68 5.5 M7 2.8 L5.96 2.2 M7 2.8 L8.04 2.2 M3.36 4.9 L2.32 5.5 M3.36 4.9 L3.36 3.7 M3.36 9.1 L3.36 10.3 M3.36 9.1 L2.32 8.5 M7 11.2 L8.04 11.8 M7 11.2 L5.96 11.8 M10.64 9.1 L11.68 8.5 M10.64 9.1 L10.64 10.3" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  tools:
    '<path d="M8.32 3.84 A0.6 0.6 0 0 0 8.32 4.69 L9.31 5.68 A0.6 0.6 0 0 0 10.16 5.68 L12.24 3.6 A3.4 3.4 0 0 1 7.8 8.04 L3.66 12.18 A1.3 1.3 0 0 1 1.82 10.34 L5.96 6.2 A3.4 3.4 0 0 1 10.4 1.76 Z" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  agents:
    '<circle cx="5" cy="3.75" r="2" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M1.25 12.5 V12 A3.75 3.75 0 0 1 8.75 12 V12.5" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M9.75 1.75 A2 2 0 0 1 9.75 5.75" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M12.75 12.5 V12 A3.75 3.75 0 0 0 9.97 8.38" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
  turbo:
    '<path d="M9.5 1.25 L2 8.5 H6.25 L4.5 12.75 L12 5.5 H7.75 Z" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>',
}

/** Header blocks share one grammar: the value on the top line, a small caps label under it. */
const label = (x: number, y: number, t: string, color: string, anchor = 'start'): string => text(x, y, t, 7, color, anchor, 600)

const LAMP_PITCH = 32

/** The lamp row: one block per lamp, the glyph over its word, the count as a badge on the glyph's corner, a tooltip. */
const lampRow = (x: number, y: number, list: Lamp[]): { svg: string; width: number } => {
  let s = ''
  list.forEach((l, i) => {
    // The first word, centred on its glyph, starts on the column edge rather than its glyph doing so.
    const cx = x + i * LAMP_PITCH + LAMP_PITCH / 2 - 4
    const color = l.on ? toneColor(l.tone) : skin().lampOff
    s += `<g transform="translate(${f1(cx - 7)} ${y})"><title>${esc(l.title)}</title>${GLYPHS[l.key].replaceAll('COLOR', color)}</g>`
    if (l.on && l.count != null) s += text(cx + 9, y + 5, String(l.count), 8, color, 'start', 700)
    s += label(cx, y + 26, l.word, l.on ? toneColor(l.tone) : skin().muted, 'middle')
  })
  return { svg: s, width: list.length * LAMP_PITCH }
}

type Row = { name: string; frac: number | null; tone: Tone; value: string; caption: string; marker?: number | null }

export const buildSvg = (snap: Snap, now: number): string => {
  const ctx = snap.ctxPct
  const compactAt = snap.compactPct != null ? snap.compactPct / 100 : 0.8
  const ctxFrac = ctx != null ? ctx / 100 : null
  const ctxTone: Tone = ctxFrac == null ? 'ok' : ctxFrac >= compactAt - 0.05 ? 'bad' : ctxFrac >= compactAt - 0.2 ? 'warn' : 'ok'

  // One grammar for every block: small caps label (static), one large live value, a short caption, the bar where there is one.
  const r = range(snap, now)
  const rangeCell: Row = r.status === 'measuring'
    ? { name: 'Range', frac: null, tone: 'ok', value: 'n/a', caption: 'measuring, 5 min of use' }
    : r.status === 'lasts'
      ? { name: 'Range', frac: null, tone: 'ok', value: `${r.spare}% spare`, caption: 'lasts to the reset' }
      : { name: 'Range', frac: null, tone: rangeTone(r), value: spanText(r.msToEmpty), caption: 'runs out before reset' }
  const limits: Row[] = snap.limits.map((l): Row => {
    const left = leftOf(l)
    return { name: limitLabel(l.kind), frac: left / 100, tone: leftTone(left), value: `${Math.round(left)}% left`, caption: `resets in ${untilReset(l.resetsAt, now)}` }
  })
  if (limits.length === 0) {
    limits.push({ name: 'Session 5 h', frac: null, tone: 'ok', value: 'n/a', caption: 'no data yet' }, { name: 'Weekly', frac: null, tone: 'ok', value: 'n/a', caption: 'no data yet' })
  }
  // Context first, then the 5 h window with its range verdict beside it, then the other windows.
  const cells: Row[] = [
    {
      name: 'Context', frac: ctxFrac, tone: ctxTone, marker: compactAt,
      value: ctx != null ? `${Math.round(ctx)}%` : 'n/a',
      caption: ctx != null ? `${compactTokens(snap.ctxTokens ?? 0)} of ${compactTokens(snap.ctxWindow ?? 0)}` : 'no data yet',
    },
    limits[0],
    rangeCell,
    ...limits.slice(1),
  ]

  const W = 560
  const L = 0
  const GAP = 20
  // The right edge of everything drawn: the last tile ends one GAP before W, like every other.
  const R = W - GAP
  // Up to four tiles on a row; five or six go three by three, so no row holds one tile alone.
  const cols = cells.length <= 4 ? cells.length : 3
  // Columns are exact fractions of W, so the host's button cells (width 100/cols %) start where the tiles do.
  const COL = W / cols
  const ROW = 60
  const rows = Math.ceil(cells.length / cols)
  // Three rows, three weights: the gauges first and largest, the quiet status footer (lamps left, odometer right)
  // under them at label size, the host's buttons below. Rows are one GAP apart.
  const FOOT = 12 + rows * ROW
  const H = FOOT + 38
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`

  // Tiles: label on the row's top baseline, the live value 22 below, the caption 36 below, the bar at 44.
  const cell = (c: Row, x: number, y: number, w: number) => {
    s += text(x, y, c.name.toUpperCase(), 7, skin().muted, 'start', 600)
    s += text(x, y + 22, c.value, 18, c.tone === 'ok' ? skin().text : toneColor(c.tone), 'start', 700)
    s += text(x, y + 36, c.caption, 9, skin().muted)
    if (c.frac != null || c.marker != null) s += bar(x, y + 44, w, c.frac, c.tone, c.marker)
  }
  cells.forEach((c, i) => cell(c, L + (i % cols) * COL, 8 + ROW * Math.floor(i / cols), COL - GAP))

  // Footer: glyphs on FOOT, words 26 below; the odometer sits on the words' baseline, value in text, unit muted.
  if (settings.lamps) s += lampRow(L, FOOT, lamps(snap, now)).svg
  // One text run anchored at the right edge: the label can never overlap the value, whatever its width.
  s += `<text x="${R}" y="${FOOT + 26}" text-anchor="end" font-family="${FONT}" style="font-variant-numeric:tabular-nums">`
    + `<tspan font-size="7" font-weight="600" fill="${skin().muted}">TOKENS, ALL SESSIONS  </tspan>`
    + `<tspan font-size="11" font-weight="700" fill="${skin().text}">${esc(millions(snap.total))} M</tspan></text>`

  s += `</svg>`
  return s
}

/** Riga di testo per la superficie senza Svg. */
export const buildLine = (snap: Snap, now: number): string => {
  const rate = ratePerMin(snap.samples, now)
  const ctx = snap.ctxPct != null ? `${Math.round(snap.ctxPct)}%` : '--'
  const limits = snap.limits.map(l => `${limitLabel(l.kind)} ${Math.round(leftOf(l))}% left`).join(' | ')
  const { reasons } = lamp(snap, now)
  const lit = settings.lamps ? lampWords(lamps(snap, now)) : []
  const warn = [...lit, ...reasons].length ? ` | ${[...lit, ...reasons].join(', ')}` : ''
  return `${compactTokens(rate)} tok/min | ctx ${ctx}${limits ? ' | ' + limits : ''} | total ${millions(snap.total)}M${warn}`
}

/** Le letture grezze, per confrontarle col pannello Usage. */
export const buildReport = (snap: Snap, now: number): string => {
  const lines = [
    `model: ${snap.model || '(no turn yet)'}`,
    `context: ${snap.ctxPct ?? '--'}% (${snap.ctxTokens ?? '--'} of ${snap.ctxWindow ?? '--'} tokens), compaction at ${snap.compactPct != null ? Math.round(snap.compactPct) + '%' : '--'}`,
    ...snap.limits.map(l => `${l.kind}: used ${l.pct}%, left ${Math.round(leftOf(l))}%, resets in ${untilReset(l.resetsAt, now)} (${l.resetsAt ?? '--'})`),
    `tokens: ${snap.total} (${millions(snap.total)} M), this session ${snap.trip}`,
    `rate: ${Math.round(ratePerMin(snap.samples, now))} tokens/min over the last 5 minutes`,
    `cost: ${snap.usd != null ? '$' + snap.usd.toFixed(4) : '--'}, cache ${snap.cacheHit != null ? Math.round(snap.cacheHit * 100) + '%' : '--'}`,
    `last turn: ${snap.lastSeconds ?? '--'} s, ${snap.lastTools} tools${snap.hasError ? ', ended in error' : ''}`,
    `lamps: ${lampWords(lamps(snap, now)).join(', ') || 'none lit'}; running now ${snap.toolsRunning} tools, ${snap.agents.length} agents`,
  ]
  if (snap.limits.length === 0) lines.push('rate-limit windows: none reported (off a subscription, or no response yet)')
  return lines.join('\n')
}
