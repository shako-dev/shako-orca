// The Shako plugin's worker. Orca starts it when the plugin is enabled (it has a status bar item)
// and keeps it running. On its first start it installs the shako CLI and the Shako skill with their
// official installers. It signs this computer in with the CLI's own `shako login` (which registers
// this computer's SSH key), and every few minutes it reads the VMs and the credit for the panel.
import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import {
  INSTALL_COMMAND,
  SKILL_COMMAND,
  WORKSPACE_URL,
  cliCandidates,
  commandPath,
  copyCommands,
  creditSummary,
  keyName,
  lastLine,
  orcaCliCandidates,
  orcaHostsForVms,
  overview,
  parseVmUsage,
  parseCredit,
  parseLoggedIn,
  parseLoginLink,
  parseVersion,
  parseVmList,
  parseWhoami,
  pickPluginKey,
  shellCommand,
  skillPaths,
  statusBar,
  statusText,
  updateDue
} from './shako.mjs'
import { createArgs } from '../shared/vm-options.mjs'

const HOME = homedir()
const SUPPORTED = process.platform !== 'win32'
const ENV = { ...process.env, PATH: commandPath(process.env, HOME) }
const POLL_MS = 5 * 60_000

/** The running `shako login`, so Cancel and a stopping worker can end it. */
let loginChild = null
let pollTimer = null

/** Orca awaits this before it stops the worker. */
export function deactivate() {
  loginChild?.kill('SIGTERM')
  loginChild = null
  if (pollTimer) clearInterval(pollTimer)
  pollTimer = null
}

