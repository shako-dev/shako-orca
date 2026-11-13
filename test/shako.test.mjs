// node --test test/shako.test.mjs  (no Orca needed: these cover the pure parts of the worker)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  SKILL_COMMAND,
  cliCandidates,
  commandPath,
  creditSummary,
  creditTone,
  formatDays,
  keyName,
  lastLine,
  memoryGb,
  orcaCliCandidates,
  orcaHostsForVms,
  parseCredit,
  parseLoggedIn,
  parseLoginLink,
  parseVersion,
  parseVmList,
  parseVmUsage,
  parseWhoami,
  pickPluginKey,
  runwayDays,
  shellCommand,
  skillPaths,
  spendPerHour,
  statusBar,
  statusText,
  UPDATE_EVERY_MS,
  updateDue
} from '../worker/shako.mjs'

// Real output of the shako CLI, 2026-11-12.
const WHOAMI = `tenant acme (me@example.com): 3 VMs, 2 keys
ssh names  <vm>.acme.shako.dev
app URLs   https://<vm>-<port>--acme.shakoapp.dev
sizes:
  small 1 vCPU, 2 GB, 16 GB disk, $0.00488/h awake, $0.00200/h asleep   (default)
  mid   2 vCPU, 4 GB, 32 GB disk, $0.00976/h awake, $0.00400/h asleep
`
const VM_LS = `NAME                    STATE   SIZE      DISK  SLEEP  ACTIVE   AGENTS
auction                 awake   1cpu/2G   20G   never  4s ago   -
here-lies               asleep  4cpu/12G  96G   auto   54m ago  -
shako-hermes-marketing  asleep  4cpu/8G   80G   auto   7h ago   hermes
`
const CREDIT = `balance  $1007.38
credit   $1010.00
used     $2.62 since 2026-11-09 19:53
  2026-11-09  free    $5.00
add more: shako credit add 5|10|25|50
`

test('keyName follows the Shako key-name rule', () => {
  assert.equal(keyName('Wans-MacBook-Pro.local'), 'Wans-MacBook-Pro')
  assert.equal(keyName('my laptop'), 'my-laptop')
  assert.equal(keyName('_box'), 'box')
  assert.equal(keyName(''), 'orca')
  assert.equal(keyName('a'.repeat(80)).length, 64)
})

test('finding the CLI and running commands', () => {
  const got = cliCandidates({ SHAKO_CLI: '/x/shako', PATH: '/usr/bin:/home/u/.local/bin' }, '/home/u')
  assert.deepEqual(got.slice(0, 3), ['/x/shako', '/home/u/.local/bin/shako', '/usr/bin/shako'])
  assert.equal(got.filter((p) => p === '/home/u/.local/bin/shako').length, 1)
  assert.equal(
    commandPath({ PATH: '/usr/bin' }, '/home/u'),
    '/home/u/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin'
  )
  assert.deepEqual(shellCommand({ SHELL: '/bin/zsh' }, 'npx x'), ['/bin/zsh', ['-lc', 'npx x']])
  assert.deepEqual(shellCommand({}, 'npx x'), ['/bin/sh', ['-c', 'npx x']])
  assert.deepEqual(skillPaths('/home/u'), [
    '/home/u/.agents/skills/shako/SKILL.md',
    '/home/u/.claude/skills/shako/SKILL.md'
  ])
  assert.match(SKILL_COMMAND, /^npx -y skills add https:\/\/github\.com\/shako-dev\/shako-orca .* -y$/)
})

test('parses version, login and errors', () => {
  assert.equal(parseVersion('shako 2026.11.10.3\n'), '2026.11.10.3')
  assert.equal(parseVersion('Python 3.9'), null)
  const out =
    'Approve this computer in your browser. If it does not open, open this link:\n' +
    '  https://workspace.shako.dev/cli/login?port=5123&state=abc&challenge=def&fp=SHA256%3Axyz\n'
  assert.equal(parseLoginLink(out), 'https://workspace.shako.dev/cli/login?port=5123&state=abc&challenge=def&fp=SHA256%3Axyz')
  assert.equal(parseLoginLink('nothing yet'), null)
  assert.deepEqual(parseLoggedIn('logged in as acme (me@example.com) with the key laptop: ssh ...'), {
    tenant: 'acme',
    email: 'me@example.com'
  })
  assert.equal(lastLine('one\n\ntwo  \n\n'), 'two')
})

