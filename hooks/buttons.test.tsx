import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { ACTIONS } from './actions'

// Every button the band draws, on each surface that draws it: the prompt buttons, the person's own
// buttons, the gear and each control of the settings panel.

const PROPS = { hasSurvey: false, isWorking: false, maxRows: 20, bodyColumns: 120 } as never
const SURFACES = ['terminal', 'desktop', 'vscode'] as const
const FILE = '/notes/buttons.md'

type Seen = { prompts: string[]; asUser: (boolean | undefined)[]; toasts: string[]; sets: { key: string; value: unknown }[] }

type Answers = { rows?: unknown[]; drop?: string; deny?: string }

const world = (on: On, { rows = ROWS, drop, deny }: Answers = {}) => {
  const seen: Seen = { prompts: [], asUser: [], toasts: [], sets: [] }
  mock.clock(on, { now: 1_000_000 })
  on('store.get', () => ({ value: undefined }))
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('ui.toast', (_$, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('prompt.submit', (_$, e) => {
    seen.prompts.push(e.text)
    seen.asUser.push((e.origin as { asUser?: boolean } | undefined)?.asUser)
    return drop ? { drop } : { text: e.text }
  })
  on('config.list', () => ({ value: rows as never }))
  on('config.set', (_$, e) => {
    seen.sets.push({ key: e.key, value: e.value })
    return deny ? { deny } : { value: e.value }
  })
  return seen
}

const row = (field: string, label: string, kind: string, value: unknown, extra: object = {}) => ({
  key: `cruscotto.${field}`, label, kind, value, provider: { plugin: 'cruscotto' }, isLocked: false, ...extra,
})

// The rows /config holds for the manifest's seven fields, and one of the engine's own.
const ROWS = [
  { key: 'verbose', label: 'Verbose', kind: 'boolean', value: false, provider: { plugin: 'engine', tier: 'core' }, isLocked: false },
  row('skin', 'Skin', 'choice', 'night', { options: ['night', 'amber', 'paper', 'mono'] }),
  row('warnAt', 'Amber threshold (%)', 'number', 20),
  row('badAt', 'Red threshold (%)', 'number', 5),
  row('lamps', 'Lamps', 'boolean', true),
  row('coldCacheBelow', 'Cold cache lamp (%)', 'number', 50),
  row('buttons', 'Prompt buttons', 'boolean', true),
  row('buttonsFile', 'Your buttons', 'text', ''),
]

const label = async (ui: { find: (q: { key: string }) => Promise<{ props: Record<string, unknown> } | undefined> }, key: string) =>
  (await ui.find({ key }))?.props.label

for (const surface of SURFACES) {
  test(`${surface}: each prompt button sends its own prompt as the person`, async ($, on) => {
    const seen = world(on)
    const ui = await $.ui.mount({ plugin: 'cruscotto', surface, component: 'AbovePrompt', props: PROPS })

    for (const a of ACTIONS) {
      const found = await ui.find({ key: a.key })
      expect(found?.props.label).toBe(a.label)
      expect(found?.props.hotkey).toBe(a.hotkey)
      await ui.press({ key: a.key })
    }
    expect(seen.prompts).toEqual(ACTIONS.map(a => a.text))
    expect(seen.asUser).toEqual(ACTIONS.map(() => true))
    expect(ACTIONS.map(a => a.hotkey)).toEqual(['g', 'c', 'h'])
  })

  test(`${surface}: with Prompt buttons off only the gear is left`, { options: { buttons: false } }, async ($, on) => {
    world(on)
    const ui = await $.ui.mount({ plugin: 'cruscotto', surface, component: 'AbovePrompt', props: PROPS })

    for (const a of ACTIONS) expect(await ui.find({ key: a.key })).toBeUndefined()
    expect(await label(ui, 'settings')).toBe('⚙')
  })

  test(`${surface}: the person's own buttons come from the file, re-read at each prompt`, { options: { buttonsFile: FILE } }, async ($, on) => {
    const seen = world(on)
    let file = '## Review\nReview the last commit.\n\n## Tests\nRun the tests and tell me what failed.\n'
    on('fs.read', (_$, e) => (e.path === FILE ? { value: file } : { deny: 'no such file' }))

    await $.prompt.submit({ text: 'first prompt', wait: false, origin: { kind: 'composer' } })
    let ui = await $.ui.mount({ plugin: 'cruscotto', surface, component: 'AbovePrompt', props: PROPS })
    expect(await label(ui, 'custom-1')).toBe('Review')
    expect((await ui.find({ key: 'custom-1' }))?.props.hotkey).toBe('1')
    expect((await ui.find({ key: 'custom-2' }))?.props.hotkey).toBe('2')
    await ui.press({ key: 'custom-2' })
    expect(seen.prompts.at(-1)).toBe('Run the tests and tell me what failed.')
    await ui.unmount()

    // An edit to the file lands at the next prompt.
    file = '## Deploy\nDeploy to staging.\n'
    await $.prompt.submit({ text: 'second prompt', wait: false, origin: { kind: 'composer' } })
    ui = await $.ui.mount({ plugin: 'cruscotto', surface, component: 'AbovePrompt', props: PROPS })
    expect(await label(ui, 'custom-1')).toBe('Deploy')
    expect(await ui.find({ key: 'custom-2' })).toBeUndefined()
  })

  test(`${surface}: an unreadable buttons file leaves the built-in buttons`, { options: { buttonsFile: FILE } }, async ($, on) => {
    world(on)
    on('fs.read', () => ({ deny: 'no such file' }))

    await $.prompt.submit({ text: 'a prompt', wait: false, origin: { kind: 'composer' } })
    const ui = await $.ui.mount({ plugin: 'cruscotto', surface, component: 'AbovePrompt', props: PROPS })
    expect(await ui.find({ key: 'custom-1' })).toBeUndefined()
    expect(await label(ui, 'risolvi')).toBe('Go ahead')
  })

  test(`${surface}: a prompt that is dropped says so in a toast`, async ($, on) => {
    const seen = world(on, { drop: 'a turn is running' })
    const ui = await $.ui.mount({ plugin: 'cruscotto', surface, component: 'AbovePrompt', props: PROPS })

    await ui.press({ key: 'muoviti' })
    expect(seen.toasts).toEqual(['Prompt not sent: a turn is running'])
  })

  test(`${surface}: the gear swaps the strip for the settings and Done brings it back`, async ($, on) => {
    world(on)
    const ui = await $.ui.mount({ plugin: 'cruscotto', surface, component: 'AbovePrompt', props: PROPS })
    const strip = surface === 'terminal' ? { type: 'Text', text: /tok\/min/ } : { type: 'Svg' }

    expect(await ui.find(strip)).toBeDefined()
    await ui.press({ key: 'settings' })
    expect(await label(ui, 'settings')).toBe('Done')
    expect(await ui.find(strip)).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^Verbose$/ })).toBeUndefined()
    for (const r of ROWS.slice(1)) expect(await ui.find({ type: 'Text', text: new RegExp(`^${r.label.replace(/[()]/g, '\\$&')}$`) })).toBeDefined()
    // Only Done stays while the settings are open.
    expect(await label(ui, 'risolvi')).toBeUndefined()

    await ui.press({ key: 'settings' })
    expect(await label(ui, 'settings')).toBe('⚙')
    expect(await ui.find(strip)).toBeDefined()
  })

  test(`${surface}: every settings control writes its row`, async ($, on) => {
    const seen = world(on)
    const ui = await $.ui.mount({ plugin: 'cruscotto', surface, component: 'AbovePrompt', props: PROPS })
    await ui.press({ key: 'settings' })

    // The current value carries the tick.
    expect(await label(ui, 'cruscotto.skin=night')).toBe('✓ night')
    expect(await label(ui, 'cruscotto.lamps=On')).toBe('✓ On')
    expect(await label(ui, 'cruscotto.lamps=Off')).toBe('Off')

    for (const skin of ['night', 'amber', 'paper', 'mono']) await ui.press({ key: `cruscotto.skin=${skin}` })
    for (const field of ['lamps', 'buttons']) {
      await ui.press({ key: `cruscotto.${field}=Off` })
      await ui.press({ key: `cruscotto.${field}=On` })
    }
    for (const field of ['warnAt', 'badAt', 'coldCacheBelow']) {
      await ui.press({ key: `cruscotto.${field}+` })
      await ui.press({ key: `cruscotto.${field}-` })
    }
    await ui.input({ key: 'cruscotto.buttonsFile', text: `  ${FILE}  ` })

    expect(seen.sets).toEqual([
      ...['night', 'amber', 'paper', 'mono'].map(value => ({ key: 'cruscotto.skin', value })),
      { key: 'cruscotto.lamps', value: false },
      { key: 'cruscotto.lamps', value: true },
      { key: 'cruscotto.buttons', value: false },
      { key: 'cruscotto.buttons', value: true },
      { key: 'cruscotto.warnAt', value: 25 },
      { key: 'cruscotto.warnAt', value: 15 },
      { key: 'cruscotto.badAt', value: 10 },
      { key: 'cruscotto.badAt', value: 0 },
      { key: 'cruscotto.coldCacheBelow', value: 55 },
      { key: 'cruscotto.coldCacheBelow', value: 45 },
      { key: 'cruscotto.buttonsFile', value: FILE },
    ])
    // The panel stays open after a change.
    expect(await label(ui, 'settings')).toBe('Done')
  })

  test(`${surface}: the numbers stop at 0 and 100`, async ($, on) => {
    const seen = world(on, { rows: [row('badAt', 'Red threshold (%)', 'number', 0), row('warnAt', 'Amber threshold (%)', 'number', 100)] })
    const ui = await $.ui.mount({ plugin: 'cruscotto', surface, component: 'AbovePrompt', props: PROPS })
    await ui.press({ key: 'settings' })

    await ui.press({ key: 'cruscotto.badAt-' })
    await ui.press({ key: 'cruscotto.warnAt+' })
    expect(seen.sets).toEqual([
      { key: 'cruscotto.badAt', value: 0 },
      { key: 'cruscotto.warnAt', value: 100 },
    ])
  })

  test(`${surface}: a refused change says why and the panel stays`, async ($, on) => {
    const seen = world(on, { deny: 'managed by your organization' })
    const ui = await $.ui.mount({ plugin: 'cruscotto', surface, component: 'AbovePrompt', props: PROPS })
    await ui.press({ key: 'settings' })

    await ui.press({ key: 'cruscotto.skin=amber' })
    expect(seen.toasts).toEqual(['managed by your organization'])
    expect(await label(ui, 'settings')).toBe('Done')
  })

  test(`${surface}: a locked row shows its value and no control`, async ($, on) => {
    world(on, { rows: [row('skin', 'Skin', 'choice', 'paper', { options: ['night', 'paper'], isLocked: true })] })
    const ui = await $.ui.mount({ plugin: 'cruscotto', surface, component: 'AbovePrompt', props: PROPS })
    await ui.press({ key: 'settings' })

    expect(await ui.find({ key: 'cruscotto.skin=night' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /^paper$/ })).toBeDefined()
  })

  test(`${surface}: with no rows to show the panel points to /config`, async ($, on) => {
    world(on, { rows: [] })
    const ui = await $.ui.mount({ plugin: 'cruscotto', surface, component: 'AbovePrompt', props: PROPS })
    await ui.press({ key: 'settings' })

    expect(await ui.find({ type: 'Text', text: /type \/config/ })).toBeDefined()
  })
}

// Turning the lamps off in the panel takes them off the strip at once, before the module reloads.
test('desktop: Lamps Off removes the lamp row when the panel closes', async ($, on) => {
  world(on)
  const ui = await $.ui.mount({ plugin: 'cruscotto', surface: 'desktop', component: 'AbovePrompt', props: PROPS })
  expect(await ui.find({ key: 'lamps' })).toBeDefined()

  await ui.press({ key: 'settings' })
  await ui.press({ key: 'cruscotto.lamps=Off' })
  await ui.press({ key: 'settings' })
  expect(await ui.find({ key: 'lamps' })).toBeUndefined()
})
