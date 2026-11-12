// The panel <-> worker contract. worker/main.mjs answers these requests and posts `shako.state`.
export {}

export type SetupState = {
  supported: boolean
  cli: { found: boolean; path: string | null; version: string | null }
  account: { signedIn: boolean; tenant: string | null; email: string | null }
  install: { running: boolean; error: string | null; command: string }
  login: { running: boolean; link: string | null; error: string | null; keyName: string }
  skill: { installed: boolean; command: string }
}

declare module 'orca' {
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginRequests {
    'shako.refresh': { input: Record<string, never>; output: SetupState }
    'shako.installCli': { input: Record<string, never>; output: SetupState }
    'shako.login': { input: Record<string, never>; output: SetupState }
    'shako.cancelLogin': { input: Record<string, never>; output: SetupState }
  }
  // oxlint-disable-next-line typescript/consistent-type-definitions -- declaration merging needs an interface
  interface PluginPanelEvents {
    'shako.state': SetupState
  }
}
