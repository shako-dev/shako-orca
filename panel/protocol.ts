// The panel <-> worker contract. worker/main.mjs answers these requests and posts `shako.state`.
export {}

/** One row of `shako vm ls`. */
export type Vm = {
  name: string
  state: string
  size: string
  disk: string
  sleep: string
  active: string
  agents: string
}

export type Credit = {
  balance: number
  credit: number | null
  used: number | null
  perHour: number | null
  perDay: number | null
  /** null: nothing is spent now, so the balance lasts. */
  days: number | null
  runway: string
  tone: 'success' | 'warning' | 'danger'
}

export type ShakoState = {
  supported: boolean
  workspaceUrl: string
  cli: { found: boolean; path: string | null; version: string | null }
  account: { signedIn: boolean; tenant: string | null; email: string | null; sshDomain: string | null }
  install: { running: boolean; error: string | null; command: string }
  login: { running: boolean; link: string | null; error: string | null; keyName: string }
  skill: { installed: boolean; running: boolean; error: string | null; command: string }
  vms: Vm[]
  vmsError: string | null
  credit: Credit | null
  updatedAt: number | null
}

export type ShakoRequest =
  | 'shako.refresh'
  | 'shako.installCli'
  | 'shako.installSkill'
  | 'shako.login'
  | 'shako.cancelLogin'

declare module 'orca' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginRequests {
    'shako.refresh': { input: Record<string, never>; output: ShakoState }
    'shako.installCli': { input: Record<string, never>; output: ShakoState }
    'shako.installSkill': { input: Record<string, never>; output: ShakoState }
    'shako.login': { input: Record<string, never>; output: ShakoState }
    'shako.cancelLogin': { input: Record<string, never>; output: ShakoState }
  }
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginPanelEvents {
    'shako.state': ShakoState
  }
}
