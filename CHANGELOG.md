# Changelog

Each entry is a version users receive with `claude plugin update cruscotto`,
newest first.

## 0.1.10 (2026-10-21)

- The band redraws every 2 seconds instead of 5: the spark steps more often
  while a turn runs.

## 0.1.9 (2026-10-20)

- The strip draws again in VS Code 2.1.304, whose webview refuses an
  animated picture as too heavy: the wave is now a spark that steps along
  the meter at each redraw, and the in-progress column no longer pulses.
- The four big values are smaller.

## 0.1.8 (2026-10-20)

- Heavy: loading the plugin with the context already in use clears the
  start reading, so a reload mid-conversation turns the lamp off.

## 0.1.7 (2026-10-20)

- With a wider drawing of another mod above, the lamps kept their share of
  that width and grew; they now take it from the strip's own box.

## 0.1.6 (2026-10-20)

- A ? button: one line per tile, meter and lamp, in place of the strip,
  Done to come back.
- Heavy no longer lights after a plugin reload mid-conversation: the start
  reading is taken only within the first exchange, and a reload no longer
  discards it.

## 0.1.5 (2026-10-20)

- Heavy lamp: lights amber, with the share, when a conversation's first
  context reading is at or above the Heavy start threshold (15% by
  default): the fixed load of instructions, skills and tools. Reset at
  `/clear` and on a resume.
- The buttons file field says Use file instead of Save.

## 0.1.4 (2026-10-20)

- The settings panel shows only Done, the prompt buttons return with the
  strip. Its rows are found by owner, not only by key, and an empty panel
  says what `/config` returned.

## 0.1.3 (2026-10-20)

- A blank row between another mod's drawing and the strip; none when the
  band is cruscotto's alone.

## 0.1.2 (2026-10-20)

- Another mod's drawing in the band no longer hides the strip: it sits
  above it, in the same column, and the strip stays. A survey still takes
  the band alone.

## 0.1.1 (2026-10-19)

- Range projects the pace as the median of the paces between every pair of
  readings of the last 90 minutes, needs 15 minutes of readings before a
  verdict, restarts after a window reset, and says what running out costs:
  "16 min, empty, then 3 h 25 min wait". Red only when empty within 30
  minutes and well before the reset.
- Tokens / min meter: fresh tokens per minute, cache reads excluded, full
  scale 60 k, one color, a wave of light while a turn runs.
- Last turns spectrum: one column per turn, the last eight, the turn in
  progress outlined.
- Counters TOKENS and COST for this session replace the cross-session total
  and the cost lamp; the turbo lamp is gone. Four lamps remain.
- The band is shared: cruscotto draws when nothing else in the band does.
- Buttons as one group on the right, the gear alone; the gear opens the
  settings panel in place of the strip.
- `/cruscotto` prints the range arithmetic with the readings it used.
- README cut to the essentials, install first.

## 0.1.0 (2026-10-18)

- First release: four tiles (Context, Session 5 h, Range, Weekly), lamps,
  three prompt buttons and your own from a Markdown file, four skins,
  settings through `/config`, installable as a marketplace.
