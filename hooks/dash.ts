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
  agentsRunning: 0,
  hasError: false,
  isHidden: false,
}

// Quadro notturno: traccia scura, riempimento avorio, ambra e rosso solo oltre soglia.
const AMBER = '#d9a441'
const RED = '#d96b5a'

type Skin = { text: string; muted: string; track: string; lampOff: string; ok: string; warn?: string }
/** The skins: night (the default, for dark themes), amber (one-color nineties cluster), paper (for light themes), mono. */
export const SKINS: Record<string, Skin> = {
  night: { text: '#e6e4df', muted: '#8f8e8a', track: '#34363a', lampOff: '#3a3b40', ok: '#86b3a4' },
  // amber's healthy color is amber itself, so its warning is orange.
  amber: { text: '#f0b84a', muted: '#9a7a3a', track: '#3a2e14', lampOff: '#4a3c1c', ok: '#f0b84a', warn: '#ff8a2b' },
  paper: { text: '#2a2a28', muted: '#7a7873', track: '#d9d6cf', lampOff: '#c4c1ba', ok: '#3f8f78' },
  mono: { text: '#e6e4df', muted: '#8f8e8a', track: '#34363a', lampOff: '#3a3b40', ok: '#bdbbb5' },
}

/** The userConfig values; `register` copies the plugin's options over these defaults. */
export const settings = { skin: 'night', warnAt: 20, badAt: 5, lamps: true, costAlertUsd: 10, coldCacheBelow: 50, turboAt: 200000 }
const skin = (): Skin => SKINS[settings.skin] ?? SKINS.night
const FONT = "'Segoe UI','Helvetica Neue',Arial,sans-serif"

export type Tone = 'ok' | 'warn' | 'bad'
const toneColor = (t: Tone): string => (t === 'ok' ? skin().ok : t === 'warn' ? skin().warn ?? AMBER : RED)
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
/** `reasons` is every issue; `notes` only those no gauge already shows, for the header. */
export const lamp = (snap: Snap, now: number): { tone: Tone; reasons: string[]; notes: string[] } => {
  const issues: { tone: Tone; text: string; onBar?: boolean }[] = []
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
  if (snap.hasError) issues.push({ tone: 'bad', text: 'last turn failed', onBar: false })

  issues.sort((a, b) => RANK[b.tone] - RANK[a.tone])
  const tone = issues[0]?.tone ?? 'ok'
  return { tone, reasons: issues.map(i => i.text), notes: issues.filter(i => i.onBar === false).map(i => i.text) }
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
    { key: 'agents', on: snap.agentsRunning > 0, tone: 'ok', count: snap.agentsRunning, word: 'AGENTS', title: `${snap.agentsRunning} subagent${snap.agentsRunning === 1 ? '' : 's'} running` },
    {
      key: 'turbo', on: settings.turboAt > 0 && rate >= settings.turboAt, tone: 'ok', word: 'TURBO',
      title: `${compactTokens(rate)} tokens/min over the last 5 minutes; lights at ${compactTokens(settings.turboAt)}`,
    },
  ]
}

/** Lit lamps as words, for the terminal line and the report. */
export const lampWords = (list: Lamp[]): string[] =>
  list.filter(l => l.on).map(l => (l.count != null ? `${l.word} ${l.count}` : l.word))

// 14 x 14 glyphs, stroke based; COLOR is replaced when drawn. Placeholders until the designed set lands.
const GLYPHS: Record<LampKey, string> = {
  failed: '<path d="M7 1.5L13 12.5H1Z" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linejoin="round"/><path d="M7 5.5V8.5" stroke="COLOR" stroke-width="1.5" stroke-linecap="round"/><circle cx="7" cy="10.5" r="0.9" fill="COLOR"/>',
  cost: '<circle cx="7" cy="7" r="5.5" fill="none" stroke="COLOR" stroke-width="1.5"/><path d="M7 4V10" stroke="COLOR" stroke-width="1.5" stroke-linecap="round"/>',
  cold: '<path d="M7 1.5V12.5M2.2 4.2L11.8 9.8M2.2 9.8L11.8 4.2" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round"/>',
  tools: '<path d="M9.5 1.5A3.5 3.5 0 0 0 5.6 6.4L1.5 10.5L3.5 12.5L7.6 8.4A3.5 3.5 0 0 0 12.5 4.5L10.5 6.5L8.5 5.5L7.5 3.5Z" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linejoin="round"/>',
  agents: '<circle cx="5" cy="5" r="2.5" fill="none" stroke="COLOR" stroke-width="1.5"/><circle cx="10" cy="6" r="2" fill="none" stroke="COLOR" stroke-width="1.5"/><path d="M1 12.5A4 4 0 0 1 9 12.5M9.5 12.5A3 3 0 0 1 13.5 10.5" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linecap="round"/>',
  turbo: '<path d="M8 1L2.5 8H7L6 13L11.5 6H7Z" fill="none" stroke="COLOR" stroke-width="1.5" stroke-linejoin="round"/>',
}

