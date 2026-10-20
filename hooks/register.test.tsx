import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'


const PROPS = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 } as never

const world = (on: On, turns = 0) => {
  mock.clock(on, { now: 1_000_000 })
  on('store.get', () => ({ value: undefined }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  // Nothing below cruscotto draws: the engine's own empty band, as in a session with no other mod.
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('command.register', () => ({}) as never)
  on('session.turns', () => ({ value: turns }))
  on('turn.start', (_$, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000, tokens: 50000, percent: 25 }, rateLimits: [] },
  }))
}

test('misure e turno finiscono nel quadro', async ($, on) => {
  world(on)

  await $.session.measure({
    context: { window: 200000, tokens: 50000, percent: 25 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 40, resetsAt: new Date(Date.now() + 3_600_000).toISOString() },
      { kind: 'seven_day', percentUsed: 12 },
      { kind: 'seven_day_fable', percentUsed: 35 },
    ],
    cost: { usd: 1.5 },
    changed: ['context', 'rateLimits', 'cost'],
  } as never)

  await $.turn.complete({
    answer: 'ok',
    durationMs: 4000,
    isAborted: false,
    turnId: 't1',
    reason: 'answer',
    usage: {
      model: 'claude-sonnet-5-5',
      input_tokens: 100,
      output_tokens: 200,
      cache_read_input_tokens: 700,
      cache_creation_input_tokens: 0,
    },
  } as never)


  const ui = await $.ui.mount({ plugin: 'cruscotto', surface: 'vscode', component: 'AbovePrompt', props: PROPS })
  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  expect(String((svg as unknown as { props: { source: string } }).props.source)).toContain('WEEKLY FABLE')
})

test('la prima lettura del context resta come partenza, /clear la azzera', async ($, on) => {
  world(on)
  on('session.end', () => ({ sessionId: 's1' }) as never)
  const measure = (percent: number) => $.session.measure({ context: { window: 200000, tokens: percent * 2000, percent }, rateLimits: [], changed: ['context'] } as never)
  await measure(18)
  await measure(40)
  const ui = await $.ui.mount({ plugin: 'cruscotto', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect((await ui.find({ type: 'Text', text: /HEAVY 18/ }))).toBeDefined()
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  await measure(9)
  await ui.redraw()
  expect((await ui.find({ type: 'Text', text: /HEAVY/ }))).toBeUndefined()
})

test('senza lettura di partenza la spia resta spenta: una ricarica a metà conversazione', async ($, on) => {
  world(on, 7)
  on('session.end', () => ({ sessionId: 's1' }) as never)
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  await $.session.measure({ context: { window: 200000, tokens: 36000, percent: 18 }, rateLimits: [], changed: ['context'] } as never)
  const ui = await $.ui.mount({ plugin: 'cruscotto', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect((await ui.find({ type: 'Text', text: /HEAVY/ }))).toBeUndefined()
})

test('il punto interrogativo mostra una riga per voce al posto della striscia', async ($, on) => {
  world(on)
  for (const surface of ['terminal', 'vscode'] as const) {
    const ui = await $.ui.mount({ plugin: 'cruscotto', surface, component: 'AbovePrompt', props: PROPS })
    const strip = surface === 'terminal' ? { type: 'Text', text: /tok\/min/ } : { type: 'Svg' }
    expect((await ui.find({ key: 'help' }))?.props.label).toBe('?')
    await ui.press({ key: 'help' })
    expect((await ui.find({ key: 'help' }))?.props.label).toBe('Done')
    expect(await ui.find(strip)).toBeUndefined()
    expect(await ui.find({ key: 'risolvi' })).toBeUndefined()
    expect(await ui.find({ key: 'settings' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Range$/ })).toBeDefined()
    await ui.press({ key: 'help' })
    expect(await ui.find(strip)).toBeDefined()
    await ui.unmount()
  }
})

test('i pulsanti inviano il prompt di risolvi101', async ($, on) => {
  world(on)
  const sent: string[] = []
  on('prompt.submit', (_$, e) => {
    sent.push(e.text)
    return { text: e.text }
  })

  const ui = await $.ui.mount({ plugin: 'cruscotto', surface: 'vscode', component: 'AbovePrompt', props: PROPS })
  await ui.press({ key: 'muoviti' })
  expect(sent).toEqual(['Speed up and parallelize where you can. Tell me why this is taking so long and how much time is left.'])
})

test('il terminale riceve una riga di testo', async ($, on) => {
  world(on)

  const ui = await $.ui.mount({ plugin: 'cruscotto', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: /tok\/min/ })).toBeDefined()
})

test('un subagente accende AGENTS e non tocca il turno della persona', async ($, on) => {
  world(on)

  await $.turn.start({ turnId: 'a-1', agentId: 'agent-1' } as never)
  let ui = await $.ui.mount({ plugin: 'cruscotto', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: /AGENTS 1/ })).toBeDefined()

  await $.turn.complete({
    answer: 'done', durationMs: 900, isAborted: false, turnId: 'a-1', agentId: 'agent-1', reason: 'error',
    usage: { model: 'claude-haiku-5-5', input_tokens: 10, output_tokens: 20, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as never)
  ui = await $.ui.mount({ plugin: 'cruscotto', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  const line = String(((await ui.find({ type: 'Text', text: /tok\/min/ })) as unknown as { props: { children: unknown } }).props.children)
  expect(line.includes('AGENTS')).toBe(false)
  expect(line.includes('FAILED')).toBe(false) // the subagent's error is not the person's turn failing
})

// A second mod that draws in the band.
const other = {
  name: 'other',
  register(on: On) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e) => {
      const { Text } = $.ui.resolve(e)
      return <Text>another mod</Text>
    })
  },
}

// A mod that only frames whatever is beneath it, and one that passes while idle.
const frame = {
  name: 'frame',
  register(on: On) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      const { Box } = $.ui.resolve(e)
      return <Box borderStyle="round">{await next(e)}</Box>
    })
  },
}
const quiet = {
  name: 'quiet',
  register(on: On) {
    on('ui.render', { component: 'AbovePrompt' }, async (_$, e, next) => next(e))
  },
}

