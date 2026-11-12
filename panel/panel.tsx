// The Shako panel: setup until it is done (the worker installs the CLI and the skill by itself on its
// first start; signing in needs the person), then the credit and the VMs.
import {
  atom,
  Badge,
  Box,
  Button,
  Callout,
  Card,
  Code,
  CodeView,
  EmptyState,
  Heading,
  IconButton,
  plugin,
  Progress,
  read,
  RelativeTime,
  Row,
  set,
  shell,
  Spinner,
  Stack,
  Text,
  type PanelContext
} from 'orca'
import type { ShakoRequest, ShakoState, Usage, Vm } from './protocol'

const state = atom<ShakoState | null>(null)
const failure = atom<string | null>(null)

async function ask(name: ShakoRequest) {
  try {
    set(failure, null)
    set(state, await plugin.request(name, {}, { timeoutMs: 90_000 }))
  } catch (error) {
    set(failure, (error as Error).message)
  }
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('shako.state', (next) => set(state, next)))
  void ask('shako.refresh')
}

const open = (url: string) => void shell.openExternal(url)

function dollars(value: number | null): string {
  if (value === null) return '?'
  if (value > 0 && value < 0.01) return '<$0.01'
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(2)}`
}

function stateTone(vmState: string): 'success' | 'neutral' | 'warning' {
  if (vmState === 'awake') return 'success'
  if (vmState === 'asleep') return 'neutral'
  return 'warning'
}

function Step({ title, done, children }: { title: string; done: boolean; children?: unknown }) {
  return (
    <Stack gap="xs">
      <Row justify="between">
        <Text weight="medium">{title}</Text>
        <Badge tone={done ? 'success' : 'neutral'}>{done ? 'Done' : 'To do'}</Badge>
      </Row>
      {done ? null : children}
    </Stack>
  )
}

function Setup({ s }: { s: ShakoState }) {
  return (
    <Card title="Setup" description="Three steps. Only signing in needs you.">
      <Stack gap="md">
        <Step title="1. Shako CLI" done={s.cli.found}>
          {s.install.running ? (
            <Spinner label="Installing the CLI" />
          ) : (
            <Stack gap="xs">
              {s.install.error ? <Callout tone="danger" title="Install failed">{s.install.error}</Callout> : null}
              <CodeView code={s.install.command} language="shell" wrap />
              <Button icon="download" onPress={() => ask('shako.installCli')}>
                Install the CLI
              </Button>
            </Stack>
          )}
        </Step>
        <Step title="2. Account" done={s.account.signedIn}>
          {s.login.running ? (
            <Stack gap="xs">
              <Spinner label="Waiting for your approval in the browser" />
              {s.login.link ? (
                <Button icon="open-external" variant="outline" onPress={() => open(s.login.link!)}>
                  Open the approval page
                </Button>
              ) : null}
              <Button variant="ghost" onPress={() => ask('shako.cancelLogin')}>
                Cancel
              </Button>
            </Stack>
          ) : (
            <Stack gap="xs">
              <Text muted size="sm">
                Sign up or sign in. Approving in the browser registers this computer's SSH key ({s.login.keyName}).
              </Text>
              {s.login.error ? <Callout tone="danger" title="Sign-in did not finish">{s.login.error}</Callout> : null}
              <Button icon="link" disabled={!s.cli.found} onPress={() => ask('shako.login')}>
                Sign up or sign in
              </Button>
            </Stack>
          )}
        </Step>
        <Step title="3. Skill for your agents" done={s.skill.installed}>
          {s.skill.running ? (
            <Spinner label="Installing the skill" />
          ) : (
            <Stack gap="xs">
              <Text muted size="sm">Teaches every agent, in every project, to create VMs and host apps.</Text>
              {s.skill.error ? <Callout tone="danger" title="Install failed">{s.skill.error}</Callout> : null}
              <CodeView code={s.skill.command} language="shell" wrap />
              <Button icon="download" onPress={() => ask('shako.installSkill')}>
                Install the skill
              </Button>
            </Stack>
          )}
        </Step>
      </Stack>
    </Card>
  )
}

/** One compact row: the balance, what it costs a day and how long it lasts, and Top up. */
function CreditCard({ s }: { s: ShakoState }) {
  const c = s.credit
  const low = c !== null && c.tone !== 'success'
  const topUp = (
    <Button icon="open-external" size="sm" variant={low ? 'solid' : 'outline'} onPress={() => open(s.workspaceUrl)}>
      Top up
    </Button>
  )
  return (
    <Box border radius="md" padding="sm" direction="column" gap="xs">
      <Row justify="between">
        <Stack gap="none">
          <Text weight="semibold">{c ? `Credit ${dollars(c.balance)}` : 'Credit'}</Text>
          <Text size="sm" muted={!low} tone={low ? c!.tone : undefined}>
            {!c
              ? 'Could not read it. Press refresh.'
              : c.days === null || c.perDay === null
                ? c.runway
                : `${dollars(c.perDay)} a day · lasts ${c.runway}`}
          </Text>
        </Stack>
        {topUp}
      </Row>
      {low ? (
        <Text size="sm" tone={c!.tone}>
          Running low. A VM stops when the credit runs out.
        </Text>
      ) : null}
    </Box>
  )
}

function usageLabel(name: string, u: Usage): string {
  return `${name} ${u.usedGb} of ${u.totalGb} GB (${u.percent}%)`
}

function orcaHostText(vm: Vm): string {
  if (!vm.orcaHost) return 'Orca: not an SSH host yet'
  return vm.orcaHost.connected ? 'Orca: connected' : 'Orca: SSH host, choose it under Run on'
}

/** A VM: its state, its SSH name, what it uses, and whether Orca has it as an SSH host. */
function VmRow({ vm, s }: { vm: Vm; s: ShakoState }) {
  return (
    <Box border radius="md" padding="sm" direction="column" gap="xs">
      <Row justify="between">
        <Text weight="semibold" truncate>
          {vm.name}
        </Text>
        <Badge tone={stateTone(vm.state)}>{vm.state}</Badge>
      </Row>
      {vm.ssh ? (
        <Text size="sm" truncate>
          <Code>{`ssh ${vm.ssh}`}</Code>
        </Text>
      ) : null}
      <Text muted size="sm">
        {`${vm.size} · ${vm.disk} disk · active ${vm.active}`}
      </Text>
      {vm.ramUse ? <Progress label={usageLabel('RAM', vm.ramUse)} value={vm.ramUse.percent} /> : null}
      {vm.diskUse ? <Progress label={usageLabel('Disk', vm.diskUse)} value={vm.diskUse.percent} /> : null}
      {!vm.ramUse && vm.state === 'asleep' ? (
        <Text muted size="sm">
          Asleep: no live use. SSH or a request wakes it.
        </Text>
      ) : null}
      {s.orcaHostsKnown ? (
        <Text muted size="sm">
          {orcaHostText(vm)}
        </Text>
      ) : null}
    </Box>
  )
}

function VmList({ s }: { s: ShakoState }) {
  return (
    <Card title={`VMs (${s.vms.length})`}>
      <Stack gap="sm">
        {s.vmsError ? <Callout tone="danger">{s.vmsError}</Callout> : null}
        {s.vms.length === 0 && !s.vmsError ? (
          <EmptyState
            icon="cloud"
            title="No VMs yet"
            description='Ask any agent: "Create a Shako VM and host this app."'
          />
        ) : (
          s.vms.map((vm) => <VmRow vm={vm} s={s} />)
        )}
      </Stack>
    </Card>
  )
}

export default function Panel() {
  const s = read(state)
  const error = read(failure)
  const setupDone = s ? s.cli.found && s.account.signedIn && s.skill.installed : false
  return (
    <Stack gap="md">
      <Row justify="between">
        <Stack gap="none">
          <Heading>Shako</Heading>
          {s?.account.signedIn ? (
            <Text muted size="sm">
              {`${s.account.tenant} · ${s.account.email ?? ''}`}
            </Text>
          ) : null}
        </Stack>
        <IconButton icon="refresh" label="Refresh" onPress={() => ask('shako.refresh')} />
      </Row>
      {error ? <Callout tone="danger">{error}</Callout> : null}
      {!s ? (
        <Spinner label="Checking setup" />
      ) : !s.supported ? (
        <Callout tone="warning" title="Not supported here">
          Shako needs macOS or Linux. On Windows, use Orca in WSL.
        </Callout>
      ) : (
        <Stack gap="md">
          {setupDone ? null : <Setup s={s} />}
          {s.account.signedIn ? <CreditCard s={s} /> : null}
          {s.account.signedIn ? <VmList s={s} /> : null}
          {s.updatedAt ? (
            <Text muted size="xs">
              Updated <RelativeTime at={s.updatedAt} />
              {s.cli.version ? ` · shako ${s.cli.version}` : ''}
            </Text>
          ) : null}
          {s.cliUpdate && !s.cliUpdate.ok ? (
            <Text tone="warning" size="xs">
              {`CLI update failed: ${s.cliUpdate.message}`}
            </Text>
          ) : null}
        </Stack>
      )}
    </Stack>
  )
}
