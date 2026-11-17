# Shako for Orca

[Shako](https://shako.dev) cloud VMs for [Orca](https://github.com/stablyai/orca). VMs sleep when
idle and wake in about a second. Your agents create them and host apps on them.

This repository holds two things:

- **The Orca plugin** (repository root, `orca-plugin.json`). When you install it, it opens the
  Shako panel (right sidebar), installs the `shako` CLI and the Shako skill with their official
  installers, and opens the sign-up page in your browser. Approving there registers this
  computer's SSH key with your account, and the panel then shows your VMs. After that the panel shows your VMs and your credit, with how long it lasts at the
  current spend. The status bar shows the balance, amber under 14 days and red under 3.
- **The Shako skill** (`skills/shako/SKILL.md`). It teaches your coding agents (Claude Code, Codex,
  Cursor, Gemini, ...) to create VMs, host a web app at a public URL, run a private service or a
  background job, and manage VMs.

## Install

1. In a terminal inside Orca:

   ```
   orca plugin install shako-dev/shako-orca@main
   ```

   Orca prints what the plugin may do and a fingerprint. Run the same command again with
   `--approve <fingerprint>`.

2. Open the **Shako** panel in the right sidebar. In step 3, **Log In and Register Machine**, press **Log in or sign
   up** and finish in your browser. The panel then shows your VMs.

Then ask any agent: *"Create a Shako VM and host this app."*

To install only the skill, without the plugin:

```
npx -y skills add https://github.com/shako-dev/shako-orca --skill shako --global -y
```

## One VM per workspace (Orca's Cloud VM, macOS and Linux)

The plugin also adds Orca's VM recipe **Shako VM**: a workspace on it gets its own new VM, which is deleted with the
workspace.

1. In Orca: Settings → Experimental → **Cloud VM**, on.
2. Create a workspace and choose **Shako VM** under **Run on**.

The VM clones the project from its Git host itself, so no code is uploaded from your laptop: a large repo
takes seconds, not minutes. The recipe reads no token on your computer and forwards no SSH agent. A public repo needs
no access. For a private GitHub repo, save your GitHub token once as a Shako secret:

```sh
gh auth token | shako secret set GH_TOKEN --host github.com --host api.github.com
```

Shako keeps it encrypted, and it never goes into a VM. Each of your VMs gets only a placeholder
(`GH_TOKEN=shako-secret-GH_TOKEN`, and a Git credential with the same value), and Shako puts the real token in
place of the placeholder only in the VM's requests to GitHub. So `git clone`, `git push` and `gh` work in every VM,
and Orca's check of `origin` passes. A fine-grained token that covers only your repositories works the same way.
`shako secret ls` lists your secrets, and `shako secret rm GH_TOKEN` removes the token from all your VMs. When the
clone fails, the recipe stops and prints this command. The workspace's start commit must be pushed; if it is not,
the recipe stops at once and says so. Nothing waits for input.

The VM is a copy of your VM `orca-base` when you have one, so its agents stay logged in: make one, log in your
agents there, and every workspace starts ready. Without it, each workspace gets a new small VM with Claude Code and
Codex. The VM sleeps when idle. The recipe (`recipes/shako-vm.json`) is a short shell script per phase over the
`shako` CLI (`vm create`, `vm cp`, `vm info`, `vm wake`, `vm sleep`, `vm rm`) and `ssh`.

## What the plugin does on your computer

It asks Orca for full access (`trusted-worker`), notifications and its own storage. With it, it runs:

- On its first start, only what is missing: the CLI installer (`curl -fsSL https://shako.dev/install.sh | sh`;
  on Windows, `irm https://shako.dev/install.ps1 | iex` in PowerShell) and the skill installer (the `npx`
  command above).
  The panel's buttons run the same commands again after a failure.
- `shako login` on its first start when you are not logged in, and when you press **Log in or sign up**.
  The CLI opens the log-in or sign-up page in your browser.
- `orca plugin open`, Orca's own command, to show the Shako panel: on its first start, after you
  sign in, and when you press the status bar item.
- `shako version`, `shako whoami`, `shako vm ls`, `shako vm info <vm>` (awake VMs) and
  `shako credit show`, at start, every 5 minutes and when you press refresh.
- `shako update`, the CLI's own updater, at start when due and then once a day, so the CLI stays
  current with no step for you.
- `orca host list`, and `orca host rm` for the Orca host of a VM that no longer exists.

It writes no files itself and sends nothing anywhere; the `shako` CLI talks to Shako. Its storage
holds one flag: whether the first start is done.

## Requirements

macOS, Linux or Windows 10/11 (the shako CLI is one file for each). Node.js (`npx`) for the skill installer.
The **Shako VM** recipe needs macOS or Linux for now: on Windows, Orca runs a recipe's commands in `cmd.exe`, and
the recipe is a shell script.

## Develop

```
node --test test/shako.test.mjs test/vm-options.test.mjs
orca plugin validate . --json
orca plugin check . --json
orca plugin dev load .
```

## Support

https://discord.gg/Q93fEaF3A

## License

MIT
