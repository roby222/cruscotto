import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'


const PROPS = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 } as never

const world = (on: On, saved: unknown[] = []) => {
  mock.clock(on, { now: 1_000_000 })
  on('store.get', () => ({ value: undefined }))
  on('store.set', (_$, e) => {
    saved.push((e as { value: unknown }).value)
    return { value: (e as { value: unknown }).value }
  })
  on('session.measure', (_$, e) => ({ changed: e.changed }))
  on('command.register', () => ({}))
  on('turn.complete', (_$, e) => ({ text: e.answer }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000, tokens: 50000, percent: 25 }, rateLimits: [] },
  }))
}

test('misure e turno finiscono nel quadro', async ($, on) => {
  const saved: unknown[] = []
  world(on, saved)

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

  expect(saved).toEqual([1000])

  const ui = await $.ui.mount({ plugin: 'cruscotto', surface: 'vscode', component: 'AbovePrompt', props: PROPS })
  const svg = await ui.find({ type: 'Svg' })
  expect(svg).toBeDefined()
  expect(String((svg as { props: { source: string } }).props.source)).toContain('Weekly Fable')
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
