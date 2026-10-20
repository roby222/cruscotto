# Changelog

Each entry is a version users receive with `claude plugin update cruscotto`,
newest first.

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
