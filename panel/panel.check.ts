// States `orca plugin check` renders, each against a stand-in worker answer (Orca never loads this file).
import { defineCheck } from 'orca/testing'
import type { ShakoState } from './protocol'

const base: ShakoState = {
  supported: true,
  workspaceUrl: 'https://workspace.shako.dev',
  cli: { found: true, path: '/home/u/.local/bin/shako', version: '0.1.0' },
  account: { signedIn: true, tenant: 'newbie', email: 'new@example.com', sshDomain: 'newbie.shako.dev' },
  install: { running: false, error: null, command: 'curl -fsSL https://shako.dev/install.sh | sh' },
  login: { running: false, link: null, error: null, keyName: 'MacBook-Pro' },
  skill: { installed: true, running: false, error: null, command: 'npx -y skills add ...' },
  vms: [],
  vmsError: null,
  orcaHostsKnown: true,
  overview: { total: 0, awake: 0, asleep: 0, other: 0, ramGb: 0, diskGb: 0 },
  busy: {},
  createError: null,
  cliUpdate: null,
  credit: { balance: 5, credit: 5, used: 0, perHour: 0, perDay: 0, days: null, runway: 'no spend now', tone: 'success' },
  updatedAt: 1_800_000_000_000
}

const vm = {
  name: 'web1', state: 'awake', size: '1cpu/2G', disk: '16G', sleep: 'auto', active: '4s ago', agents: '-',
  ssh: 'web1.newbie.shako.dev', ramUse: { usedGb: 0.2, totalGb: 1.9, percent: 11 },
  diskUse: { usedGb: 1.1, totalGb: 15.6, percent: 7 }, orcaHost: null
}

const state = (over: Partial<ShakoState>) => ({ requests: { 'shako.refresh': { ...base, ...over } } })

export default defineCheck({
  // Just signed up: no VM, the free credit, nothing spent.
  newAccount: state({}),
  // No credit at all, and no VM.
  noCredit: state({
    credit: { balance: 0, credit: 0, used: 0, perHour: 0, perDay: 0, days: 0, runway: 'about 0 hours', tone: 'danger' }
  }),
  // The first VM, still on the free credit.
  firstVm: state({
    vms: [vm],
    overview: { total: 1, awake: 1, asleep: 0, other: 0, ramGb: 2, diskGb: 16 },
    credit: { balance: 4.98, credit: 5, used: 0.02, perHour: 0.00488, perDay: 0.117, days: 42, runway: 'about 42 days', tone: 'success' }
  }),
  // Before sign-in: the setup steps, no Overview.
  signedOut: state({
    account: { signedIn: false, tenant: null, email: null, sshDomain: null },
    overview: null,
    credit: null
  })
})
