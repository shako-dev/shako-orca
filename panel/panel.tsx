// The Shako panel. Until setup is done: the three setup steps (the worker installs the CLI and the
// skill by itself on its first start; signing in needs the person). Then two sections: Overview
// (VMs, RAM, disk, awake and asleep, credit, run rate, Top up) and VMs (Create VM, one card each).
// Dense on purpose: a sidebar is narrow, and a deep page hides the VMs.
import {
  atom,
  Badge,
  Box,
  Button,
  Checkbox,
  Code,
  CodeView,
  EmptyState,
  Grid,
  IconButton,
  Input,
  plugin,
  Progress,
  read,
  RelativeTime,
  Row,
  Select,
  set,
  shell,
  Spinner,
  Stack,
  Switch,
  Text,
  update,
  type PanelContext
} from 'orca'
import type { NewVm, ShakoRequest, ShakoState, Usage, Vm } from './protocol'
import {
  AGENTS,
  DEFAULT_SIZE,
  DESKTOP_MIN_SIZE,
  SIZES,
  createError,
  isSmaller,
  recommendedSize,
  sizeMark
} from '../shared/vm-options.mjs'

const state = atom<ShakoState | null>(null)
const failure = atom<string | null>(null)
/** VM cards the person folded; kept across panel runs. */
const folded = atom<string[]>('foldedVms', [], { persist: 'plugin' })
const formOpen = atom(false)
const draft = atom<NewVm>({ name: '', size: DEFAULT_SIZE, agents: [], desktop: false })
const copiedName = atom<string | null>(null)

async function ask(name: ShakoRequest, input: object = {}) {
  try {
    set(failure, null)
    const next = await plugin.request(name as 'shako.refresh', input as Record<string, never>, { timeoutMs: 120_000 })
    set(state, next)
    return next
  } catch (error) {
    set(failure, (error as Error).message)
    return null
  }
}

export function setup(ctx: PanelContext): void {
  ctx.subscriptions.push(plugin.on('shako.state', (next) => set(state, next)))
  void ask('shako.refresh')
}

const open = (url: string) => void shell.openExternal(url)

function dollars(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined) return '?'
  if (value > 0 && value < 0.01) return '<$0.01'
  return `${value < 0 ? '-' : ''}$${Math.abs(value).toFixed(digits)}`
}

function Label({ children }: { children: string }) {
  return (
    <Text muted size="xs">
      {children}
    </Text>
  )
}

// ---- Setup (only until it is done) ----

function Step({ title, done, children }: { title: string; done: boolean; children?: unknown }) {
  return (
    <Stack gap="xs">
      <Row justify="between">
        <Text size="sm" weight="medium">
          {title}
        </Text>
        <Badge tone={done ? 'success' : 'neutral'}>{done ? 'Done' : 'To do'}</Badge>
      </Row>
      {done ? null : children}
    </Stack>
  )
}

function Setup({ s }: { s: ShakoState }) {
  return (
    <Box border radius="md" padding="sm" direction="column" gap="sm">
      <Text weight="semibold" size="sm">
        Setup
      </Text>
      <Step title="1. Shako CLI" done={s.cli.found}>
        {s.install.running ? (
          <Spinner label="Installing the CLI" />
        ) : (
          <Stack gap="xs">
            {s.install.error ? <Text tone="danger" size="sm">{`Install failed: ${s.install.error}`}</Text> : null}
            <CodeView code={s.install.command} language="shell" wrap />
            <Button size="sm" icon="download" onPress={() => ask('shako.installCli')}>
              Install the CLI
            </Button>
          </Stack>
        )}
      </Step>
      <Step title="2. Account" done={s.account.signedIn}>
        {s.login.running ? (
          <Stack gap="xs">
            <Spinner label="Waiting for your approval in the browser" />
            <Row gap="xs">
              {s.login.link ? (
                <Button size="sm" icon="open-external" variant="outline" onPress={() => open(s.login.link!)}>
                  Open the page
                </Button>
              ) : null}
              <Button size="sm" variant="ghost" onPress={() => ask('shako.cancelLogin')}>
                Cancel
              </Button>
            </Row>
          </Stack>
        ) : (
          <Stack gap="xs">
            <Text muted size="sm">
              {`Sign up or sign in. Approving in the browser registers this computer's SSH key (${s.login.keyName}).`}
            </Text>
            {s.login.error ? <Text tone="danger" size="sm">{s.login.error}</Text> : null}
            <Button size="sm" icon="link" disabled={!s.cli.found} onPress={() => ask('shako.login')}>
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
            {s.skill.error ? <Text tone="danger" size="sm">{`Install failed: ${s.skill.error}`}</Text> : null}
            <CodeView code={s.skill.command} language="shell" wrap />
            <Button size="sm" icon="download" onPress={() => ask('shako.installSkill')}>
              Install the skill
            </Button>
          </Stack>
        )}
      </Step>
    </Box>
  )
}

