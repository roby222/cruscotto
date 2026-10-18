import { atom, read, update } from 'claude-code'
import type { Register } from 'claude-code'

import type { Snap } from '../types'
import { ACTIONS, parseButtons } from './actions'
import { INITIAL, buildLine, buildReport, buildSvg, pushReading, pushSample, settings, tokensOf } from './dash'

const snapAtom = atom({ plugin: 'cruscotto', key: 'snap' } as const, INITIAL)

export const register: Register = (on, options) => {
  Object.assign(settings, options)
  let tools = 0

  on('session.start', async ($, e, next) => {
    const stored = Number((await $.store.get('totalTokens')) ?? 0)
    await update($, snapAtom, (s: Snap) => ({ ...s, total: Number.isFinite(stored) ? stored : 0 }))
    await $.command.register({ name: 'cruscotto', description: 'Raw cruscotto readings, to compare with the Usage panel' })

    return next(e)
  })

  on('command.run', { command: 'cruscotto' }, async $ => {
    const snap = await read($, snapAtom)

    return { text: buildReport(snap, await $.clock.now()) }
  })

  on('prompt.submit', ($, e, next) => {
    tools = 0

    return next(e)
  })

  on('tool.call', ($, e, next) => {
    tools += 1

    return next(e)
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
        hasError: e.reason === 'error',
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
    const file = typeof options.buttonsFile === 'string' ? options.buttonsFile : ''
    const extra = file ? parseButtons(await $.fs.read(file).catch(() => '')) : []
    const buttons = [...(options.buttons === false ? [] : ACTIONS), ...extra].map(a => (
      <Button
        key={a.key}
        label={a.label}
        hotkey={a.hotkey || undefined}
        variant="secondary"
        dimColor
        onPress={() => void $.prompt.submit({ text: a.text, asUser: true })}
      />
    ))
    // The gear opens the engine's own settings menu, where this plugin's options live.
    buttons.push(
      <Button
        key="settings"
        label="⚙️ Settings"
        plain
        dimColor
        onPress={() => void $.command.run({ command: 'config' }).catch(() => $.ui.toast('Type /config to change the cruscotto settings'))}
      />,
    )

    if (e.surface === 'terminal') {
      return (
        <Box flexDirection="column">
          <Text>{buildLine(snap, now)}</Text>
          <Box flexDirection="row" justifyContent="flex-end" gap={1}>{buttons}</Box>
        </Box>
      )
    }

    const { Svg } = $.ui.resolve(e)

    return (
      <Box flexDirection="column" alignSelf="flex-start">
        <Svg source={buildSvg(snap, now)} alt={buildLine(snap, now)} />
        <Box flexDirection="row" justifyContent="flex-end" gap={1}>{buttons}</Box>
      </Box>
    )
  })
}
