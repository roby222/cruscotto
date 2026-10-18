/** The three risolvi101 quick commands, sent as the user's own prompt. */
export type Action = { key: string; label: string; hotkey: string; text: string }

export const ACTIONS: Action[] = [
  {
    key: 'risolvi',
    label: 'Go ahead',
    hotkey: 'g',
    text: 'Solve it, go ahead on your own, find a solution and tell me how you solved it',
  },
  {
    key: 'commit-push',
    label: 'Commit and push',
    hotkey: 'c',
    text: [
      'Commit and push on the current branch right away. This command is my explicit authorization: do not ask for confirmation.',
      '',
      'Steps:',
      '1. Stage every change (`git add -A`). Leave out, and tell me about, files that look like secrets or keys, or that the repository forbids reading (`.aiignore`).',
      '2. Write the commit message in the style of the last commits (`git log --oneline -10`) and with the session attribution rules.',
      '3. Commit without skipping hooks. If a hook fails, fix the cause and make a new commit.',
      '4. Run `git push`. If the branch has no upstream, use `git push -u origin <branch>`.',
      '5. If the push is rejected, stop and tell me why. No force push, no rebase.',
      '',
      'At the end tell me in one line: commit hash, branch and remote.',
    ].join('\n'),
  },
  {
    key: 'muoviti',
    label: 'Hurry up',
    hotkey: 'h',
    text: 'Speed up and parallelize where you can. Tell me why this is taking so long and how much time is left.',
  },
]

/**
 * Extra buttons from the person's Markdown file: each `## Label` heading starts
 * one, the lines under it are the prompt. Hotkeys are the digits 1 to 9, in order.
 */
export const parseButtons = (text: string): Action[] => {
  const out: Action[] = []
  for (const block of text.split(/^## +/m).slice(1)) {
    const nl = block.indexOf('\n')
    const label = (nl < 0 ? block : block.slice(0, nl)).trim()
    const body = (nl < 0 ? '' : block.slice(nl + 1)).trim()
    if (!label || !body) continue
    const n = out.length + 1
    out.push({ key: `custom-${n}`, label, hotkey: n <= 9 ? String(n) : '', text: body })
  }
  return out
}
