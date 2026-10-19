import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Snap } from '../types'
import { ACTIONS, parseButtons } from './actions'
import type { Action } from './actions'
import { INITIAL, buildLine, buildReport, buildSvg, pushReading, pushSample, settings, tokensOf } from './dash'

const snapAtom = atom({ plugin: 'cruscotto', key: 'snap' } as const, INITIAL)

export const register: Register = (on, options) => {
  Object.assign(settings, options)
  let tools = 0
  // The person's own buttons, re-read at each prompt: edits land at the next prompt, not on every redraw.
  let extra: Action[] = []
  const buttonsFile = typeof options.buttonsFile === 'string' ? options.buttonsFile : ''

  on('session.start', async ($, e, next) => {
    const stored = Number((await $.store.get('totalTokens')) ?? 0)
    await update($, snapAtom, (s: Snap) => ({ ...s, total: Number.isFinite(stored) ? stored : 0, toolsRunning: 0, agents: [] }))
    await $.command.register({ name: 'cruscotto', description: 'Raw cruscotto readings, to compare with the Usage panel' })
    if (buttonsFile) extra = parseButtons(await $.fs.read(buttonsFile).catch(() => ''))
    // "resets in", the range and the turbo lamp move with the clock, not with a state write.
    $.clock.every(15_000, () => $.ui.invalidate('ui.render'))

    return next(e)
  })

  on('turn.start', async ($, e, next) => {
    const id = e.agentId
    if (id) await update($, snapAtom, (s: Snap) => ({ ...s, agents: s.agents.includes(id) ? s.agents : [...s.agents, id] }))

    return next(e)
  })

  on('command.run', { command: 'cruscotto' }, async $ => {
    const snap = await read($, snapAtom)

    return { text: buildReport(snap, await $.clock.now()) }
  })

  on('prompt.submit', async ($, e, next) => {
    tools = 0
    await update($, snapAtom, (s: Snap) => ({ ...s, toolsRunning: 0 }))
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

    await update($, snapAtom, (s: Snap) => ({
      ...s,
      ctxPct: e.context.percent ?? s.ctxPct,
      ctxTokens: e.context.tokens ?? s.ctxTokens,
      ctxWindow: e.context.window,
      limits: e.rateLimits.map(r => ({ kind: r.kind, pct: r.percentUsed, resetsAt: r.resetsAt })),
      burn: five ? pushReading(s.burn, { t: now, pct: five.percentUsed }) : s.burn,
      usd: e.cost?.usd ?? s.usd,
    }))

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const now = await $.clock.now()
    const used = e.usage ? tokensOf(e.usage) : 0

    // A subagent's turn: it leaves the AGENTS lamp and its tokens count, nothing else is the person's turn.
    if (e.agentId) {
      const id = e.agentId
      let total = 0
      await update($, snapAtom, (s: Snap) => {
        total = s.total + used
        return { ...s, total, trip: s.trip + used, samples: used > 0 ? pushSample(s.samples, { t: now, tokens: used }) : s.samples, agents: s.agents.filter(a => a !== id) }
      })
      if (used > 0) await $.store.set('totalTokens', total)

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

    let total = 0
    await update($, snapAtom, (s: Snap) => {
      total = s.total + used
      const samples = used > 0 ? pushSample(s.samples, { t: now, tokens: used }) : s.samples

      return {
        ...s,
        model: e.usage?.model ?? s.model,
        total,
        trip: s.trip + used,
        samples,
        cacheHit: e.usage && input > 0 ? e.usage.cache_read_input_tokens / input : s.cacheHit,
        lastSeconds: Math.round(e.durationMs / 1000),
        lastTools: tools,
        hasError: e.reason === 'error' || e.reason === 'refusal',
        compactPct: compactPct ?? s.compactPct,
      }
    })

    if (used > 0) {
      await $.store.set('totalTokens', total)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const snap = await read($, snapAtom)

    if (e.props.hasSurvey || snap.isHidden) {
      return next(e)
    }

    const now = await $.clock.now()
    const { Box, Button, Text } = $.ui.resolve(e)
    const buttons = [...(options.buttons === false ? [] : ACTIONS), ...extra].map(a => (
      <Button key={a.key} label={a.label} hotkey={a.hotkey || undefined} plain onPress={() => void $.prompt.submit({ text: a.text, asUser: true })} />
    ))
    // The gear opens the engine's own settings menu, where this plugin's options live.
    const settingsButton = (
      <Button
        key="settings"
        label="Settings"
        plain
        onPress={() => void $.command.run({ command: 'config' }).catch(() => $.ui.toast('Type /config to change the cruscotto settings'))}
      />
    )
    // VS Code paints Buttons in its theme colors whatever the props (only key, label and dimColor reach it);
    // a text link looked like no button at all. What the plugin does own is their place: one cell per
    // column, so each button starts under a tile's label. The margin goes below the row, not above.
    // shortcut: cells are quarters, right for four tiles; with five or six rate windows the Svg draws three columns and the buttons no longer line up, revisit if such a plan appears.
    const grid = (
      <Box flexDirection="row" marginBottom={1}>
        {[...buttons, settingsButton].map((b, i) => <Box key={String(i)} width="25%">{b}</Box>)}
      </Box>
    )

    if (e.surface === 'terminal') {
      return (
        <Box flexDirection="column">
          <Text>{buildLine(snap, now)}</Text>
          <Box flexDirection="row" justifyContent="space-between" marginBottom={1}>
            <Box flexDirection="row" gap={3}>{buttons}</Box>
            {settingsButton}
          </Box>
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" alignSelf="flex-start">
        <Svg source={buildSvg(snap, now)} alt={buildLine(snap, now)} />
        {grid}
      </Box>
    )
  })
}
