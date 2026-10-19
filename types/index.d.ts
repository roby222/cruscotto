/** Una finestra di rate limit come la riporta l'API: `pct` è la quota usata. */
export type Limit = { kind: string; pct: number; resetsAt?: string }

export type Sample = { t: number; tokens: number }

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
  /** API-price value of the earlier sessions, from the store; the odometer shows usdBase + usd. */
  usdBase: number
  total: number
  trip: number
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
  isHidden: boolean
}

declare module 'claude-code' {
  interface PluginState {
    cruscotto: { snap: Snap }
  }
}
