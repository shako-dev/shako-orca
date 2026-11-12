# Shako for Orca

[Shako](https://shako.dev) cloud VMs for [Orca](https://github.com/stablyai/orca). VMs sleep when
idle and wake in about a second. Your agents create them and host apps on them.

This repository holds two things:

- **The Orca plugin** (repository root, `orca-plugin.json`). When you install it, it installs the
  `shako` CLI and the Shako skill with their official installers. The Shako panel (right sidebar)
  then signs you up or in: approving in the browser registers this computer's SSH key with your
  account. After that the panel shows your VMs and your credit, with how long it lasts at the
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

2. Open the **Shako** panel in the right sidebar and press **Sign up or sign in**.

Then ask any agent: *"Create a Shako VM and host this app."*

To install only the skill, without the plugin:

```
npx -y skills add https://github.com/shako-dev/shako-orca --skill shako --global -y
```

## What the plugin does on your computer

It asks Orca for full access (`trusted-worker`), notifications and its own storage. With it, it runs:

- On its first start, only what is missing: the CLI installer
  (`curl -fsSL https://shako.dev/install.sh | sh`) and the skill installer (the `npx` command above).
  The panel's buttons run the same commands again after a failure.
- `shako login` when you press **Sign up or sign in**.
- `shako version`, `shako whoami`, `shako vm ls` and `shako credit show`, at start, every 5 minutes
  and when you press refresh.

It writes no files itself and sends nothing anywhere; the `shako` CLI talks to Shako. Its storage
holds one flag: whether the first start is done.

## Requirements

macOS or Linux (on Windows, Orca in WSL), `curl`, python3 3.10 or newer for the CLI, and Node.js
(`npx`) for the skill installer.

## Develop

```
node --test test/shako.test.mjs
orca plugin validate . --json
orca plugin check . --json
orca plugin dev load .
```

## License

MIT