// ---- Overview ----

function Cell({ label, value, tone }: { label: string; value: string; tone?: 'warning' | 'danger' }) {
  return (
    <Stack gap="none">
      <Label>{label}</Label>
      <Text size="sm" weight="medium" tone={tone}>
        {value}
      </Text>
    </Stack>
  )
}

function Overview({ s }: { s: ShakoState }) {
  const o = s.overview
  const c = s.credit
  const low = c && c.tone !== 'success' ? c.tone : undefined
  return (
    <Box border radius="md" padding="sm" direction="column" gap="xs">
      <Row justify="between">
        <Text weight="semibold" size="sm">
          Overview
        </Text>
        <Button size="xs" variant={low ? 'solid' : 'ghost'} icon="open-external" onPress={() => open(s.workspaceUrl)}>
          Top up
        </Button>
      </Row>
      <Grid columns={3} gap="xs">
        <Cell label="VMs" value={o ? String(o.total) : '?'} />
        <Cell label="Awake" value={o ? String(o.awake) : '?'} />
        <Cell label="Asleep" value={o ? String(o.asleep) : '?'} />
        <Cell label="RAM" value={o ? `${o.ramGb} GB` : '?'} />
        <Cell label="Disk" value={o ? `${o.diskGb} GB` : '?'} />
        <Cell label="Credit" value={c ? dollars(c.balance) : '?'} tone={low} />
        <Cell label="Run rate" value={c?.perDay !== null && c?.perDay !== undefined ? `${dollars(c.perDay)}/day` : '?'} />
        <Cell label="Per hour" value={c?.perHour !== null && c?.perHour !== undefined ? dollars(c.perHour, 3) : '?'} />
        <Cell label="Lasts" value={c ? c.runway.replace(/^about /, '~').replace('more than a year', '1+ year') : '?'} tone={low} />
      </Grid>
      {low ? (
        <Text size="xs" tone={low}>
          Credit is running low. A VM stops when the credit runs out.
        </Text>
      ) : null}
    </Box>
  )
}

// ---- Create VM: the web workspace's choices ----

