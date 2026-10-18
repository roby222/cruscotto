import { expect, test } from 'claude-code/testing'

import { parseButtons } from './actions'

test('parseButtons legge un pulsante per titolo', () => {
  const md = `# My buttons\n\n## Review\nReview the diff, worst problems first.\n\n## Tests\nRun the tests.\nFix what fails.\n\n## Empty\n\n`
  expect(parseButtons(md)).toEqual([
    { key: 'custom-1', label: 'Review', hotkey: '1', text: 'Review the diff, worst problems first.' },
    { key: 'custom-2', label: 'Tests', hotkey: '2', text: 'Run the tests.\nFix what fails.' },
  ])
  expect(parseButtons('')).toEqual([])
})
