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
  creditSummary,
  keyName,
  lastLine,
  parseCredit,
  parseLoggedIn,
  parseLoginLink,
  parseVersion,
  parseVmList,
  parseWhoami,
  shellCommand,
  skillPaths,
  statusBar,
  statusText
} from './shako.mjs'

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
function run(file, args, { timeoutMs = 60_000, onOutput, onSpawn } = {}) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let child
    try {
      child = spawn(file, args, { env: ENV, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolve({ code: -1, stdout, stderr: String(error) })
      return
    }
    onSpawn?.(child)
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
    if (vms.code === 0) state.vms = parseVmList(vms.stdout)
    else state.vmsError = lastLine(vms.stderr || vms.stdout) || 'could not list the VMs'
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
      state.login.error = lastLine(result.stderr || result.stdout) || 'sign-in did not finish'
    }
    await refresh()
    if (state.account.signedIn) {
      await orca.host
        .call('notifications.show', {
          title: `Shako: signed in as ${state.account.tenant}`,
          body: 'Ask any agent to create a VM or host an app.'
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

  orca.commands.register('shako.status', async () => {
    await refresh()
    return statusText(state)
  })

  await refresh()
  pollTimer = setInterval(() => void refresh(), POLL_MS)

  // First start after install: install what is missing, once. The panel's buttons retry a failure.
  if ((await orca.storage.get('autoSetup')) !== true) {
    await orca.storage.set('autoSetup', true)
    if (!state.cli.found) await installCli()
    if (!state.skill.installed) await installSkill()
    await orca.host
      .call('notifications.show', state.account.signedIn
        ? { title: 'Shako is ready', body: 'Ask any agent to create a VM or host an app.' }
        : {
            title: 'Shako: one step left',
            body: 'Open the Shako panel in the right sidebar and press "Sign up or sign in".'
          })
      .catch(() => undefined)
  }
}