function CreateForm({ s }: { s: ShakoState }) {
  const d = read(draft)
  const error = d.name ? createError(d) : null
  const recommended = recommendedSize(d.agents, d.desktop)
  const create = async () => {
    const next = await ask('shako.createVm', d)
    if (next && !next.createError) {
      set(formOpen, false)
      set(draft, { name: '', size: DEFAULT_SIZE, agents: [], desktop: false })
    }
  }
  const toggleAgent = (id: string, on: boolean) =>
    update(draft, (prev) => {
      const agents = AGENTS.map((a) => a.id).filter((a) => (a === id ? on : prev.agents.includes(a)))
      return { ...prev, agents, desktop: agents.length ? prev.desktop : false }
    })
  return (
    <Box border radius="md" padding="sm" direction="column" gap="xs" background="muted">
      <Input
        label="Name"
        placeholder="web1"
        value={d.name}
        maxLength={31}
        invalid={Boolean(d.name && error && error.startsWith('Use'))}
        onChange={(name) => update(draft, (prev) => ({ ...prev, name: name.trim().toLowerCase() }))}
        onSubmit={() => (error ? undefined : void create())}
      />
      <Label>Agents</Label>
      <Row gap="sm" wrap>
        {AGENTS.map((agent) => (
          <Checkbox label={agent.title} checked={d.agents.includes(agent.id)} onChange={(on) => toggleAgent(agent.id, on)} />
        ))}
      </Row>
      <Switch
        label="Browser use and computer use"
        checked={d.desktop}
        disabled={d.agents.length === 0}
        onChange={(desktop) =>
          update(draft, (prev) => ({
            ...prev,
            desktop,
            size: desktop && isSmaller(prev.size, DESKTOP_MIN_SIZE) ? DESKTOP_MIN_SIZE : prev.size
          }))
        }
      />
      <Select
        label="Size"
        value={d.size}
        options={SIZES.map((size) => ({
          value: size.id,
          label: `${size.title} · ${size.vcpus} vCPU · ${size.memGb} GB · ${size.memGb * 8} GB disk`
        }))}
        onChange={(size) => update(draft, (prev) => ({ ...prev, size }))}
      />
      {recommended ? (
        <Text size="xs" muted={!isSmaller(d.size, recommended)} tone={isSmaller(d.size, recommended) ? 'warning' : undefined}>
          {`Recommended: ${SIZES.find((x) => x.id === recommended)?.title}${isSmaller(d.size, recommended) ? '. This size may be too small.' : ''}`}
        </Text>
      ) : null}
      {error && d.name ? <Text size="xs" tone="danger">{error}</Text> : null}
      {s.createError ? <Text size="xs" tone="danger">{s.createError}</Text> : null}
      <Row gap="xs">
        <Button size="sm" icon="add" disabled={!d.name || Boolean(error) || Boolean(s.busy[d.name])} onPress={() => void create()}>
          {s.busy[d.name] ? 'Creating…' : 'Create'}
        </Button>
        <Button size="sm" variant="ghost" onPress={() => set(formOpen, false)}>
          Cancel
        </Button>
      </Row>
    </Box>
  )
}

// ---- VM cards ----

function usageLabel(name: string, u: Usage): string {
  return `${name} ${u.usedGb} / ${u.totalGb} GB · ${u.percent}%`
}

async function copySsh(vm: Vm) {
  const result = await plugin.request('shako.copy', { text: `ssh ${vm.ssh}` })
  set(copiedName, result.copied ? vm.name : null)
  if (result.copied) setTimeout(() => set(copiedName, null), 1500)
  else set(failure, 'Could not copy: no clipboard tool on this computer (pbcopy, wl-copy or xclip).')
}

