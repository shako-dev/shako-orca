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
  /** `<vm>.<tenant>.<domain>`, the name ssh and Orca use. */
  ssh: string | null
  /** RAM and disk use; null for an asleep VM, which does not report them. */
  ramUse: Usage | null
  diskUse: Usage | null
  /** The VM's SSH host in Orca, or null when Orca does not have it (yet). */
  orcaHost: { id: string; connected: boolean } | null
}

export type Usage = { usedGb: number; totalGb: number; percent: number }

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
  /** false: Orca's CLI did not answer, so orcaHost says nothing. */
  orcaHostsKnown: boolean
  /** The last `shako update` this run of the worker did. */
  cliUpdate: { at: number; ok: boolean; message: string } | null
  /** Totals of the VMs, for the Overview. */
  overview: Overview | null
  /** VM name -> what runs on it now: creating, sleeping or waking. */
  busy: Record<string, string>
  /** Why the last create failed, from the choice check or the CLI. */
  createError: string | null
  credit: Credit | null
  updatedAt: number | null
}

export type Overview = { total: number; awake: number; asleep: number; other: number; ramGb: number; diskGb: number }

/** A new VM: the same choices as the web workspace's New VM form. */
export type NewVm = { name: string; size: string; agents: string[]; desktop: boolean }

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
    'shako.createVm': { input: NewVm; output: ShakoState }
    'shako.power': { input: { name: string; action: 'sleep' | 'wake' }; output: ShakoState }
    'shako.copy': { input: { text: string }; output: { copied: boolean } }
  }
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginPanelEvents {
    'shako.state': ShakoState
  }
}
