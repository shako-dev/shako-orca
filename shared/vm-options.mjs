// What a new VM can be, the same choices as the web workspace's New VM form. The panel and the worker
// both import this file, so it imports nothing (a panel cannot import Node).
// Sizes: shako_common/sizes.py. Agents: shako_common/agents.py. Recommendation: shako-ui lib/vm-size.ts.

export const SIZES = [
  { id: 'small', title: 'Small', vcpus: 1, memGb: 2 },
  { id: 'mid', title: 'Mid', vcpus: 2, memGb: 4 },
  { id: 'large', title: 'Large', vcpus: 4, memGb: 8 },
  { id: 'xl', title: 'XL', vcpus: 4, memGb: 16 }
]
export const DEFAULT_SIZE = 'small'
/** Browser use and computer use need an agent and this size or bigger. */
export const DESKTOP_MIN_SIZE = 'mid'

export const AGENTS = [
  { id: 'claude', title: 'Claude Code', size: 'small' },
  { id: 'codex', title: 'Codex', size: 'small' },
  { id: 'opencode', title: 'OpenCode', size: 'small' },
  { id: 'pi', title: 'Pi', size: 'small' },
  { id: 'openclaw', title: 'OpenClaw', size: 'small' },
  { id: 'hermes', title: 'Hermes', size: 'mid' }
]

const byId = (id) => SIZES.find((s) => s.id === id)

/** Has size a less memory than size b? Equal memory: fewer vCPUs. */
export function isSmaller(a, b) {
  const [x, y] = [byId(a), byId(b)]
  return x.memGb < y.memGb || (x.memGb === y.memGb && x.vcpus < y.vcpus)
}

/** The smallest size that fits every chosen agent and the screen, or null with no agent. */
export function recommendedSize(agents, desktop) {
  if (!agents.length) return null
  const wanted = [...agents.map((id) => AGENTS.find((a) => a.id === id)?.size ?? 'small')]
  if (desktop) wanted.push(DESKTOP_MIN_SIZE)
  return wanted.reduce((big, size) => (isSmaller(big, size) ? size : big))
}

/** The mark of a size such as "4cpu/8G": S, M, L or XL, and C for a custom size. */
export function sizeMark(size) {
  const m = /^(\d+)cpu\/(\d+(?:\.\d+)?)([GM])$/.exec(String(size))
  if (!m) return 'C'
  const memGb = m[3] === 'G' ? Number(m[2]) : Number(m[2]) / 1024
  const named = SIZES.find((s) => s.vcpus === Number(m[1]) && s.memGb === memGb)
  return named ? { small: 'S', mid: 'M', large: 'L', xl: 'XL' }[named.id] : 'C'
}

/** Why a VM name is refused, or null: a-z, 0-9 and single hyphens, a letter first, at most 31. */
export function vmNameError(name) {
  if (!name) return 'Give the VM a name.'
  if (name.length > 31) return 'At most 31 characters.'
  if (!/^[a-z](?:[a-z0-9]|-(?=[a-z0-9]))*$/.test(name)) {
    return 'Use a-z, 0-9 and single hyphens, and start with a letter.'
  }
  return null
}

/** Why a new VM's choices are refused, or null. The box refuses the same. */
export function createError({ name, size, agents, desktop }) {
  const nameError = vmNameError(name)
  if (nameError) return nameError
  if (!byId(size)) return 'Choose a size.'
  if (!Array.isArray(agents) || agents.some((id) => !AGENTS.some((a) => a.id === id))) return 'Unknown agent.'
  if (desktop && !agents.length) return 'Browser use and computer use need an agent.'
  if (desktop && isSmaller(size, DESKTOP_MIN_SIZE)) return 'Browser use and computer use need size Mid or bigger.'
  return null
}

/** The shako command line for a new VM: `vm create <name> --size <s> [--agent a,b] [--desktop] --no-wait`. */
export function createArgs(choice) {
  const error = createError(choice)
  if (error) throw new Error(error)
  const args = ['vm', 'create', choice.name, '--size', choice.size]
  if (choice.agents.length) args.push('--agent', choice.agents.join(','))
  if (choice.desktop) args.push('--desktop')
  args.push('--no-wait')
  return args
}