function VmCard({ vm, s }: { vm: Vm; s: ShakoState }) {
  const isOpen = !read(folded).includes(vm.name)
  const busy = s.busy[vm.name]
  const awake = vm.state === 'awake'
  const fold = () =>
    update(folded, (names) => (isOpen ? [...names, vm.name] : names.filter((n) => n !== vm.name)))
  return (
    <Box border radius="md" direction="column">
      <Box background="muted" radius="md" paddingX="xs" paddingY="xs" direction="row" align="center" justify="between">
        <Row gap="xs" align="center">
          <IconButton icon={isOpen ? 'collapse' : 'expand'} label={isOpen ? 'Fold' : 'Unfold'} size="xs" variant="ghost" onPress={fold} />
          <Text size="sm" tone={awake ? 'success' : undefined} muted={!awake}>
            ●
          </Text>
          <Text weight="semibold" size="sm" truncate>
            {vm.name}
          </Text>
          <Badge>{sizeMark(vm.size)}</Badge>
        </Row>
        {busy ? (
          <Spinner label={busy} labelHidden />
        ) : (
          <IconButton
            icon={awake ? 'pause' : 'play'}
            label={awake ? `Sleep ${vm.name}` : `Wake ${vm.name}`}
            tooltip={awake ? 'Sleep now' : 'Wake now'}
            size="xs"
            variant="ghost"
            disabled={vm.state !== 'awake' && vm.state !== 'asleep'}
            onPress={() => ask('shako.power', { name: vm.name, action: awake ? 'sleep' : 'wake' })}
          />
        )}
      </Box>
      {isOpen ? (
        <Box paddingX="sm" paddingY="xs" direction="column" gap="xs">
          <Text muted size="xs">
            {`${vm.state} · ${vm.size} · ${vm.disk} disk · active ${vm.active}`}
          </Text>
          <Label>Utilization</Label>
          {vm.ramUse ? <Progress label={usageLabel('RAM', vm.ramUse)} value={vm.ramUse.percent} /> : null}
          {vm.diskUse ? <Progress label={usageLabel('Disk', vm.diskUse)} value={vm.diskUse.percent} /> : null}
          {!vm.ramUse ? (
            <Text muted size="xs">
              {awake ? 'No reading yet.' : 'Asleep: no live use. SSH or a request wakes it.'}
            </Text>
          ) : null}
          <Label>SSH</Label>
          <Row gap="xs" align="center" justify="between">
            <Text size="sm" truncate>
              <Code>{vm.ssh ? `ssh ${vm.ssh}` : '?'}</Code>
            </Text>
            <IconButton
              icon={read(copiedName) === vm.name ? 'check' : 'copy'}
              label={`Copy the ssh command of ${vm.name}`}
              tooltip="Copy"
              size="xs"
              variant="ghost"
              disabled={!vm.ssh}
              onPress={() => void copySsh(vm)}
            />
          </Row>
        </Box>
      ) : null}
    </Box>
  )
}

function Vms({ s }: { s: ShakoState }) {
  const isFormOpen = read(formOpen)
  return (
    <Box border radius="md" padding="sm" direction="column" gap="xs">
      <Row justify="between">
        <Text weight="semibold" size="sm">
          {`VMs (${s.vms.length})`}
        </Text>
        <Button size="xs" icon="add" variant={isFormOpen ? 'ghost' : 'outline'} onPress={() => set(formOpen, !isFormOpen)}>
          Create VM
        </Button>
      </Row>
      {isFormOpen ? <CreateForm s={s} /> : null}
      {s.vmsError ? <Text tone="danger" size="sm">{s.vmsError}</Text> : null}
      {s.vms.length === 0 && !s.vmsError ? (
        <EmptyState icon="cloud" title="No VMs yet" description='Press Create VM, or ask an agent: "Create a Shako VM and host this app."' />
      ) : (
        s.vms.map((vm) => <VmCard vm={vm} s={s} />)
      )}
    </Box>
  )
}

export default function Panel() {
  const s = read(state)
  const error = read(failure)
  const setupDone = s ? s.cli.found && s.account.signedIn && s.skill.installed : false
  return (
    <Stack gap="sm">
      <Row justify="between">
        <Text weight="semibold">{s?.account.signedIn ? `Shako · ${s.account.tenant}` : 'Shako'}</Text>
        <IconButton icon="refresh" label="Refresh" size="xs" variant="ghost" onPress={() => ask('shako.refresh')} />
      </Row>
      {error ? <Text tone="danger" size="sm">{error}</Text> : null}
      {!s ? (
        <Spinner label="Checking setup" />
      ) : !s.supported ? (
        <Text tone="warning" size="sm">
          Shako needs macOS or Linux. On Windows, use Orca in WSL.
        </Text>
      ) : (
        <Stack gap="sm">
          {setupDone ? null : <Setup s={s} />}
          {s.account.signedIn ? <Overview s={s} /> : null}
          {s.account.signedIn ? <Vms s={s} /> : null}
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
