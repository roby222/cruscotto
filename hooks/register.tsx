import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Snap } from '../types'
import { ACTIONS, parseButtons } from './actions'
import type { Action } from './actions'
import { INITIAL, LAMPS_SHARE, buildLampsSvg, buildLine, buildReport, buildSvg, lampWords, lamps, freshOf, pushReading, pushSample, settings, tokensOf } from './dash'

const snapAtom = atom({ plugin: 'cruscotto', key: 'snap' } as const, INITIAL)

export const register: Register = (on, options) => {
  Object.assign(settings, options)
  let tools = 0
  // True from the person's prompt to its turn.complete: only then does context growth belong to a turn in progress.
  let turning = false
  let ticking = false
  // The person's own buttons, re-read at each prompt: edits land at the next prompt, not on every redraw.
  let extra: Action[] = []
  const buttonsFile = typeof options.buttonsFile === 'string' ? options.buttonsFile : ''

  on('session.start', async ($, e, next) => {
    await update($, snapAtom, (s: Snap) => ({ ...s, toolsRunning: 0, agents: [] }))
    await $.command.register({ name: 'cruscotto', description: 'Raw cruscotto readings, to compare with the Usage panel' })
    if (buttonsFile) extra = parseButtons(await $.fs.read(buttonsFile).catch(() => ''))
    // "resets in", the range and the rate meter move with the clock, not with a state write; 5 s keeps the meter alive.
    if (!ticking) {
      ticking = true
      $.clock.every(5_000, () => $.ui.invalidate('ui.render'))
    }

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const id = e.agentId
    if (id) await update($, snapAtom, (s: Snap) => ({ ...s, agents: s.agents.includes(id) ? s.agents : [...s.agents, id] }))
    else turning = true

    return next(e)
  })

  on('command.run', { command: 'cruscotto' }, async $ => {
    const snap = await read($, snapAtom)

    return { text: buildReport(snap, await $.clock.now()) }
  })

  on('prompt.submit', async ($, e, next) => {
    tools = 0
    turning = true
    await update($, snapAtom, (s: Snap) => ({ ...s, toolsRunning: 0, live: 0 }))
    if (buttonsFile) extra = parseButtons(await $.fs.read(buttonsFile).catch(() => ''))

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    // A subagent's tools raise their own tool.call; the AGENTS lamp covers those.
    if (e.agentId) return next(e)
    tools += 1
    await update($, snapAtom, (s: Snap) => ({ ...s, toolsRunning: s.toolsRunning + 1 }))
    try {
      return await next(e)
    } finally {
      await update($, snapAtom, (s: Snap) => ({ ...s, toolsRunning: Math.max(0, s.toolsRunning - 1) }))
    }
  })

  on('session.measure', async ($, e, next) => {
    const now = await $.clock.now()
    const five = e.rateLimits.find(r => r.kind === 'five_hour')

    // Mid-turn, each model call grows the context: that growth is a live sample for the rate meter and the
    // spectrum's last column, replaced by the exact usage when the turn completes.
    await update($, snapAtom, (s: Snap) => {
      const grown = turning && e.context.tokens != null && s.ctxTokens != null ? e.context.tokens - s.ctxTokens : 0
      return {
      ...s,
      samples: grown > 0 ? pushSample(s.samples, { t: now, tokens: grown, live: true }) : s.samples,
      live: grown > 0 ? (s.live ?? 0) + grown : s.live ?? 0,
      ctxPct: e.context.percent ?? s.ctxPct,
      ctxTokens: e.context.tokens ?? s.ctxTokens,
      ctxWindow: e.context.window,
      limits: e.rateLimits.map(r => ({ kind: r.kind, pct: r.percentUsed, resetsAt: r.resetsAt })),
      burn: five ? pushReading(s.burn, { t: now, pct: five.percentUsed }) : s.burn,
      usd: e.cost?.usd ?? s.usd,
      }
    })

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    const used = e.usage ? tokensOf(e.usage) : 0
    const fresh = e.usage ? freshOf(e.usage) : 0
    if (!e.agentId) turning = false

    // A subagent's turn: it leaves the AGENTS lamp and its tokens count, nothing else is the person's turn.
    if (e.agentId) {
      const id = e.agentId
      await update($, snapAtom, (s: Snap) => ({ ...s, trip: s.trip + used, samples: fresh > 0 ? pushSample(s.samples, { t: now, tokens: fresh }) : s.samples, agents: s.agents.filter(a => a !== id) }))

      return next(e)
    }
    const input = e.usage
      ? e.usage.input_tokens + e.usage.cache_read_input_tokens + e.usage.cache_creation_input_tokens
      : 0
    let compactPct: number | null = null

    try {
      const { context } = await $.session.usage({ breakdown: 'summary' })
      const b = context.breakdown

      if (b?.autoCompactThreshold != null && b.rawMaxTokens > 0) {
        compactPct = (b.autoCompactThreshold / b.rawMaxTokens) * 100
      }
    } catch {
      compactPct = null
    }

    await update($, snapAtom, (s: Snap) => {
      // The live estimates of this turn give way to its real usage.
      const settled = s.samples.filter(x => !x.live)
      const samples = fresh > 0 ? pushSample(settled, { t: now, tokens: fresh }) : settled

      return {
        ...s,
        model: e.usage?.model ?? s.model,
        trip: s.trip + used,
        turns: used > 0 ? [...(s.turns ?? []), used].slice(-8) : s.turns ?? [],
        live: 0,
        samples,
        cacheHit: e.usage && input > 0 ? e.usage.cache_read_input_tokens / input : s.cacheHit,
        lastSeconds: Math.round(e.durationMs / 1000),
        lastTools: tools,
        hasError: e.reason === 'error' || e.reason === 'refusal',
        compactPct: compactPct ?? s.compactPct,
      }
    })

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    // Mods below in the chain draw first: whoever has something to show gets the band, and cruscotto
    // takes it back when they are done. With nothing below, next(e) is the engine's own empty band.
    const below = await next(e)
    const theirs = (below as { type?: string } | null)?.type !== 'engine'
    const snap = await read($, snapAtom)
    if (theirs || e.props.hasSurvey || snap.isHidden) return below

    const now = await $.clock.now()
    const { Box, Button, Text } = $.ui.resolve(e)
    const buttons = [...(options.buttons === false ? [] : ACTIONS), ...extra].map(a => (
      <Button key={a.key} label={a.label} hotkey={a.hotkey || undefined} plain onPress={() => void $.prompt.submit({ text: a.text, asUser: true })} />
    ))
    // The gear opens the engine's own settings menu, where this plugin's options live.
    const settingsButton = (
      <Button
        key="settings"
        label="⚙"
        plain
        onPress={() => void $.command.run({ command: 'config' }).catch(() => $.ui.toast('Type /config to change the cruscotto settings'))}
      />
    )
    // VS Code paints Buttons in its theme colors whatever the props (only key, label and dimColor reach
    // it). The row is one compact group at the right edge, the gear last; the host's own padding frames it.
    const buttonGroup = (
      <Box flexDirection="row" flexGrow={1} justifyContent="flex-end" gap={1}>
        {buttons}
        {settingsButton}
      </Box>
    )

    if (e.surface === 'terminal') {
      return (
        <Box flexDirection="column">
          <Text>{buildLine(snap, now)}</Text>
          <Box flexDirection="row">{buttonGroup}</Box>
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)
    // The lamps share the buttons' row: their Svg fills a Box as wide as their share of the strip, so
    // glyphs and words keep the strip's scale whatever the panel width.
    const lampCell = settings.lamps
      ? [<Box key="lamps" width={LAMPS_SHARE}><Svg source={buildLampsSvg(snap, now)} alt={lampWords(lamps(snap, now)).join(', ') || 'no lamp lit'} /></Box>]
      : []

    return (
      <Box flexDirection="column" alignSelf="flex-start">
        <Svg source={buildSvg(snap, now, Boolean(e.props.isWorking))} alt={buildLine(snap, now)} />
        <Box flexDirection="row" alignItems="center">
          {lampCell}
          {buttonGroup}
        </Box>
      </Box>
    )
  })
}
