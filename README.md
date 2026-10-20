# cruscotto

An instrument strip above the Claude Code prompt, in the VS Code extension
and the desktop app: how much context and quota you have left, how fast
Claude is working, what the session costs, and buttons for the prompts you
send most often. In the terminal it is one line of text with the same
buttons.

![The strip: four tiles, Context, Session 5 h, Range and Weekly; under them the tokens-per-minute meter, the last-turns spectrum and the session's tokens and cost; the lamps and the buttons at the bottom](docs/skin-night.svg)

## Install

```
/plugin marketplace add roby222/cruscotto
/plugin install cruscotto@cruscotto
```

## What it shows

| Tile | Reading |
|---|---|
| Context | How full the context window is; the tick is the auto-compaction threshold |
| Session 5 h | Share of the 5-hour window left, and when it resets |
| Range | At the pace of the last 90 minutes, after at least 15 of them, does the 5-hour window last to its reset? A verdict: "16% spare" is the ideal; "10 min, empty, then 3 h 56 min wait" is the time to empty and the lockout that follows, amber, or red when empty within 30 minutes |
| Weekly | Share of the 7-day window left, and when it resets |

Quota bars turn amber at 20% left and red at 5%, both settings; Context
colors itself from its compaction tick, drawn once the engine has reported it.

| Meter | Reading |
|---|---|
| Tokens / min | Fresh tokens per minute over the last 5 minutes, cache reads excluded; full scale 60 k, the outlined segment is the 20-second peak. A tachometer, not an alarm; while a turn runs a wave of light crosses it |
| Last turns | One column per turn, the last eight, scaled to the heaviest; the outlined column is the turn in progress |
| Tokens, Cost | This session's tokens and their value at API prices (nothing is billed on a Pro or Max plan) |

| Lamp | Lights when |
|---|---|
| Failed | the last turn ended in error (red) |
| Cold | the cache hit of the last turn is under 50%, as after a compaction (amber) |
| Heavy | the conversation started with 15% or more of the context already taken by instructions, skills and tools, with that share (amber) |
| Tools | tool calls are running, with their count |
| Agents | subagents are running, with their count |

`/cruscotto` prints the raw readings. The strip is an image, so hovering
shows nothing. The band is shared: when another mod draws there, its
drawing sits above the strip, both in view.

## Buttons

- **Go ahead**: solve it on your own and explain how.
- **Commit and push**: stage, commit in the style of the last commits, push;
  no force push, no rebase.
- **Hurry up**: speed up, parallelize, say why it is slow.
- **?**: one line per tile, meter and lamp, in place of the strip and the buttons; **Done** closes it.
- **⚙**: the cruscotto settings, the same way.

When a hook refuses a button's prompt, a toast gives the reason instead of
the prompt vanishing.

Hotkeys `g`, `c`, `h` with the strip focused. Your own buttons: point the
**Your buttons** setting at a Markdown file where each `## Label` heading is
a button and the lines under it the prompt; they take the digits as hotkeys
and reload at your next prompt.

The editor theme paints the buttons and the plugin cannot change that. To
give them the skin's greys, in VS Code's `settings.json`:

```json
"workbench.colorCustomizations": {
  "button.background": "#34363a",
  "button.foreground": "#e6e4df",
  "button.hoverBackground": "#45474c"
}
```

## Settings

From the ⚙ button, or in `/config`, also shown once at install. The ⚙
panel lists only these rows and writes them where `/config` keeps them: a
tick marks the current skin and On or Off, − and + move a threshold by 5
between 0 and 100, and the file path is applied with Use file. A change applies
at once and the panel stays open until **Done**; a row your organization
locks shows its value and no control.

| Option | Default | What it does |
|---|---|---|
| Skin | night | night, amber, paper (light themes) or mono |
| Amber threshold | 20 | Share left at which a bar turns amber |
| Red threshold | 5 | The same for red |
| Lamps | on | Show the lamp row |
| Cold cache lamp | 50 | Cache hit under which Cold lights |
| Heavy start | 15 | Context share at the first reading from which Heavy lights |
| Prompt buttons | on | Show the three built-in buttons |
| Your buttons | none | Your Markdown file of buttons |

| night | amber |
|---|---|
| ![night](docs/skin-night.svg) | ![amber](docs/skin-amber.svg) |

| paper | mono |
|---|---|
| ![paper](docs/skin-paper.svg) | ![mono](docs/skin-mono.svg) |

The samples come from the plugin's own code (`node docs/skins.ts`); only
the buttons differ, here in the skin's greys.

Updates reach you with `claude plugin update cruscotto`, or on their own
if you turn on auto-update for this marketplace under Marketplaces in
`/plugin`; either way they apply at your next session.
[CHANGELOG.md](CHANGELOG.md) lists what each version changed.

## Development

```
claude --plugin-dir <this folder>
claude plugin validate <this folder>
claude plugin test <this folder>
```

`hooks/register.tsx` is the hooks module, `hooks/dash.ts` the drawing and
the thresholds, `hooks/actions.ts` the buttons, `types/index.d.ts` the
state. The engine writes `.claude-plugin/types/` on load, for the editor.

`claude plugin test` runs the tests against the engine itself: it mounts
the band on a surface and presses its buttons by key. `hooks/dash.test.ts`
covers the readings and the drawing, `hooks/register.test.tsx` the band
and how it shares space with other mods, and `hooks/buttons.test.tsx`
every button on the terminal, desktop and VS Code: the three prompts and
their hotkeys, your own buttons from the file, the gear and each control
of the settings panel.
