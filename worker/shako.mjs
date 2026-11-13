// Pure parts of the plugin: no Orca API, so node --test covers them (test/shako.test.mjs).
import { delimiter, dirname, join } from 'node:path'

/** The official installer of the shako CLI. It installs into ~/.local/bin and needs python3 3.10+. */
export const INSTALL_COMMAND = 'curl -fsSL https://shako.dev/install.sh | sh'

/** The official install of the Shako skill, for every coding agent on this computer, with no prompts. */
export const SKILL_COMMAND =
  'npx -y skills add https://github.com/shako-dev/shako-orca --skill shako --global -y'

/** How often the plugin runs `shako update`, the CLI's own updater: at start when due, then once a day. */
export const UPDATE_EVERY_MS = 24 * 60 * 60 * 1000

/** True when the last try of `shako update` is a day old, or there was none. */
export function updateDue(lastTriedAt, now) {
  return typeof lastTriedAt !== 'number' || now - lastTriedAt >= UPDATE_EVERY_MS
}

/** The Shako workspace: a VM's page is `${WORKSPACE_URL}/?vm=<name>`; credit is under Account. */
export const WORKSPACE_URL = 'https://workspace.shako.dev'

/** Where the skills installer puts a global skill: the shared folder, then Claude Code's own. */
export function skillPaths(home) {
  return [
    join(home, '.agents', 'skills', 'shako', 'SKILL.md'),
    join(home, '.claude', 'skills', 'shako', 'SKILL.md')
  ]
}

/** Paths to try for the CLI, first match wins: SHAKO_CLI, the installer's folder, then PATH. */
export function cliCandidates(env, home) {
  const dirs = [join(home, '.local', 'bin'), ...String(env.PATH ?? '').split(delimiter)]
  dirs.push('/usr/local/bin', '/opt/homebrew/bin')
  const seen = new Set()
  const out = env.SHAKO_CLI ? [env.SHAKO_CLI] : []
  for (const dir of dirs) {
    if (!dir || seen.has(dir)) continue
    seen.add(dir)
    out.push(join(dir, 'shako'))
  }
  return out
}

/**
 * Orca's own CLI, for `orca plugin open` (show this plugin's panel). The worker runs in Orca's app
 * binary, so the CLI that ships with the app is found next to it first: resources/bin/orca-ide on
 * Linux (checked), Contents/Resources/bin/orca on macOS. Then a registered `orca` on PATH.
 */
export function orcaCliCandidates(execPath, env, home) {
  const dir = dirname(String(execPath))
  const out = [
    join(dir, 'resources', 'bin', 'orca-ide'),
    join(dir, 'resources', 'bin', 'orca'),
    join(dir, '..', 'Resources', 'bin', 'orca'),
    join(dir, '..', 'Resources', 'bin', 'orca-ide')
  ]
  for (const d of [join(home, '.local', 'bin'), ...String(env.PATH ?? '').split(delimiter)]) {
    if (d) out.push(join(d, 'orca'), join(d, 'orca-ide'))
  }
  return out
}

/** This plugin's key in `orca plugin list --json`: the installed one (shako-dev.shako) before a dev copy. */
export function pickPluginKey(listText) {
  let plugins = []
  try {
    plugins = JSON.parse(String(listText))?.result?.plugins ?? []
  } catch {
    return null
  }
  const ours = plugins.filter((p) => /\.shako$/.test(p.pluginKey ?? '') && (p.status ?? 'running') === 'running')
  const installed = ours.find((p) => !p.isDev && !p.pluginKey.startsWith('local.'))
  return (installed ?? ours[0])?.pluginKey ?? null
}

/** PATH for the commands we run. A GUI app's PATH often lacks these folders. */
export function commandPath(env, home) {
  return [join(home, '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', env.PATH ?? '/usr/bin:/bin']
    .join(delimiter)
}

/** Runs a command line in the person's login shell, so it finds what their terminal finds (npx). */
export function shellCommand(env, command) {
  const shell = typeof env.SHELL === 'string' && env.SHELL.startsWith('/') ? env.SHELL : '/bin/sh'
  return shell === '/bin/sh' ? [shell, ['-c', command]] : [shell, ['-lc', command]]
}

/**
 * The name of this computer's key, from its host name, by Shako's key-name rule:
 * start with a letter or digit, then A-Z, a-z, 0-9, '.', '_' and '-', at most 64 characters.
 */
export function keyName(host) {
  const name = String(host ?? '')
    .split('.')[0]
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^[^A-Za-z0-9]+/, '')
    .slice(0, 64)
  return name || 'orca'
}

/** `shako version` prints "shako <version>". */
export function parseVersion(text) {
  const match = /^shako (\S+)/m.exec(String(text))
  return match ? match[1] : null
}