/** Runs a command to its end. Never throws: a failure is a non-zero `code` with its output. */
function run(file, args, { timeoutMs = 60_000, onOutput, onSpawn, input } = {}) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(file, args, { env: ENV, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ code: -1, stdout, stderr: String(error) })
      return
    }
    onSpawn?.(child)
    if (input !== undefined) child.stdin.end(input)
    const timer = setTimeout(() => child.kill('SIGTERM'), timeoutMs)
    const take = (chunk, toErr) => {
      const text = chunk.toString()
      if (toErr) stderr += text
      else stdout += text
      onOutput?.(stdout + stderr)
    }
    child.stdout.on('data', (chunk) => take(chunk, false))
    child.stderr.on('data', (chunk) => take(chunk, true))
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ code: -1, stdout, stderr: stderr + String(error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

async function exists(path) {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function findCli() {
  for (const path of cliCandidates(process.env, HOME)) {
    if (!(await exists(path))) continue
    const result = await run(path, ['version'], { timeoutMs: 15_000 })
    const version = parseVersion(result.stdout)
    if (result.code === 0 && version) return { found: true, path, version }
  }
  return { found: false, path: null, version: null }
}

async function findOrcaCli() {
  for (const path of orcaCliCandidates(process.execPath, process.env, HOME)) {
    if (await exists(path)) return path
  }
  return null
}

/** Shows the Shako panel with Orca's own `orca plugin open`. Best effort: it never throws. */
async function openPanel(log) {
  const cli = await findOrcaCli()
  if (!cli) return log('open panel: no Orca CLI found')
  const list = await run(cli, ['plugin', 'list', '--json'], { timeoutMs: 30_000 })
  const key = pickPluginKey(list.stdout)
  if (!key) return log('open panel: this plugin is not in orca plugin list')
  const opened = await run(cli, ['plugin', 'open', key, '--panel', 'setup', '--json'], { timeoutMs: 30_000 })
  if (opened.code !== 0) log(`open panel: ${lastLine(opened.stderr || opened.stdout)}`)
}

/**
 * Matches the VMs with Orca's SSH hosts. Orca adds a VM as a host by itself from ~/.ssh/shako.conf,
 * where the shako CLI names each VM. When a VM is gone, this removes its host with Orca's own
 * `orca host rm`. Call it only with a VM list that `shako vm ls` gave: an error must not look like
 * "no VMs". Returns { vmName: { id, connected } }, or null when Orca's CLI cannot answer.
 */
async function syncOrcaHosts(vms, sshDomain, log) {
  const cli = await findOrcaCli()
  if (!cli || !sshDomain) return null
  const list = await run(cli, ['host', 'list', '--json'], { timeoutMs: 30_000 })
  const hosts = list.code === 0 ? orcaHostsForVms(list.stdout, vms.map((vm) => vm.name), sshDomain) : null
  if (!hosts) return null
  for (const id of hosts.stale) {
    const removed = await run(cli, ['host', 'rm', '--host', `ssh:${id}`, '--json'], { timeoutMs: 30_000 })
    log(removed.code === 0 ? `removed the Orca host of a deleted VM: ${id}` : `orca host rm ${id}: ${lastLine(removed.stdout)}`)
  }
  return hosts.byVm
}

/** @type {import('orca/worker').Activate} */
export default async function activate(orca) {
  const state = {
    supported: SUPPORTED,
    workspaceUrl: WORKSPACE_URL,
    cli: { found: false, path: null, version: null },
    account: { signedIn: false, tenant: null, email: null, sshDomain: null },
    install: { running: false, error: null, command: INSTALL_COMMAND },
    login: { running: false, link: null, error: null, keyName: keyName(hostname()) },
    skill: { installed: false, running: false, error: null, command: SKILL_COMMAND },
    vms: [],
    vmsError: null,
    orcaHostsKnown: false,
    overview: null,
    busy: {},
    createError: null,
    cliUpdate: null,
    credit: null,
    updatedAt: null
  }

  const publish = async () => {
    orca.panels.post('shako.state', state)
    try {
      await orca.host.call('statusBar.update', statusBar(state))
    } catch (error) {
      orca.log(`status bar: ${error?.message ?? error}`)
    }
  }

  const readAccount = async () => {
    state.account = { signedIn: false, tenant: null, email: null, sshDomain: null }
    state.vms = []
    state.vmsError = null
    state.overview = null
    state.credit = null
    if (!state.cli.found) return
    const whoami = await run(state.cli.path, ['whoami'], { timeoutMs: 30_000 })
    const me = whoami.code === 0 ? parseWhoami(whoami.stdout) : null
    if (!me) return
    state.account = { signedIn: true, tenant: me.tenant, email: me.email, sshDomain: me.sshDomain }
    const [vms, credit] = await Promise.all([
      run(state.cli.path, ['vm', 'ls'], { timeoutMs: 30_000 }),
      run(state.cli.path, ['credit', 'show'], { timeoutMs: 30_000 })
    ])
    if (vms.code !== 0) {
      state.vmsError = lastLine(vms.stderr || vms.stdout) || 'could not list the VMs'
    } else {
      const list = parseVmList(vms.stdout)
      // RAM and disk use: only an awake VM reports them, and asking an asleep one would not wake it.
      const usages = await Promise.all(
        list.map((vm) =>
          vm.state === 'awake'
            ? run(state.cli.path, ['vm', 'info', vm.name], { timeoutMs: 30_000 }).then((r) =>
                r.code === 0 ? parseVmUsage(r.stdout) : { ram: null, disk: null }
              )
            : Promise.resolve({ ram: null, disk: null })
        )
      )
      const hosts = await syncOrcaHosts(list, me.sshDomain, orca.log)
      state.vms = list.map((vm, i) => ({
        ...vm,
        ssh: me.sshDomain ? `${vm.name}.${me.sshDomain}` : null,
        ramUse: usages[i].ram,
        diskUse: usages[i].disk,
        orcaHost: hosts ? (hosts[vm.name] ?? null) : null
      }))
      state.orcaHostsKnown = hosts !== null
      state.overview = overview(state.vms)
    }
    state.credit = credit.code === 0 ? creditSummary(parseCredit(credit.stdout), state.vms, me.rates) : null
  }

  let refreshing = null
  const refresh = () => {
    refreshing ??= (async () => {
      if (SUPPORTED) {
        state.cli = await findCli()
        await readAccount()
        let installed = false
        for (const path of skillPaths(HOME)) installed ||= await exists(path)
        state.skill.installed = installed
        state.updatedAt = Date.now()
      }
      await publish()
    })().finally(() => {
      refreshing = null
    })
    return refreshing
  }

  // The official installer, as its docs give it. It prints why it failed (for example no python3).
  const installCli = async () => {
    if (state.install.running || !SUPPORTED) return state
    state.install = { ...state.install, running: true, error: null }
    await publish()
    const result = await run('/bin/sh', ['-c', INSTALL_COMMAND], { timeoutMs: 180_000 })
    state.install.running = false
    if (result.code !== 0) state.install.error = lastLine(result.stderr || result.stdout) || 'install failed'
    await refresh()
    return state
  }

  // The CLI's own updater, once a day. A new CLI brings new behaviour with no step for the person, for
  // example the VM names in ~/.ssh/shako.conf that make Orca show the VMs as SSH hosts. The next
  // refresh runs `shako vm ls`, which writes them.
  const updateCli = async () => {
    if (!state.cli.found) return
    await orca.storage.set('cliUpdateTriedAt', Date.now())
    const result = await run(state.cli.path, ['update'], { timeoutMs: 120_000 })
    const message = lastLine(result.stdout || result.stderr) || (result.code === 0 ? 'done' : 'failed')
    orca.log(`shako update: ${message}`)
    state.cliUpdate = { at: Date.now(), ok: result.code === 0, message }
    await refresh()
  }
  const updateCliWhenDue = async () => {
    if (updateDue(await orca.storage.get('cliUpdateTriedAt'), Date.now())) await updateCli()
  }

  // The skills CLI's own install, in the login shell so it finds the person's npx.
  const installSkill = async () => {
    if (state.skill.running || !SUPPORTED) return state
    state.skill = { ...state.skill, running: true, error: null }
    await publish()
    const [file, args] = shellCommand(process.env, SKILL_COMMAND)
    const result = await run(file, args, { timeoutMs: 240_000 })
    state.skill.running = false
    if (result.code !== 0) {
      const why = lastLine(result.stderr || result.stdout) || 'install failed'
      state.skill.error = /npx: (command )?not found|not found: npx/.test(result.stderr + result.stdout)
        ? 'npx is not installed. Install Node.js, or run the command in a terminal that has it.'
        : why
    }
    await refresh()
    return state
  }

  // `shako login` opens the approval page in the browser itself; the panel also shows its link.
  // A new user signs up on that page. The CLI makes this computer's SSH key if it has none, and the
  // approval adds that key to the account.
  const login = async () => {
    if (state.login.running || !state.cli.found || state.account.signedIn) return state
    state.login = { ...state.login, running: true, link: null, error: null }
    await publish()
    const result = await run(state.cli.path, ['login', '--name', state.login.keyName], {
      timeoutMs: 11 * 60_000,
      onSpawn: (child) => {
        loginChild = child
      },
      onOutput: (text) => {
        const link = parseLoginLink(text)
        if (link && link !== state.login.link) {
          state.login.link = link
          void publish()
        }
      }
    })
    loginChild = null
    state.login.running = false
    state.login.link = null
    if (result.code !== 0 || !parseLoggedIn(result.stdout)) {
      const why = lastLine(result.stderr || result.stdout)
      // The CLI's words ("run shako login again") are for a terminal: say what to press here.
      state.login.error = /no approval came|not approved|cancelled/i.test(why) || result.code === -1
        ? 'Not logged in yet. Press Log in or sign up to continue.'
        : why || 'This computer is not registered yet.'
    }
    // A read that began before the approval can still run, and its answer is "not logged in": let it end,
    // then read again.
    await refreshing
    await refresh()
    if (state.account.signedIn) {
      void openPanel(orca.log) // the panel now shows the credit and the VMs
      await orca.host
        .call('notifications.show', {
          title: `Shako: signed in as ${state.account.tenant}`,
          body: 'Your VMs are in the Shako panel. Ask any agent to create a VM or host an app.'
        })
        .catch(() => undefined)
    }
    return state
  }

  const cancelLogin = async () => {
    loginChild?.kill('SIGTERM')
    return state
  }

  orca.panels.handle('shako.refresh', async () => {
    await refresh()
    return state
  })
  orca.panels.handle('shako.installCli', () => {
    void installCli()
    return state
  })
  orca.panels.handle('shako.installSkill', () => {
    void installSkill()
    return state
  })
  orca.panels.handle('shako.login', () => {
    void login()
    return state
  })
  orca.panels.handle('shako.cancelLogin', cancelLogin)

  // A new VM, with the same choices as the web workspace (shared/vm-options.mjs checks them first).
  // --no-wait: the VM shows at once, and boots in a few seconds; the refreshes after show it awake.
  orca.panels.handle('shako.createVm', async (input) => {
    let args
    try {
      args = createArgs(input ?? {})
    } catch (error) {
      state.createError = error.message
      await publish()
      return state
    }
    state.createError = null
    state.busy = { ...state.busy, [input.name]: 'creating' }
    await publish()
    const result = await run(state.cli.path, args, { timeoutMs: 180_000 })
    delete state.busy[input.name]
    state.createError = result.code === 0 ? null : lastLine(result.stderr || result.stdout) || 'create failed'
    await refresh()
    if (result.code === 0) setTimeout(() => void refresh(), 15_000)
    return state
  })

  // Sleep or wake one VM: the pause button on its card.
  orca.panels.handle('shako.power', async (input) => {
    const name = String(input?.name ?? '')
    const verb = input?.action === 'wake' ? 'wake' : 'sleep'
    if (!state.vms.some((vm) => vm.name === name)) return state
    state.busy = { ...state.busy, [name]: verb === 'wake' ? 'waking' : 'sleeping' }
    await publish()
    const result = await run(state.cli.path, ['vm', verb, name], { timeoutMs: 120_000 })
    delete state.busy[name]
    if (result.code !== 0) orca.log(`vm ${verb} ${name}: ${lastLine(result.stderr || result.stdout)}`)
    await refresh()
    return state
  })

  // Copy a VM's ssh command: a panel has no clipboard, so the worker uses the system's own tool.
  orca.panels.handle('shako.copy', async (input) => {
    const text = String(input?.text ?? '').slice(0, 512)
    for (const [file, args] of copyCommands(process.platform)) {
      const result = await run(file, args, { timeoutMs: 10_000, input: text })
      if (result.code === 0) return { copied: true }
    }
    return { copied: false }
  })

  // The status bar item runs this: it shows the panel.
  orca.commands.register('shako.status', async () => {
    void openPanel(orca.log)
    await refresh()
    return statusText(state)
  })

  await refresh()
  pollTimer = setInterval(() => void updateCliWhenDue().then(refresh), POLL_MS)

  // First start after install, once: show the panel, install what is missing, and when this computer is not
  // logged in, start `shako login`, which opens the browser for the log in or sign-up. Later starts never open
  // the browser by themselves: step 3's button does.
  if ((await orca.storage.get('autoSetup')) !== true) {
    await orca.storage.set('autoSetup', true)
    void openPanel(orca.log)
    if (!state.cli.found) {
      await installCli()
      await orca.storage.set('cliUpdateTriedAt', Date.now()) // just installed: it is the newest
    }
    const skill = state.skill.installed ? Promise.resolve() : installSkill()
    const loggingIn = state.cli.found && !state.account.signedIn
    await orca.host
      .call('notifications.show', state.account.signedIn
        ? { title: 'Shako is installed', body: 'Your VMs are in the Shako panel.' }
        : loggingIn
          ? { title: 'Shako is installed', body: 'Log in or sign up in the browser page that opened.' }
          : { title: 'Shako is installed', body: 'Open the Shako panel on the right to log in.' })
      .catch(() => undefined)
    if (loggingIn) await login()
    await skill
  }
  await updateCliWhenDue()
}
