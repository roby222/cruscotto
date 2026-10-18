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
export const settings = { skin: 'night', warnAt: 20, badAt: 5 }
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
  if (r.status === 'runsOut') {
    issues.push(r.msToEmpty < 30 * 60 * 1000
      ? { tone: 'bad', text: 'session 5 h runs out within 30 min' }
      : { tone: 'warn', text: 'session 5 h runs out before reset' })
  }
  // The Range bar colors by its margin; the lamp agrees with it.
  if (r.status === 'lasts' && leftTone(r.spare) !== 'ok') issues.push({ tone: leftTone(r.spare), text: 'session 5 h tight at the reset' })
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

// Sagoma del motore come la spia di avaria ISO: blocco, presa d'aria, scarico, piede; 24 × 18.
// ISO check-engine outline, 26 x 18, drawn as a stroke like the lamp on a real cluster.
const ENGINE = 'M6 3.5V1.5Q6 1 6.5 1H8.5Q9 1 9 1.5V3.5H18.5Q19 3.5 19 4V6.5Q19 7 19.5 7H23.5Q24 7 24 7.5V10.5Q24 11 23.5 11H20.5Q20 11 20 11.5V14.5Q20 15 19.5 15H14.5Q14 15 14 15.5V16.5Q14 17 13.5 17H8.5Q8 17 8 16.5V15.5Q8 15 7.5 15H5.5Q5 15 5 14.5V11.5Q5 11 4.5 11H2.5Q2 11 2 10.5V8.5Q2 8 2.5 8H4.5Q5 8 5 7.5V4Q5 3.5 5.5 3.5Z'

const engineLamp = (x: number, y: number, tone: Tone): string => {
  const stroke = (color: string, width: number, opacity = 1): string =>
    `<path d="${ENGINE}" transform="translate(${x} ${y})" fill="none" stroke="${color}" stroke-width="${width}" stroke-opacity="${opacity}" stroke-linejoin="round" stroke-linecap="round"/>`
  if (tone === 'ok') return stroke(skin().lampOff, 1.6)
  // lit: a soft halo under the line
  return stroke(toneColor(tone), 5, 0.25) + stroke(toneColor(tone), 2)
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
  const { tone, notes } = lamp(snap, now)

  // Griglia 2 x 2: contesto e autonomia sopra, i limiti a due a due sotto.
  const r = range(snap, now)
  const rangeCell: Row = r.status === 'measuring'
    ? { name: 'Range', frac: null, tone: 'ok', value: 'measuring, needs 5 min of use' }
    : r.status === 'lasts'
      ? { name: 'Range', frac: r.spare / 100, tone: leftTone(r.spare), value: `at this pace, ${r.spare}% left at the reset` }
      : {
          name: 'Range',
          frac: r.msToReset ? clamp(r.msToEmpty / r.msToReset, 0, 1) : null,
          tone: r.msToEmpty < 30 * 60 * 1000 ? 'bad' : 'warn',
          value: `runs out in ${spanText(r.msToEmpty)}`,
        }
  const cells: Row[] = [
    {
      name: 'Context', frac: ctxFrac, tone: ctxTone, marker: compactAt,
      value: ctx != null ? `${Math.round(ctx)}%, ${compactTokens(snap.ctxTokens ?? 0)} of ${compactTokens(snap.ctxWindow ?? 0)}` : 'no data',
    },
    rangeCell,
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

  // Intestazione: spia e nota a sinistra; consumo a destra. Il modello lo mostra già il compositore.
  s += engineLamp(L, 5, tone)
  const shown = fitReasons(notes, 44)
  if (shown) s += text(L + 32, 20, shown, 12, toneColor(tone))
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
  const warn = reasons.length ? ` | ${reasons.join(', ')}` : ''
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
  ]
  if (snap.limits.length === 0) lines.push('rate-limit windows: none reported (off a subscription, or no response yet)')
  return lines.join('\n')
}
