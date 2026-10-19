import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'


const PROPS = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 } as never

const world = (on: On) => {
  mock.clock(on, { now: 1_000_000 })
  on('store.get', () => ({ value: undefined }))
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  // Nothing below cruscotto draws: the engine's own empty band, as in a session with no other mod.
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('command.register', () => ({}))
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
  expect(String((svg as { props: { source: string } }).props.source)).toContain('WEEKLY FABLE')
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
  const line = String(((await ui.find({ type: 'Text', text: /tok\/min/ })) as { props: { children: unknown } }).props.children)
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

test('cede la banda a chi ha qualcosa da mostrare', { plugins: [other] }, async ($, on) => {
  world(on)

  const ui = await $.ui.mount({ plugin: 'cruscotto', surface: 'vscode', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ type: 'Text', text: /another mod/ })).toBeDefined()
  expect(await ui.find({ type: 'Svg' })).toBeUndefined()
})
