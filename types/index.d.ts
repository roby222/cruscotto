/** Una finestra di rate limit come la riporta l'API: `pct` è la quota usata. */
export type Limit = { kind: string; pct: number; resetsAt?: string }

/** Tokens at a moment; `live` marks a mid-turn estimate from context growth, replaced by the turn's usage at its end. */
export type Sample = { t: number; tokens: number; live?: true }

/** Una lettura della finestra 5 h: quando, e quanto era usata. */
export type Reading = { t: number; pct: number }

export type Snap = {
  model: string
  ctxPct: number | null
  ctxTokens: number | null
  ctxWindow: number | null
  compactPct: number | null
  limits: Limit[]
  usd: number | null
  /** Tokens of this session, every turn and subagent turn summed. */
  trip: number
  /** Tokens of the last eight turns of the main loop, oldest first, for the spectrum. */
  turns: number[]
  /** Context growth of the turn in progress, the spectrum's live column; 0 between turns. */
  live: number
  samples: Sample[]
  /** Le letture della finestra 5 h nell'ultima ora e mezza, per l'autonomia. */
  burn: Reading[]
  cacheHit: number | null
  lastSeconds: number | null
  lastTools: number
  /** Tool calls of the main loop running right now, and the ids of the subagents mid-turn, for the lamps. */
  toolsRunning: number
  agents: string[]
  hasError: boolean
}

declare module 'claude-code' {
  interface PluginState {
    /** `settingsOpen`: the gear shows the plugin's settings in place of the strip. */
    cruscotto: { snap: Snap; settingsOpen: boolean }
  }
}
