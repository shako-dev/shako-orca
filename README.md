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

2. A page opens in your browser: sign up or sign in, and approve this computer. If you close it,
   press **Shako: sign up** in the status bar to open it again.

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
- `shako login` on its first start when you are not signed in, and when you press the status bar
  item or **Sign up or sign in**. The CLI opens the sign-up page in your browser.
- `orca plugin open`, Orca's own command, to show the Shako panel: on its first start, after you
  sign in, and when you press the status bar item.
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