test('disegna quando sotto c\'è solo una cornice o un mod che passa', { plugins: [frame, quiet] }, async ($, on) => {
  world(on)

  const ui = await $.ui.mount({ plugin: 'cruscotto', surface: 'vscode', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
})

test('mostra il disegno di un altro mod sopra la propria striscia', { plugins: [other] }, async ($, on) => {
  world(on)

  let ui = await $.ui.mount({ plugin: 'cruscotto', surface: 'vscode', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: /another mod/ })).toBeDefined()
  expect(String((await ui.find({ type: 'Svg' }) as unknown as { props: { source: string } }).props.source)).toContain('CONTEXT')
  await ui.unmount()

  ui = await $.ui.mount({ plugin: 'cruscotto', surface: 'terminal', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: /another mod/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /tok\/min/ })).toBeDefined()
})

// A mod that draws while it has something, then passes. Inline mods run sandboxed, with no reach into the
// test's variables, so the band's own maxRows prop stands in for its state: 1 means busy.
const toggling = {
  name: 'toggling',
  register(on: On) {
    on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
      if (e.props.maxRows !== 1) return next(e)
      const { Text } = $.ui.resolve(e)
      return <Text>busy below</Text>
    })
  },
}

test('il disegno altrui va e viene, la striscia resta', { plugins: [toggling] }, async ($, on) => {
  world(on)

  let ui = await $.ui.mount({ plugin: 'cruscotto', surface: 'vscode', component: 'AbovePrompt', props: { ...(PROPS as object), maxRows: 1 } as never })
  expect(await ui.find({ type: 'Text', text: /busy below/ })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
  await ui.unmount()

  ui = await $.ui.mount({ plugin: 'cruscotto', surface: 'vscode', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: /busy below/ })).toBeUndefined()
  expect(await ui.find({ type: 'Svg' })).toBeDefined()
})

test('con un sondaggio nella banda non disegna', async ($, on) => {
  world(on)

  const ui = await $.ui.mount({ plugin: 'cruscotto', surface: 'vscode', component: 'AbovePrompt', props: { ...(PROPS as object), hasSurvey: true } as never })
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
  expect(await ui.find({ type: 'Text', text: /tok\/min/ })).toBeUndefined()
})

// The rows /config holds: cruscotto's own and one of the engine's, which the panel leaves out.
const ROWS = [
  { key: 'theme', label: 'Theme', kind: 'choice', value: 'dark', options: ['dark', 'light'], provider: { plugin: 'engine', tier: 'core' }, isLocked: false },
  { key: 'cruscotto.skin', label: 'Skin', kind: 'choice', value: 'night', options: ['night', 'amber', 'paper', 'mono'], provider: { plugin: 'cruscotto' }, isLocked: false },
  { key: 'cruscotto.warnAt', label: 'Amber threshold (%)', kind: 'number', value: 20, provider: { plugin: 'cruscotto' }, isLocked: false },
  { key: 'cruscotto.lamps', label: 'Lamps', kind: 'boolean', value: true, provider: { plugin: 'cruscotto' }, isLocked: false },
]

for (const surface of ['terminal', 'vscode'] as const) {
  test(`l'ingranaggio apre solo le impostazioni del cruscotto (${surface})`, async ($, on) => {
    world(on)
    const sets: { key: string; value: unknown }[] = []
    on('config.list', () => ({ value: ROWS as never }))
    on('config.set', (_$, e) => {
      sets.push({ key: e.key, value: e.value })
      return { value: e.value }
    })

    const ui = await $.ui.mount({ plugin: 'cruscotto', surface, component: 'AbovePrompt', props: PROPS })
    await ui.press({ key: 'settings' })
    expect(await ui.find({ type: 'Text', text: /^Skin$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^Theme$/ })).toBeUndefined()
    expect((await ui.find({ key: 'cruscotto.skin=night' }))?.props.label).toBe('✓ night')
    expect((await ui.find({ key: 'cruscotto.skin=amber' }))?.props.label).toBe('amber')

    await ui.press({ key: 'cruscotto.skin=amber' })
    await ui.press({ key: 'cruscotto.warnAt+' })
    await ui.press({ key: 'cruscotto.lamps=Off' })
    expect(sets).toEqual([
      { key: 'cruscotto.skin', value: 'amber' },
      { key: 'cruscotto.warnAt', value: 25 },
      { key: 'cruscotto.lamps', value: false },
    ])

    await ui.press({ key: 'settings' })
    expect(await ui.find({ type: 'Text', text: /^Skin$/ })).toBeUndefined()
  })
}
