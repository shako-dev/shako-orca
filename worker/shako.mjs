// Pure parts of the setup: no Orca API, so node --test covers them (test/shako.test.mjs).
import { delimiter, join } from 'node:path'

/** The official installer of the shako CLI. It installs into ~/.local/bin and needs python3 3.10+. */
export const INSTALL_COMMAND = 'curl -fsSL https://shako.dev/install.sh | sh'

/** The official install of the Shako skill for every coding agent on this computer. */
export const SKILL_COMMAND =
  'npx skills add https://github.com/shako-dev/shako-orca --skill shako --global -y'

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

/** PATH for the commands we run: the installer's folder first, because a GUI app's PATH often lacks it. */
export function commandPath(env, home) {
  return [join(home, '.local', 'bin'), env.PATH ?? '/usr/bin:/bin'].join(delimiter)
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

/** The first line of `shako whoami`: "tenant <tenant> (<email>): ...". */
export function parseWhoami(text) {
  const match = /^tenant (\S+) \(([^)]*)\)/m.exec(String(text))
  return match ? { tenant: match[1], email: match[2] } : null
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

/** The status bar item for a state. */
export function statusBar(state) {
  if (state.account.signedIn) {
    return {
      id: 'shako',
      text: `Shako: ${state.account.tenant}`,
      tone: 'success',
      tooltip: `Signed in as ${state.account.email || state.account.tenant}`
    }
  }
  return {
    id: 'shako',
    text: 'Shako: set up',
    tone: 'warning',
    tooltip: 'Open the Shako panel in the sidebar to finish setup'
  }
}

/** What `Shako: Status` shows: where setup stands and the next step. */
export function statusText(state) {
  if (!state.supported) return 'Shako needs macOS or Linux. On Windows, use Orca in WSL.'
  if (!state.cli.found) return 'Shako: the CLI is not installed. Open the Shako panel to install it.'
  if (!state.account.signedIn) return 'Shako: not signed in. Open the Shako panel to sign up or sign in.'
  if (!state.skill.installed) {
    return `Shako: signed in as ${state.account.tenant}. Next, install the skill for your agents: ${SKILL_COMMAND}`
  }
  return `Shako: signed in as ${state.account.tenant}. Ask any agent to create a VM or host an app.`
}
