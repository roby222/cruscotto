import { describe, expect, test } from 'claude-code/testing'

import { INITIAL, buildLampsSvg, buildLine, buildSvg, freshOf, lamp, vuLit, lampWords, lamps, leftTone, limitLabel, millions, pushReading, range, rangeTone, pushSample, ratePerMin, SKINS, settings, tokensOf, untilReset } from './dash'

describe('dash helpers', () => {
  test('freshOf lascia fuori le letture dalla cache', () => {
    expect(freshOf({ input_tokens: 1, output_tokens: 2, cache_creation_input_tokens: 4 })).toBe(7)
  })

  test('tokensOf somma i quattro conteggi', () => {
    expect(
      tokensOf({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }),
    ).toBe(10)
  })

  test('ratePerMin usa la finestra di 5 minuti', () => {
    const now = 10 * 60_000
    let s = pushSample([], { t: now - 6 * 60_000, tokens: 999_999 })
    s = pushSample(s, { t: now - 60_000, tokens: 500_000 })
    s = pushSample(s, { t: now, tokens: 500_000 })
    expect(ratePerMin(s, now)).toBe(200_000)
  })

  test('millions', () => {
    expect(millions(12_345_678)).toBe('12.346')
  })

  test('untilReset', () => {
    expect(untilReset(undefined, 0)).toBe('--')
    expect(untilReset(new Date(90 * 60_000).toISOString(), 0)).toBe('1 h 30 min')
    expect(untilReset(new Date(5 * 3_600_000).toISOString(), 0)).toBe('5 h')
    expect(untilReset(new Date(3 * 86_400_000).toISOString(), 0)).toBe('3 d')
    expect(untilReset(new Date(10_000).toISOString(), 0)).toBe('now') // under half a minute, and past
    expect(untilReset(new Date(0).toISOString(), 60_000)).toBe('now')
  })

  test('buildSvg produce un svg con i valori', () => {
    const svg = buildSvg(
      { ...INITIAL, trip: 2_500_000, model: 'claude-opus-5-5', ctxPct: 42, limits: [{ kind: 'five_hour', pct: 30 }, { kind: 'seven_day', pct: 10 }, { kind: 'seven_day_fable', pct: 35 }] },
      0,
    )
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.includes('Opus 5.5')).toBe(false) // the composer already names the model
    expect(svg.includes('SESSION 5 H')).toBe(true)
    expect(svg.includes('Range')).toBe(false) // range is a sentence in the header, not a gauge
    expect(svg.includes('WEEKLY FABLE')).toBe(true)
  })

  test('limitLabel', () => {
    expect(limitLabel('five_hour')).toBe('Session 5 h')
    expect(limitLabel('seven_day')).toBe('Weekly')
    expect(limitLabel('seven_day_fable')).toBe('Weekly Fable')
    expect(limitLabel('spend_limit')).toBe('Spend')
    expect(limitLabel('something_else')).toBe('something else')
  })

  test('range proietta il consumo della finestra 5 h', () => {
    const h = 3_600_000
    const now = 10 * h
    const reset = new Date(now + 2 * h).toISOString()
    const limits = [{ kind: 'five_hour', pct: 70, resetsAt: reset }]
    expect(range({ ...INITIAL, limits, burn: [{ t: now, pct: 70 }] }, now)).toEqual({ status: 'measuring' })
    // 20 punti in un'ora: i 30 rimasti durano 1 h 30, il reset è tra 2 h.
    let burn = pushReading([], { t: now - h, pct: 50 })
    burn = pushReading(burn, { t: now, pct: 70 })
    expect(range({ ...INITIAL, limits, burn }, now)).toEqual({ status: 'runsOut', msToEmpty: 1.5 * h, msToReset: 2 * h })
    expect(rangeTone({ status: 'runsOut', msToEmpty: 1.5 * h, msToReset: 2 * h })).toBe('warn')
    // Nove minuti prima del reset non sono un allarme; entro 30 minuti da adesso sì.
    expect(rangeTone({ status: 'runsOut', msToEmpty: 117 * 60_000, msToReset: 126 * 60_000 })).toBe('ok')
    expect(rangeTone({ status: 'runsOut', msToEmpty: 20 * 60_000, msToReset: 126 * 60_000 })).toBe('bad')
    expect(rangeTone({ status: 'runsOut', msToEmpty: 20 * 60_000, msToReset: 25 * 60_000 })).toBe('ok') // empties 5 min before the refill: fine
    // a reset inside the 90 minutes restarts the pace from the drop
    const afterReset = { ...INITIAL, limits: [{ kind: 'five_hour', pct: 40, resetsAt: new Date(now + 4 * h).toISOString() }],
      burn: [{ t: now - 80 * 60_000, pct: 80 }, { t: now - 70 * 60_000, pct: 10 }, { t: now, pct: 40 }] }
    expect(range(afterReset, now).status).toBe('runsOut')
    // 5 punti in un'ora: al reset tra 2 h siamo all'80%, ne avanza il 20.
    burn = pushReading([], { t: now - h, pct: 65 })
    burn = pushReading(burn, { t: now, pct: 70 })
    expect(range({ ...INITIAL, limits, burn }, now)).toEqual({ status: 'lasts', spare: 20 })
    expect(buildSvg({ ...INITIAL, limits, burn }, now).includes('20% spare')).toBe(true)
    expect(lamp({ ...INITIAL, limits, burn }, now).tone).toBe('ok') // reaching the reset is fine, whatever is left
    // Dopo un reset la quota scende: la lettura prima del reset non conta, si ricomincia a misurare.
    burn = pushReading([], { t: now - h, pct: 80 })
    burn = pushReading(burn, { t: now, pct: 10 })
    expect(range({ ...INITIAL, limits, burn }, now)).toEqual({ status: 'measuring' })
  })

  test('la spia si accende per gradi', () => {
    expect(lamp({ ...INITIAL, ctxPct: 30, limits: [{ kind: 'five_hour', pct: 79 }] }, 0)).toEqual({ tone: 'ok', reasons: [] })
    expect(lamp({ ...INITIAL, limits: [{ kind: 'five_hour', pct: 80 }] }, 0)).toEqual({ tone: 'warn', reasons: ['session 5 h limit running low'] })
    expect(lamp({ ...INITIAL, limits: [{ kind: 'seven_day', pct: 95 }] }, 0)).toEqual({ tone: 'bad', reasons: ['weekly limit almost used up'] })
    expect(lamp({ ...INITIAL, ctxPct: 78, limits: [{ kind: 'seven_day', pct: 85 }] }, 0)).toEqual({
      tone: 'bad',
      reasons: ['context almost full', 'weekly limit running low'],
    })
  })

  test('le soglie seguono le impostazioni', () => {
    expect(leftTone(15)).toBe('warn')
    Object.assign(settings, { warnAt: 50, badAt: 10 })
    expect(leftTone(15)).toBe('warn')
    expect(leftTone(8)).toBe('bad')
    expect(leftTone(60)).toBe('ok')
    Object.assign(settings, { warnAt: 20, badAt: 5 })
  })

  test('VU meter e spettro degli ultimi turni', () => {
    const now = 10 * 3_600_000
    expect(vuLit(0)).toBe(0)
    expect(vuLit(30_000)).toBe(5)
    expect(vuLit(900_000)).toBe(10)
    const hot = { ...INITIAL, samples: [{ t: now - 60_000, tokens: 500_000 }], turns: [1_000, 48_000, 12_000] }
    const svg = buildSvg(hot, now)
    expect(svg.includes('TOKENS / MIN')).toBe(true)
    expect(svg.includes('LAST TURNS')).toBe(true)
    expect(buildSvg({ ...hot, live: 7_000 }, now).includes('stroke-opacity')).toBe(true) // the in-progress column pulses; it exists only during a turn
    // the meter moves only while a turn runs
    expect(buildSvg(hot, now).includes('<animate')).toBe(false)
    expect(buildSvg(hot, now, true).includes('<animate')).toBe(true)
  })

  test('la skin cambia i colori del quadro', () => {
    const night = buildSvg(INITIAL, 0)
    settings.skin = 'amber'
    const amber = buildSvg(INITIAL, 0)
    settings.skin = 'night'
    expect(night.includes(SKINS.night.text)).toBe(true)
    expect(amber.includes(SKINS.amber.text)).toBe(true)
    expect(amber.includes(SKINS.night.text)).toBe(false)
  })

  test('le spie: uno stato ciascuna, soglie dalle impostazioni', () => {
    const now = 10 * 3_600_000
    const quiet = { ...INITIAL, cacheHit: 0.9, usd: 2 }
    expect(lampWords(lamps(quiet, now))).toEqual([])
    const busy = { ...quiet, hasError: true, toolsRunning: 3, agents: ['a1'], cacheHit: 0.2, usd: 12 }
    expect(lampWords(lamps(busy, now))).toEqual(['FAILED', 'COLD', 'TOOLS 3', 'AGENTS 1'])
    expect(lamps(busy, now).find(l => l.key === 'tools')?.count).toBe(3)
    // cold threshold follows the setting
    Object.assign(settings, { coldCacheBelow: 10 })
    expect(lampWords(lamps(busy, now))).toEqual(['FAILED', 'TOOLS 3', 'AGENTS 1'])
    Object.assign(settings, { coldCacheBelow: 50 })
    // the odometer shows this session's API value
    expect(buildSvg(busy, now).includes('$12.00')).toBe(true)
    // the terminal line and the lamps svg carry the words
    expect(buildLine(busy, now).includes('TOOLS 3')).toBe(true)
    expect(buildLampsSvg(busy, now).includes('TOOLS')).toBe(true)
  })
})
