import { describe, expect, test } from 'claude-code/testing'

import { INITIAL, buildSvg, fitReasons, lamp, leftTone, limitLabel, millions, pushReading, range, rangeTone, pushSample, ratePerMin, rateMax, SKINS, settings, shortModel, tokensOf, untilReset } from './dash'

describe('dash helpers', () => {
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

  test('rateMax sceglie il fondo scala', () => {
    expect(rateMax(0)).toBe(10_000)
    expect(rateMax(90_000)).toBe(500_000)
    expect(rateMax(1e12)).toBe(20_000_000)
  })

  test('shortModel e millions', () => {
    expect(shortModel('claude-sonnet-5-5')).toBe('Sonnet 5.5')
    expect(shortModel('')).toBe('unknown model')
    expect(millions(12_345_678)).toBe('12.346')
  })

  test('untilReset', () => {
    expect(untilReset(undefined, 0)).toBe('--')
    expect(untilReset(new Date(90 * 60_000).toISOString(), 0)).toBe('1 h 30 min')
    expect(untilReset(new Date(5 * 3_600_000).toISOString(), 0)).toBe('5 h')
    expect(untilReset(new Date(3 * 86_400_000).toISOString(), 0)).toBe('3 d')
  })

  test('buildSvg produce un svg con i valori', () => {
    const svg = buildSvg(
      { ...INITIAL, total: 2_500_000, model: 'claude-opus-5-5', ctxPct: 42, limits: [{ kind: 'five_hour', pct: 30 }, { kind: 'seven_day', pct: 10 }, { kind: 'seven_day_fable', pct: 35 }] },
      0,
    )
    expect(svg.startsWith('<svg')).toBe(true)
    expect(svg.includes('Opus 5.5')).toBe(false) // the composer already names the model
    expect(svg.includes('Session 5 h')).toBe(true)
    expect(svg.includes('Range')).toBe(true)
    expect(svg.includes('Weekly Fable')).toBe(true)
  })

  test('limitLabel', () => {
    expect(limitLabel('five_hour')).toBe('Session 5 h')
    expect(limitLabel('seven_day')).toBe('Weekly')
    expect(limitLabel('seven_day_fable')).toBe('Weekly Fable')
    expect(limitLabel('spend_limit')).toBe('Spend')
    expect(limitLabel('something_else')).toBe('something else')
  })

  test('fitReasons taglia e conta', () => {
    expect(fitReasons([], 44)).toBe('')
    expect(fitReasons(['context high'], 44)).toBe('context high')
    expect(fitReasons(['context almost full', 'session 5 h limit almost used up', 'weekly limit running low'], 44)).toBe('context almost full, +2')
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
    // 5 punti in un'ora: al reset tra 2 h siamo all'80%, ne avanza il 20.
    burn = pushReading([], { t: now - h, pct: 65 })
    burn = pushReading(burn, { t: now, pct: 70 })
    expect(range({ ...INITIAL, limits, burn }, now)).toEqual({ status: 'lasts', spare: 20 })
    expect(lamp({ ...INITIAL, limits, burn }, now).tone).toBe('warn')
    // Dopo un reset la quota scende: nessuna proiezione, avanza quel che resta.
    burn = pushReading([], { t: now - h, pct: 80 })
    burn = pushReading(burn, { t: now, pct: 10 })
    expect(range({ ...INITIAL, limits, burn }, now)).toEqual({ status: 'lasts', spare: 90 })
  })

  test('la spia si accende per gradi', () => {
    expect(lamp({ ...INITIAL, ctxPct: 30, limits: [{ kind: 'five_hour', pct: 79 }] }, 0)).toEqual({ tone: 'ok', reasons: [], notes: [] })
    expect(lamp({ ...INITIAL, limits: [{ kind: 'five_hour', pct: 80 }] }, 0)).toEqual({ tone: 'warn', reasons: ['session 5 h limit running low'], notes: [] })
    expect(lamp({ ...INITIAL, limits: [{ kind: 'seven_day', pct: 95 }] }, 0)).toEqual({ tone: 'bad', reasons: ['weekly limit almost used up'], notes: [] })
    expect(lamp({ ...INITIAL, ctxPct: 78, limits: [{ kind: 'seven_day', pct: 85 }] }, 0)).toEqual({
      tone: 'bad',
      reasons: ['context almost full', 'weekly limit running low'], notes: [],
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

  test('la skin cambia i colori del quadro', () => {
    const night = buildSvg(INITIAL, 0)
    settings.skin = 'amber'
    const amber = buildSvg(INITIAL, 0)
    settings.skin = 'night'
    expect(night.includes(SKINS.night.text)).toBe(true)
    expect(amber.includes(SKINS.amber.text)).toBe(true)
    expect(amber.includes(SKINS.night.text)).toBe(false)
  })
})
