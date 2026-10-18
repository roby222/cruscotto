# cruscotto

A quiet instrument strip above the Claude Code prompt, in the spirit of a
nineties night-lit dashboard: four thin bars, one check-engine lamp, and
three buttons for the prompts you send most often.

## What it shows

| Gauge | Reading |
|---|---|
| Context | How full the context window is, with a tick at the auto-compaction threshold |
| Range | Whether the 5-hour window lasts until its reset at the current pace, or when it runs out |
| Session 5 h | Share of the 5-hour rate-limit window left, and when it resets |
| Weekly | Share of the 7-day window left, and when it resets; any other window the API reports gets its own bar |

The header carries the model in use and the total tokens counted, in
millions, kept across sessions. The total sums input, output, cache-read
and cache-write tokens of every turn.

The lamp stays a dim outline while everything is fine. It turns amber when
a window drops to 20% left or the context is within 20 points of
compaction, and red at 5% left, within 5 points of compaction, when a window
is used up, when the 5-hour window would run out within 30 minutes, or when
the last turn failed. The reason is written next to it.

`/cruscotto` prints the raw readings, to compare with the Usage panel.

## Buttons

Each one submits a prompt as your own words:

- **Autopilot**: solve it, go ahead on your own, and explain how.
- **Commit and push**: stage everything, commit in the style of the last
  commits, push the current branch; no force push, no rebase.
- **≡D** (flash the headlights): speed up, parallelize, say why it is slow
  and how long is left.

With the strip focused, the hotkeys are `p`, `c` and `s`. The texts live in
`hooks/actions.ts`.

## Install

At the prompt of a terminal session:

```
/plugin install cruscotto --marketplace roby222/cruscotto
```

From a shell:

```
claude plugin install cruscotto --marketplace roby222/cruscotto
```

In the desktop app, where `/plugin` does not run: click + next to the
prompt box, then Plugins, Add marketplace with `roby222/cruscotto`, then Add
plugin.

A private repository installs only for people who can read it on GitHub and
whose machine already holds a git credential for github.com (an SSH key, or
`gh auth login` then `gh auth setup-git`).

## Surfaces

The strip is drawn as SVG on the desktop app and the VS Code extension. On
the terminal, which has no SVG, it is one line of text with the same values,
and the buttons draw as `[ label ]`.

## Development

```
claude --plugin-dir <this folder>
claude plugin validate <this folder>
claude plugin test <this folder>
```

The engine writes `.claude-plugin/types/` on load, for the editor; it is
ignored by git. `tsc -p <this folder>` type-checks the module once those
types exist.

## Layout

- `.claude-plugin/plugin.json`: the manifest.
- `.claude-plugin/marketplace.json`: makes this repository installable.
- `hooks/register.tsx`: the hooks module, drawing and state.
- `hooks/dash.ts`: thresholds, lamp, range, SVG.
- `hooks/actions.ts`: the three buttons.
- `types/index.d.ts`: the state contract.
- `hooks/*.test.ts`: tests, run with `claude plugin test`.