test('parses whoami: account, SSH domain and the price per GB-hour', () => {
  const me = parseWhoami(WHOAMI)
  assert.equal(me.tenant, 'acme')
  assert.equal(me.email, 'me@example.com')
  assert.equal(me.sshDomain, 'acme.shako.dev')
  assert.ok(Math.abs(me.rates.awakePerGbHour - 0.00244) < 1e-9)
  assert.ok(Math.abs(me.rates.asleepPerGbHour - 0.001) < 1e-9)
  assert.equal(parseWhoami('shako: not logged in'), null)
})

test('parses vm ls by its header columns, values with spaces included', () => {
  const vms = parseVmList(VM_LS)
  assert.equal(vms.length, 3)
  assert.deepEqual(vms[0], {
    name: 'auction', state: 'awake', size: '1cpu/2G', disk: '20G', sleep: 'never', active: '4s ago', agents: '-'
  })
  assert.equal(vms[2].name, 'shako-hermes-marketing')
  assert.equal(vms[2].agents, 'hermes')
  assert.deepEqual(parseVmList('no VMs'), [])
  assert.equal(memoryGb('4cpu/12G'), 12)
  assert.equal(memoryGb('1cpu/1536M'), 1.5)
})

test('credit: balance, spend now and how long it lasts', () => {
  const credit = parseCredit(CREDIT)
  assert.deepEqual(credit, { balance: 1007.38, credit: 1010, used: 2.62 })
  const me = parseWhoami(WHOAMI)
  const vms = parseVmList(VM_LS)
  // awake 2 GB at 0.00244 + asleep 20 GB at 0.001 = 0.02488 $/h
  assert.ok(Math.abs(spendPerHour(vms, me.rates) - 0.02488) < 1e-9)
  const summary = creditSummary(credit, vms, me.rates)
  assert.equal(summary.tone, 'success')
  assert.equal(summary.runway, 'more than a year')
  assert.equal(runwayDays(10, 0), Infinity)
  assert.equal(creditSummary(credit, [], me.rates).days, null) // JSON has no Infinity
  assert.equal(runwayDays(0, 1), 0)
  assert.equal(creditTone(5, 2), 'danger')
  assert.equal(creditTone(5, 10), 'warning')
  assert.equal(creditTone(0, Infinity), 'danger')
  assert.equal(formatDays(20.7), 'about 20 days')
  assert.equal(formatDays(1.5), 'about 36 hours')
  assert.equal(parseCredit('shako: error'), null)
})

function state(overrides) {
  return {
    supported: true,
    cli: { found: true, path: '/x', version: '1' },
    account: { signedIn: true, tenant: 'acme', email: 'me@example.com' },
    skill: { installed: true, command: SKILL_COMMAND },
    login: { running: false },
    vms: [],
    credit: { balance: 12.5, runway: 'about 5 days', tone: 'warning' },
    ...overrides
  }
}

test('status bar and status text follow setup and credit', () => {
  assert.deepEqual(statusBar(state()), {
    id: 'shako',
    text: 'Shako $12.50',
    tone: 'warning',
    tooltip: 'acme: $12.50 left, about 5 days at the current spend'
  })
  assert.equal(statusBar(state({ credit: null })).text, 'Shako: acme')
  const out = state({ account: { signedIn: false, tenant: null, email: null } })
  assert.equal(statusBar(out).text, 'Shako: log in')
  assert.equal(statusBar({ ...out, login: { running: true } }).text, 'Shako: approve in browser')
  assert.match(statusText({ ...out, login: { running: true } }), /in your browser/)
  assert.match(statusText(out), /not logged in/)
  assert.match(statusText(state({ cli: { found: false } })), /not installed/)
  assert.match(statusText(state({ skill: { installed: false } })), /npx -y skills add/)
  assert.match(statusText(state()), /0 VMs\. \$12\.50 left/)
  assert.match(statusText(state({ supported: false })), /WSL/)
})

