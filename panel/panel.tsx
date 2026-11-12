// The setup panel: three steps, each done by the official tool for it.
// 1. the shako CLI (its installer), 2. the account (`shako login`, which registers this computer's
// SSH key), 3. the skill for the agents (`npx skills add`, which the person runs).
import {
  atom,
  Badge,
  Button,
  Callout,
  Card,
  Code,
  Heading,
  plugin,
  read,
  Row,
  set,
  shell,
  Spinner,
  Stack,
  Text,
  type PanelContext
} from 'orca'
import type { SetupState } from './protocol'

const state = atom<SetupState | null>(null)
const failure = atom<string | null>(null)

async function ask(name: 'shako.refresh' | 'shako.installCli' | 'shako.login' | 'shako.cancelLogin') {
  try {
    set(failure, null)
    set(state, await plugin.request(name, {}, { timeoutMs: 60_000 }))
  } catch (error) {
    set(failure, (error as Error).message)
  }
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('shako.state', (next) => set(state, next)))
  void ask('shako.refresh')
}

function Done({ children }: { children: string }) {
  return <Badge tone="success">{children}</Badge>
}

function CliStep({ s }: { s: SetupState }) {
  if (s.cli.found) {
    return (
      <Card title="1. Shako CLI">
        <Row gap="sm">
          <Done>Installed</Done>
          <Text muted>shako {s.cli.version}</Text>
        </Row>
      </Card>
    )
  }
  return (
    <Card title="1. Shako CLI" description="The command your agents use to create VMs and host apps.">
      <Stack gap="sm">
        <Text muted>Runs the official installer. It needs python3 3.10 or newer.</Text>
        <Code block>{s.install.command}</Code>
        {s.install.running ? (
          <Spinner label="Installing" />
        ) : (
          <Button icon="download" onPress={() => ask('shako.installCli')}>
            Install the CLI
          </Button>
        )}
        {s.install.error ? <Callout tone="danger" title="Install failed">{s.install.error}</Callout> : null}
      </Stack>
    </Card>
  )
}

function AccountStep({ s }: { s: SetupState }) {
  if (s.account.signedIn) {
    return (
      <Card title="2. Account">
        <Stack gap="xs">
          <Row gap="sm">
            <Done>Signed in</Done>
            <Text>{s.account.tenant}</Text>
          </Row>
          <Text muted>{s.account.email ?? ''}</Text>
          <Text muted>This computer's SSH key is registered.</Text>
        </Stack>
      </Card>
    )
  }
  return (
    <Card
      title="2. Account"
      description="Sign up or sign in. Approving in the browser registers this computer's SSH key."
    >
      <Stack gap="sm">
        {s.login.running ? (
          <Stack gap="sm">
            <Spinner label="Waiting for your approval in the browser" />
            {s.login.link ? (
              <Button icon="open-external" variant="outline" onPress={() => shell.openExternal(s.login.link!)}>
                Open the approval page
              </Button>
            ) : null}
            <Button variant="ghost" onPress={() => ask('shako.cancelLogin')}>
              Cancel
            </Button>
          </Stack>
        ) : (
          <Button icon="link" disabled={!s.cli.found} onPress={() => ask('shako.login')}>
            Sign up or sign in
          </Button>
        )}
        <Text muted size="sm">Key name: {s.login.keyName}</Text>
        {s.login.error ? <Callout tone="danger" title="Sign-in did not finish">{s.login.error}</Callout> : null}
      </Stack>
    </Card>
  )
}

function SkillStep({ s }: { s: SetupState }) {
  if (s.skill.installed) {
    return (
      <Card title="3. Skill for your agents">
        <Row gap="sm">
          <Done>Installed</Done>
          <Text muted>Every project's agents know Shako.</Text>
        </Row>
      </Card>
    )
  }
  return (
    <Card
      title="3. Skill for your agents"
      description="Teaches every agent, in every project, to create VMs and host apps."
    >
      <Stack gap="sm">
        <Text muted>Run this once in any terminal:</Text>
        <Code block>{s.skill.command}</Code>
        <Button icon="refresh" variant="outline" onPress={() => ask('shako.refresh')}>
          Check again
        </Button>
      </Stack>
    </Card>
  )
}

export default function Panel() {
  const s = read(state)
  const error = read(failure)
  return (
    <Stack gap="md">
      <Heading>Shako</Heading>
      <Text muted>Cloud VMs that sleep when idle. Your agents create them and host apps on them.</Text>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {!s ? (
        <Spinner label="Checking setup" />
      ) : !s.supported ? (
        <Callout tone="warning" title="Not supported here">
          Shako needs macOS or Linux. On Windows, use Orca in WSL.
        </Callout>
      ) : (
        <Stack gap="md">
          <CliStep s={s} />
          <AccountStep s={s} />
          <SkillStep s={s} />
          {s.account.signedIn && s.skill.installed ? (
            <Callout tone="success" title="Ready">
              Ask any agent: "Create a Shako VM and host this app."
            </Callout>
          ) : null}
        </Stack>
      )}
    </Stack>
  )
}
