// node --test test/shako.test.mjs  (no Orca needed: these cover the pure parts of the worker)
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
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
} from '../worker/shako.mjs'

test('keyName follows the Shako key-name rule', () => {
  assert.equal(keyName('Wans-MacBook-Pro.local'), 'Wans-MacBook-Pro')
  assert.equal(keyName('my laptop'), 'my-laptop')
  assert.equal(keyName('_box'), 'box')
  assert.equal(keyName(''), 'orca')
  assert.equal(keyName('---'), 'orca')
  assert.equal(keyName('a'.repeat(80)).length, 64)
  for (const host of ['Wans-MacBook-Pro.local', 'my laptop', '_box', 'x_y.z']) {
    assert.match(keyName(host), /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/)
  }
})

test('cliCandidates: SHAKO_CLI, then ~/.local/bin, then PATH, no repeats', () => {
  const got = cliCandidates({ SHAKO_CLI: '/x/shako', PATH: '/usr/bin:/home/u/.local/bin' }, '/home/u')
  assert.deepEqual(got.slice(0, 3), ['/x/shako', '/home/u/.local/bin/shako', '/usr/bin/shako'])
  assert.equal(got.filter((p) => p === '/home/u/.local/bin/shako').length, 1)
})

test('commandPath puts ~/.local/bin first', () => {
  assert.equal(commandPath({ PATH: '/usr/bin' }, '/home/u'), '/home/u/.local/bin:/usr/bin')
})

test('skillPaths are the global skill folders', () => {
  assert.deepEqual(skillPaths('/home/u'), [
    '/home/u/.agents/skills/shako/SKILL.md',
    '/home/u/.claude/skills/shako/SKILL.md'
  ])
})

test('parses the CLI output', () => {
  assert.equal(parseVersion('shako 2026.11.10.3\n'), '2026.11.10.3')
  assert.equal(parseVersion('Python 3.9'), null)
  assert.deepEqual(parseWhoami('tenant acme (me@example.com): 2 VMs, 1 keys\nssh names ...'), {
    tenant: 'acme',
    email: 'me@example.com'
  })
  assert.equal(parseWhoami('shako: not logged in'), null)
  const out =
    'made a new SSH key: /home/u/.ssh/shako\n' +
    'Approve this computer in your browser. If it does not open, open this link:\n' +
    '  https://workspace.shako.dev/cli/login?port=5123&state=abc&challenge=def&fp=SHA256%3Axyz\n'
  assert.equal(
    parseLoginLink(out),
    'https://workspace.shako.dev/cli/login?port=5123&state=abc&challenge=def&fp=SHA256%3Axyz'
  )
  assert.equal(parseLoginLink('nothing yet'), null)
  assert.deepEqual(
    parseLoggedIn('logged in as acme (me@example.com) with the key laptop: ssh <vm>.acme.shako.dev works now'),
    { tenant: 'acme', email: 'me@example.com' }
  )
  assert.equal(lastLine('one\n\ntwo  \n\n'), 'two')
  assert.equal(lastLine(''), '')
})

function state(overrides) {
  return {
    supported: true,
    cli: { found: true, path: '/x', version: '1' },
    account: { signedIn: true, tenant: 'acme', email: 'me@example.com' },
    skill: { installed: true, command: SKILL_COMMAND },
    ...overrides
  }
}

test('status bar and status text follow the setup', () => {
  assert.equal(statusBar(state()).text, 'Shako: acme')
  assert.equal(statusBar(state()).tone, 'success')
  const out = state({ account: { signedIn: false, tenant: null, email: null } })
  assert.equal(statusBar(out).text, 'Shako: set up')
  assert.match(statusText(out), /not signed in/)
  assert.match(statusText(state({ cli: { found: false } })), /not installed/)
  assert.match(statusText(state({ skill: { installed: false } })), /npx skills add/)
  assert.match(statusText(state()), /Ask any agent/)
  assert.match(statusText(state({ supported: false })), /WSL/)
})