test('finds Orca\'s CLI next to the app, and this plugin\'s key', () => {
  const linux = orcaCliCandidates('/opt/Orca/orca-ide', { PATH: '/usr/bin' }, '/home/u')
  assert.equal(linux[0], '/opt/Orca/resources/bin/orca-ide')
  const mac = orcaCliCandidates('/Applications/Orca.app/Contents/MacOS/Orca', { PATH: '' }, '/Users/u')
  assert.ok(mac.includes('/Applications/Orca.app/Contents/Resources/bin/orca'))
  assert.ok(linux.includes('/home/u/.local/bin/orca'))
  const list = (plugins) => JSON.stringify({ ok: true, result: { plugins } })
  assert.equal(
    pickPluginKey(list([
      { pluginKey: 'local.shako', status: 'running' },
      { pluginKey: 'shako-dev.shako', status: 'running' },
      { pluginKey: 'acme.other', status: 'running' }
    ])),
    'shako-dev.shako'
  )
  assert.equal(pickPluginKey(list([{ pluginKey: 'local.shako', status: 'running' }])), 'local.shako')
  assert.equal(pickPluginKey(list([{ pluginKey: 'shako-dev.shako', status: 'disabled' }])), null)
  assert.equal(pickPluginKey('not json'), null)
})

test('VM use from vm info: awake has RAM and disk, asleep has none', () => {
  const awake = `auction: awake
  size      1cpu/2G, disk 20 GB
  ram       0.2 GB of 1.9 GB used (11%)
  disk      0.3 GB of 19.6 GB used (1%)
`
  assert.deepEqual(parseVmUsage(awake), {
    ram: { usedGb: 0.2, totalGb: 1.9, percent: 11 },
    disk: { usedGb: 0.3, totalGb: 19.6, percent: 1 }
  })
  assert.deepEqual(parseVmUsage('here-lies: asleep\n  size      4cpu/12G, disk 96 GB\n'), { ram: null, disk: null })
})

test('Orca hosts: only exact Shako VM names; gone VMs are stale; others untouched', () => {
  const list = JSON.stringify({ ok: true, result: { hosts: [
    { kind: 'local', name: 'this machine', id: 'local' },
    { kind: 'ssh', name: 'web1.acme.shako.dev', id: 'ssh-1', connected: true },
    { kind: 'ssh', name: 'old.acme.shako.dev', id: 'ssh-2', connected: false },
    { kind: 'ssh', name: 'shako@web1.acme.shako.dev', id: 'ssh-3' },
    { kind: 'ssh', name: 'devbox', id: 'ssh-4' },
    { kind: 'ssh', name: 'web1.other.shako.dev', id: 'ssh-5' },
    { kind: 'ssh', name: 'github.com', id: 'ssh-6' }
  ] } })
  assert.deepEqual(orcaHostsForVms(list, ['web1', 'db'], 'acme.shako.dev'), {
    byVm: { web1: { id: 'ssh-1', connected: true } },
    stale: ['ssh-2']
  })
  assert.equal(orcaHostsForVms('not json', ['web1'], 'acme.shako.dev'), null)
  assert.deepEqual(orcaHostsForVms(list, ['web1'], null), { byVm: {}, stale: [] })
})

test('shako update is due once a day, and at the first start', () => {
  const now = 1_800_000_000_000
  assert.equal(updateDue(null, now), true)
  assert.equal(updateDue(now - UPDATE_EVERY_MS + 1, now), false)
  assert.equal(updateDue(now - UPDATE_EVERY_MS, now), true)
})
