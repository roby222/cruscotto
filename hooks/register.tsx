import { atom, read, update } from 'claude-code'
import type { ConfigRow, ConfigValue, EngineInterface, Register } from 'claude-code'

import type { Snap } from '../types'
import { ACTIONS, parseButtons } from './actions'
import type { Action } from './actions'
import { HELP, INITIAL, LAMPS_SHARE, buildLampsSvg, buildLine, buildReport, buildSvg, lampWords, lamps, freshOf, pushReading, pushSample, settings, tokensOf } from './dash'

/** Whether the engine's own band is still in the tree handed up: then no mod below replaced it with a drawing of its own. */
const holdsEngine = (el: unknown): boolean => {
  if (el == null || typeof el !== 'object') return false
  if (Array.isArray(el)) return el.some(holdsEngine)
  const node = el as { type?: string; props?: { children?: unknown }; children?: unknown }
  return node.type === 'engine' || holdsEngine(node.props?.children ?? node.children)
}

const snapAtom = atom({ plugin: 'cruscotto', key: 'snap' } as const, INITIAL)
// In $.state, not a module variable: every change of an option reloads the module, and the panel stays open.
const panelAtom = atom({ plugin: 'cruscotto', key: 'panel' } as const, '' as '' | 'settings' | 'help')
// A /config row of ours: `cruscotto.<field>` from `cruscotto`, or, when another plugin shares the name,
// `cruscotto@<marketplace>.<field>` from `cruscotto@<marketplace>`.
const ours = (name: string) => /^cruscotto([.@]|$)/.test(name)
/** Our rows among /config's, and how many there were in all: the panel draws them, /cruscotto counts them. */
const ownRows = ($: EngineInterface) =>
  $.config.list().then(
    all => ({ all, rows: all.filter(r => ours(r.key) || ours(r.provider.plugin)), error: '' }),
    (err: unknown) => ({ all: [] as ConfigRow[], rows: [] as ConfigRow[], error: String(err) }),
  )

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
    // A reload fires this too: loaded with the context already in use, the start of this conversation is unknown.
    await update($, snapAtom, (s: Snap) => ({ ...s, toolsRunning: 0, agents: [], startPct: null }))
    await $.command.register({ name: 'cruscotto', description: 'Raw cruscotto readings, to compare with the Usage panel' })
    if (buttonsFile) extra = parseButtons(await $.fs.read(buttonsFile).catch(() => ''))
    // "resets in", the range and the spark move with the clock, not with a state write. 2 s is cheap: an unchanged
    // drawing is not rasterized again, and the source changes only while a turn runs or a minute turns over.
    if (!ticking) {
      ticking = true
      $.clock.every(2_000, () => $.ui.invalidate('ui.render'))
    }

    return next(e)
  })

  // /clear and a resume start a new conversation without a session.start: its first reading is the next one.
  on('session.end', async ($, e, next) => {
    if (e.reason === 'clear' || e.reason === 'resume') await update($, snapAtom, (s: Snap) => ({ ...s, startPct: null }))

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
    // The settings line is what the smoke test reads: the real engine's /config rows through the panel's own filter.
    const { all, rows, error } = await ownRows($)
    const settingsLine = error ? `settings: config.list failed: ${error}` : `settings: ${rows.length} rows ours of ${all.length} in /config (${(rows.length ? rows : all).map(r => `${r.key} by ${r.provider.plugin}`).join(', ') || 'none'})`

    return { text: `${buildReport(snap, await $.clock.now())}\n${settingsLine}` }
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
    // The start reading belongs to the first exchange; later, with none on record, the lamp stays dark rather than guess.
    const opening = (await $.session.turns()) <= 1

    // Mid-turn, each model call grows the context: that growth is a live sample for the rate meter and the
    // spectrum's last column, replaced by the exact usage when the turn completes.
    await update($, snapAtom, (s: Snap) => {
      const grown = turning && e.context.tokens != null && s.ctxTokens != null ? e.context.tokens - s.ctxTokens : 0
      return {
      ...s,
      samples: grown > 0 ? pushSample(s.samples, { t: now, tokens: grown, live: true }) : s.samples,
      live: grown > 0 ? (s.live ?? 0) + grown : s.live ?? 0,
      ctxPct: e.context.percent ?? s.ctxPct,
      startPct: s.startPct ?? (opening ? e.context.percent ?? null : null),
      ctxTokens: e.context.tokens ?? s.ctxTokens,
      ctxWindow: e.context.window,
      limits: e.rateLimits.map(r => ({ kind: r.kind, pct: r.percentUsed, resetsAt: r.resetsAt })),
      burns: Object.fromEntries(e.rateLimits.map(r => [r.kind, pushReading(s.burns?.[r.kind] ?? [], { t: now, pct: r.percentUsed })])),
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
    // Mods below draw first; with nothing below, next(e) is the engine's own empty band. When a mod drew,
    // its tree goes on top of cruscotto's, as a child of the same column, so both show. The price of asking
    // first: every redraw, the 5 s tick included, runs the hooks below, and the strip waits for the slowest.
    // shortcut: a mod below that only frames the empty band loses its frame when cruscotto draws; nest ours inside theirs if such a mod appears.
    const below = await next(e)
    if (e.props.hasSurvey) return below
    const theirs = holdsEngine(below) ? null : below
    // Read the state only when drawing: a read here subscribes the band to every state write.
    const snap = await read($, snapAtom)

    const now = await $.clock.now()
    const { Box, Button, Text } = $.ui.resolve(e)
    const buttons = [...(options.buttons === false ? [] : ACTIONS), ...extra].map(a => (
      <Button
        key={a.key}
        label={a.label}
        hotkey={a.hotkey || undefined}
        plain
        // A hook that refuses the prompt answers { drop } and the call resolves: only a fault rejects.
        onPress={() => void $.prompt.submit({ text: a.text, asUser: true }).then(
          r => r.drop && $.ui.toast(`Prompt not sent: ${r.drop}`),
          (err: unknown) => $.ui.toast(`Prompt not sent: ${err instanceof Error ? err.message : String(err)}`),
        )}
      />
    ))
    const panel = await read($, panelAtom)
    // The question mark and the gear each open a panel in place of the strip: a line per item, or this plugin's
    // own rows of the engine's settings. Open, only that panel's Done remains.
    const toggle = (which: 'settings' | 'help') => (
      <Button key={which} label={panel === which ? 'Done' : which === 'help' ? '?' : '⚙'} plain onPress={() => void update($, panelAtom, (p: string) => (p === which ? '' : which))} />
    )
    const settingsButton = toggle('settings')
    const isOpen = panel === 'settings'
    // VS Code paints Buttons in its theme colors whatever the props (only key, label and dimColor reach
    // it). The row is one compact group at the right edge, the gear last; the host's own padding frames it.
    const buttonGroup = (
      <Box flexDirection="row" flexGrow={1} justifyContent="flex-end" gap={1}>
        {buttons}
        {toggle('help')}
        {settingsButton}
      </Box>
    )

    if (panel === 'help') {
      return (
        <Box flexDirection="column" gap={theirs ? 1 : 0}>
          {theirs}
          {HELP.map(([word, text]) => (
            <Box key={word} flexDirection="row" gap={1}>
              <Box width={e.surface === 'terminal' ? 14 : '16%'}><Text bold>{word}</Text></Box>
              <Text>{text}</Text>
            </Box>
          ))}
          <Box flexDirection="row" justifyContent="flex-end">{toggle('help')}</Box>
        </Box>
      )
    }

    if (isOpen) {
      // The same rows /config holds for this plugin: the values stay in the engine's settings.
      const listed = await ownRows($)
      const rows = listed.rows
      const els = $.ui.resolve(e)
      const Input = 'Input' in els ? els.Input : undefined
      const set = async (key: string, value: ConfigValue) => {
        const r = await $.config.set({ key, value })
        if (r.deny) return void $.ui.toast(r.deny)
        Object.assign(settings, { [key.slice(key.lastIndexOf('.') + 1)]: value })
        $.ui.invalidate('ui.render')
      }
      const pick = (r: ConfigRow, value: ConfigValue, label: string) => (
        <Button key={`${r.key}=${label}`} label={r.value === value ? `✓ ${label}` : label} plain onPress={() => void set(r.key, value)} />
      )
      const control = (r: ConfigRow) => {
        if (r.isLocked) return <Text dimColor>{String(r.value)}</Text>
        if (r.kind === 'boolean') return [pick(r, true, 'On'), pick(r, false, 'Off')]
        if (r.kind === 'choice') return (r.options ?? []).map(o => pick(r, o, o))
        if (r.kind === 'number') {
          const n = Number(r.value) || 0
          return [
            <Button key={`${r.key}-`} label="−" plain onPress={() => void set(r.key, Math.max(0, n - 5))} />,
            <Box key={`${r.key}=`}><Text>{String(n)}</Text></Box>,
            <Button key={`${r.key}+`} label="+" plain onPress={() => void set(r.key, Math.min(100, n + 5))} />,
          ]
        }
        return Input
          ? <Input key={r.key} value={String(r.value ?? '')} placeholder="Path to a Markdown file" submitLabel="Use file" onSubmit={v => void set(r.key, v.trim())} />
          : <Text>{String(r.value || '—')}</Text>
      }

      return (
        <Box flexDirection="column" gap={1}>
          {theirs}
          {rows.length === 0 && <Text>{listed.error || `No cruscotto settings among ${listed.all.length} /config rows: type /config`}</Text>}
          {rows.map(r => (
            <Box key={r.key} flexDirection="row" alignItems="center" gap={1}>
              <Box width={e.surface === 'terminal' ? 22 : '28%'}><Text>{r.label}</Text></Box>
              {control(r)}
            </Box>
          ))}
          <Box flexDirection="row" justifyContent="flex-end">{settingsButton}</Box>
        </Box>
      )
    }

    if (e.surface === 'terminal') {
      return (
        <Box flexDirection="column" gap={theirs ? 1 : 0}>
          {theirs}
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
      <Box flexDirection="column" gap={theirs ? 1 : 0}>
        {theirs}
        {/* Our own box, as wide as the strip: the lamp cell's share is of this width, not of a wider drawing above. */}
        <Box key="own" flexDirection="column" alignSelf="flex-start">
          <Svg source={buildSvg(snap, now, Boolean(e.props.isWorking))} alt={buildLine(snap, now)} />
          <Box flexDirection="row" alignItems="center">
            {lampCell}
            {buttonGroup}
          </Box>
        </Box>
      </Box>
    )
  })
}
