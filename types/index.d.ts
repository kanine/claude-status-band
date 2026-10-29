export type Quota = { kind: string; percentUsed: number; resetsAt?: number }

export type BandInfo = {
  cwd: string
  branch: string
  dirty: boolean
  model: string
  effort?: string
  ctx?: number
  quotas: Quota[]
}

declare module 'claude-code' {
  interface PluginState {
    'status-band': { info: BandInfo | null }
  }
}