/**
 * `shako whoami`: the account, the SSH domain of its VMs, and the price of RAM per GB-hour.
 * Shako's prices are per GB of memory (small, 2 GB: $0.00488/h awake), so one size line gives the rate.
 */
export function parseWhoami(text) {
  const s = String(text)
  const head = /^tenant (\S+) \(([^)]*)\)/m.exec(s)
  if (!head) return null
  const ssh = /^ssh names\s+<vm>\.(\S+)/m.exec(s)
  const size = /^\s*\w+\s+\d+ vCPUs?, (\d+(?:\.\d+)?) GB, .*?\$([\d.]+)\/h awake, \$([\d.]+)\/h asleep/m.exec(s)
  const gb = size ? Number(size[1]) : 0
  return {
    tenant: head[1],
    email: head[2],
    sshDomain: ssh ? ssh[1] : null,
    rates: gb > 0 ? { awakePerGbHour: Number(size[2]) / gb, asleepPerGbHour: Number(size[3]) / gb } : null
  }
}

/** `shako login` prints the approval link on its own line, indented. */
export function parseLoginLink(text) {
  const match = /https:\/\/\S+\/cli\/login\?\S+/.exec(String(text))
  return match ? match[0] : null
}

/** `shako login` ends with "logged in as <tenant> (<email>) with the key <name>: ...". */
export function parseLoggedIn(text) {
  const match = /logged in as (\S+) \(([^)]*)\)/.exec(String(text))
  return match ? { tenant: match[1], email: match[2] } : null
}

/** The last non-empty line of a command's output, for an error message. */
export function lastLine(text) {
  const lines = String(text)
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
  return lines.length ? lines[lines.length - 1] : ''
}

/** `shako vm ls`: a table under a header line. Columns are cut where the header's words start. */
export function parseVmList(text) {
  const lines = String(text).split('\n').filter((line) => line.trim())
  const at = lines.findIndex((line) => /^NAME\s+STATE\b/.test(line))
  if (at < 0) return []
  const cols = [...lines[at].matchAll(/\S+/g)].map((m) => ({ key: m[0].toLowerCase(), start: m.index }))
  return lines
    .slice(at + 1)
    .map((line) => {
      const vm = {}
      cols.forEach((col, i) => {
        const end = i + 1 < cols.length ? cols[i + 1].start : undefined
        vm[col.key] = line.slice(col.start, end).trim()
      })
      return vm
    })
    .filter((vm) => vm.name)
}

/**
 * `shako vm info <vm>` of an awake VM: "ram  3.0 GB of 7.8 GB used (38%)" and the same for disk.
 * An asleep VM has no such lines (the box does not wake it to ask), so both are null.
 */
export function parseVmUsage(text) {
  const usage = (label) => {
    const m = new RegExp(`^\\s*${label}\\s+([\\d.]+) GB of ([\\d.]+) GB used \\((\\d+)%\\)`, 'm').exec(String(text))
    return m ? { usedGb: Number(m[1]), totalGb: Number(m[2]), percent: Number(m[3]) } : null
  }
  return { ram: usage('ram'), disk: usage('disk') }
}

/**
 * Which VMs Orca has as SSH hosts, from `orca host list --json`, and which Orca hosts are Shako VMs
 * that no longer exist. A host is a Shako VM when its name is exactly `<vm>.<sshDomain>`; any other
 * host (the person's own, or one they typed with a user@) is never touched.
 */
export function orcaHostsForVms(hostListText, vmNames, sshDomain) {
  let hosts = []
  try {
    hosts = JSON.parse(String(hostListText))?.result?.hosts ?? []
  } catch {
    return null
  }
  if (!sshDomain) return { byVm: {}, stale: [] }
  const suffix = `.${sshDomain}`
  const names = new Set(vmNames)
  const byVm = {}
  const stale = []
  for (const host of hosts) {
    if (host.kind !== 'ssh' || typeof host.name !== 'string' || !host.name.endsWith(suffix)) continue
    const vm = host.name.slice(0, -suffix.length)
    if (!/^[a-z][a-z0-9-]{0,30}$/.test(vm)) continue
    if (names.has(vm)) byVm[vm] = { id: host.id, connected: host.connected === true }
    else stale.push(host.id)
  }
  return { byVm, stale }
}

/** GB of memory from a size such as "4cpu/8G" or "1cpu/1536M". */
export function memoryGb(size) {
  const match = /\/(\d+(?:\.\d+)?)([GM])\b/.exec(String(size))
  if (!match) return 0
  return match[2] === 'G' ? Number(match[1]) : Number(match[1]) / 1024
}

/** GB of disk from a `vm ls` DISK such as "20G". */
export function diskGb(disk) {
  const match = /^(\d+(?:\.\d+)?)G$/.exec(String(disk))
  return match ? Number(match[1]) : 0
}

