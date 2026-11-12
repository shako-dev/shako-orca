// The Shako plugin's worker. Orca starts it when the plugin is enabled (it has a status bar item)
// and keeps it running. It finds or installs the shako CLI, signs this computer in with the CLI's
// own `shako login` (which registers this computer's SSH key), and tells the panel each change.
import { spawn } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir, hostname } from 'node:os'
import {
  INSTALL_COMMAND,
  SKILL_COMMAND,
  cliCandidates,
  commandPath,
  keyName,
  lastLine,
  parseLoggedIn,
  parseLoginLink,
  parseVersion,
  parseWhoami,
  skillPaths,
  statusBar,
  statusText
} from './shako.mjs'

const HOME = homedir()
const SUPPORTED = process.platform !== 'win32'
const ENV = { ...process.env, PATH: commandPath(process.env, HOME) }

/** The running `shako login`, so Cancel and a stopping worker can end it. */
let loginChild = null

/** Orca awaits this before it stops the worker: a login waiting for approval must not outlive it. */
export function deactivate() {
  loginChild?.kill('SIGTERM')
  loginChild = null
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
    cli: { found: false, path: null, version: null },
    account: { signedIn: false, tenant: null, email: null },
    install: { running: false, error: null, command: INSTALL_COMMAND },
    login: { running: false, link: null, error: null, keyName: keyName(hostname()) },
    skill: { installed: false, command: SKILL_COMMAND }
  }

  const publish = async () => {
    orca.panels.post('shako.state', state)
    try {
      await orca.host.call('statusBar.update', statusBar(state))
    } catch (error) {
      orca.log(`status bar: ${error?.message ?? error}`)
    }
  }

  const refresh = async () => {
    if (!SUPPORTED) return publish()
    state.cli = await findCli()
    state.account = { signedIn: false, tenant: null, email: null }
    if (state.cli.found) {
      const whoami = await run(state.cli.path, ['whoami'], { timeoutMs: 30_000 })
      const me = whoami.code === 0 ? parseWhoami(whoami.stdout) : null
      if (me) state.account = { signedIn: true, ...me }
    }
    let installed = false
    for (const path of skillPaths(HOME)) installed ||= await exists(path)
    state.skill.installed = installed
    await publish()
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
          body: state.skill.installed
            ? 'Ask any agent to create a VM or host an app.'
            : 'Last step: install the Shako skill for your agents (see the Shako panel).'
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

  // Once per install: point the person at the panel when setup is not done.
  if (!state.account.signedIn && (await orca.storage.get('welcomed')) !== true) {
    await orca.storage.set('welcomed', true)
    await orca.host
      .call('notifications.show', {
        title: 'Shako is installed',
        body: 'Open the Shako panel in the sidebar to sign up and register this computer.'
      })
      .catch(() => undefined)
  }
}