/** The lamp row: glyph, count beside it when it has one, a tooltip; returns the markup and the width used. */
const lampRow = (x: number, y: number, list: Lamp[]): { svg: string; width: number } => {
  let s = ''
  let cx = x
  for (const l of list) {
    const color = l.on ? toneColor(l.tone) : skin().lampOff
    s += `<g transform="translate(${cx} ${y})"><title>${esc(l.title)}</title>${GLYPHS[l.key].replaceAll('COLOR', color)}</g>`
    cx += 14
    if (l.on && l.count != null) {
      s += text(cx + 2, y + 13, String(l.count), 10, color, 'start', 600)
      cx += 4 + 6 * String(l.count).length
    }
    cx += 6
  }
  return { svg: s, width: cx - x }
}

/** I motivi che stanno in `max` caratteri, poi il conto di quelli lasciati fuori. */
export const fitReasons = (reasons: string[], max: number): string => {
  const kept: string[] = []
  for (const r of reasons) {
    const next = [...kept, r].join(', ')
    if (next.length > max) break
    kept.push(r)
  }
  const rest = reasons.length - kept.length
  if (kept.length === 0) return rest ? `${rest} warnings` : ''
  return rest ? `${kept.join(', ')}, +${rest}` : kept.join(', ')
}

type Row = { name: string; frac: number | null; tone: Tone; value: string; marker?: number | null }

export const buildSvg = (snap: Snap, now: number): string => {
  const ctx = snap.ctxPct
  const compactAt = snap.compactPct != null ? snap.compactPct / 100 : 0.8
  const ctxFrac = ctx != null ? ctx / 100 : null
  const ctxTone: Tone = ctxFrac == null ? 'ok' : ctxFrac >= compactAt - 0.05 ? 'bad' : ctxFrac >= compactAt - 0.2 ? 'warn' : 'ok'

  // Griglia 2 x 2: contesto e autonomia sopra, i limiti a due a due sotto.
  const r = range(snap, now)
  // Range is a verdict, not a quantity: one sentence in the header, no bar.
  const rangeText = r.status === 'measuring' ? ''
    : r.status === 'lasts' ? `5 h window lasts to the reset, ${r.spare}% spare`
    : `5 h window runs out in ${spanText(r.msToEmpty)}`
  const rangeColor = r.status === 'runsOut' && rangeTone(r) !== 'ok' ? toneColor(rangeTone(r)) : skin().muted
  const cells: Row[] = [
    {
      name: 'Context', frac: ctxFrac, tone: ctxTone, marker: compactAt,
      value: ctx != null ? `${Math.round(ctx)}%, ${compactTokens(snap.ctxTokens ?? 0)} of ${compactTokens(snap.ctxWindow ?? 0)}` : 'no data',
    },
  ]
  const limits: Row[] = snap.limits.map((l): Row => {
    const left = leftOf(l)
    return {
      name: limitLabel(l.kind), frac: left / 100, tone: leftTone(left),
      value: `${Math.round(left)}% left, resets in ${untilReset(l.resetsAt, now)}`,
    }
  })
  if (limits.length === 0) {
    limits.push({ name: 'Session 5 h', frac: null, tone: 'ok', value: 'no data yet' }, { name: 'Weekly', frac: null, tone: 'ok', value: 'no data yet' })
  }
  cells.push(...limits)

  const W = 560
  const L = 0
  const R = W
  const GAP = 24
  const COL = (R - L - GAP) / 2
  const ROW = 28
  const lines = Math.ceil(cells.length / 2)
  const H = 32 + lines * ROW
  let s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">`

  // Intestazione: fila di spie e frase del range a sinistra; consumo a destra. Il modello lo mostra già il compositore.
  let textX = L
  if (settings.lamps) {
    const row = lampRow(L, 4, lamps(snap, now))
    s += row.svg
    textX = L + row.width + 8
  }
  if (rangeText) s += text(textX, 20, rangeText, 12, rangeColor)
  s += text(R, 20, `${millions(snap.total)} M tokens`, 16, skin().ok, 'end', 600)

  const cell = (r: Row, x: number, y: number, w: number) => {
    s += text(x, y, r.name, 12, skin().muted)
    s += text(x + w, y, r.value, 12, skin().text, 'end')
    s += bar(x, y + 7, w, r.frac, r.tone, r.marker)
  }
  cells.forEach((r, i) => cell(r, L + (i % 2) * (COL + GAP), 44 + ROW * Math.floor(i / 2), COL))

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
    `lamps: ${lampWords(lamps(snap, now)).join(', ') || 'none lit'}; running now ${snap.toolsRunning} tools, ${snap.agentsRunning} agents`,
  ]
  if (snap.limits.length === 0) lines.push('rate-limit windows: none reported (off a subscription, or no response yet)')
  return lines.join('\n')
}