/** The overview: how many VMs, awake and asleep, and the RAM and disk they have. */
export function overview(vms) {
  const awake = vms.filter((vm) => vm.state === 'awake').length
  const asleep = vms.filter((vm) => vm.state === 'asleep').length
  const sum = (f) => Math.round(vms.reduce((total, vm) => total + f(vm), 0) * 10) / 10
  return { total: vms.length, awake, asleep, other: vms.length - awake - asleep,
    ramGb: sum((vm) => memoryGb(vm.size)), diskGb: sum((vm) => diskGb(vm.disk)) }
}

/** Commands that put text on the clipboard, first that runs wins: pbcopy on macOS; Linux has several. */
export function copyCommands(platform) {
  if (platform === 'darwin') return [['pbcopy', []]]
  if (platform === 'linux') {
    return [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]]
  }
  return []
}

/** What the VMs cost per hour now: awake RAM at the awake rate, asleep RAM at the asleep rate. */
export function spendPerHour(vms, rates) {
  if (!rates) return null
  let total = 0
  for (const vm of vms) {
    const rate = vm.state === 'asleep' ? rates.asleepPerGbHour : rates.awakePerGbHour
    total += memoryGb(vm.size) * rate
  }
  return total
}

/** `shako credit show`: "balance  $1007.38", "credit   $1010.00", "used     $2.62 since ...". */
export function parseCredit(text) {
  const s = String(text)
  const money = (label) => {
    const match = new RegExp(`^${label}\\s+(-?)\\$([\\d,]+(?:\\.\\d+)?)`, 'm').exec(s)
    return match ? Number(match[1] + match[2].replace(/,/g, '')) : null
  }
  const balance = money('balance')
  if (balance === null) return null
  return { balance, credit: money('credit'), used: money('used') }
}

/** Days the balance lasts at a spend per hour; Infinity when nothing is spent. */
export function runwayDays(balance, perHour) {
  if (balance <= 0) return 0
  if (!perHour || perHour <= 0) return Infinity
  return balance / perHour / 24
}

/** Red under 3 days or at no balance, amber under 14 days. */
export function creditTone(balance, days) {
  if (balance <= 0 || days < 3) return 'danger'
  if (days < 14) return 'warning'
  return 'success'
}

export function formatDays(days) {
  if (days === Infinity) return 'no spend now'
  if (days >= 365) return 'more than a year'
  if (days >= 2) return `about ${Math.floor(days)} days`
  const hours = Math.max(0, Math.floor(days * 24))
  return `about ${hours} hours`
}

export function formatDollars(value) {
  if (value === null || value === undefined) return '?'
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(2)}`
}

/** The credit summary the panel and the status bar show. JSON has no Infinity, so it is null there. */
export function creditSummary(credit, vms, rates) {
  if (!credit) return null
  const perHour = spendPerHour(vms, rates)
  const days = runwayDays(credit.balance, perHour)
  return {
    ...credit,
    perHour,
    perDay: perHour === null ? null : perHour * 24,
    days: days === Infinity ? null : days,
    runway: formatDays(days),
    tone: creditTone(credit.balance, days)
  }
}

/** The status bar item for a state. */
export function statusBar(state) {
  if (!state.account.signedIn) {
    return {
      id: 'shako',
      text: state.login.running ? 'Shako: approve in browser' : 'Shako: log in',
      tone: 'warning',
      tooltip: state.login.running ? 'Approve this computer in your browser' : 'Open the Shako panel to log in'
    }
  }
  const c = state.credit
  if (!c) {
    return { id: 'shako', text: `Shako: ${state.account.tenant}`, tone: 'success', tooltip: state.account.email || '' }
  }
  return {
    id: 'shako',
    text: `Shako ${formatDollars(c.balance)}`,
    tone: c.tone,
    tooltip: `${state.account.tenant}: ${formatDollars(c.balance)} left, ${c.runway} at the current spend`
  }
}

/** What `Shako: Status` shows: where setup stands and the next step. */
export function statusText(state) {
  if (!state.supported) return 'Shako needs macOS or Linux. On Windows, use Orca in WSL.'
  if (!state.cli.found) return 'Shako: the CLI is not installed. Open the Shako panel to install it.'
  if (state.login.running) return 'Shako: approve this computer in your browser.'
  if (!state.account.signedIn) return 'Shako: not logged in. Step 3 of the Shako panel logs you in.'
  const credit = state.credit
    ? ` ${formatDollars(state.credit.balance)} left, ${state.credit.runway} at the current spend.`
    : ''
  if (!state.skill.installed) {
    return `Shako: signed in as ${state.account.tenant}.${credit} Next, install the skill: ${SKILL_COMMAND}`
  }
  return `Shako: signed in as ${state.account.tenant}, ${state.vms.length} VMs.${credit}`
}
