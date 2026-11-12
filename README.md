# Shako for Orca

[Shako](https://shako.dev) cloud VMs for [Orca](https://github.com/stablyai/orca). VMs sleep when
idle and wake in about a second. Your agents create them and host apps on them.

This repository holds two things:

- **The Orca plugin** (repository root, `orca-plugin.json`). A Shako panel walks you through setup:
  it installs the `shako` CLI, then signs you up or in. Approving in the browser registers this
  computer's SSH key with your account. A status bar item shows whether you are signed in.
- **The Shako skill** (`skills/shako/SKILL.md`). It teaches your coding agents (Claude Code, Codex,
  Cursor, Gemini, ...) to create VMs, host a web app at a public URL, run a private service or a
  background job, and manage VMs.

## Install

1. **The plugin.** In Orca: Settings → Plugins, find **Shako**, press Install and approve. Or, from
   a terminal:

   ```
   orca plugin install fwanggg/shako-orca
   ```

2. **Setup.** Open the **Shako** panel in the sidebar: install the CLI, then sign up or sign in.

3. **The skill**, once, in any terminal. It installs for every agent and every project:

   ```
   npx skills add https://github.com/fwanggg/shako-orca --skill shako --global -y
   ```

Then ask any agent: *"Create a Shako VM and host this app."*

## What the plugin asks for

- **Full access (`trusted-worker`).** The worker runs the official CLI installer
  (`curl -fsSL https://shako.dev/install.sh | sh`) when you press Install, and `shako login` when you
  press Sign in. It runs `shako version` and `shako whoami` to show the setup state.
- **Notifications** and **its own storage** (one flag: whether it showed the welcome notification).

It writes no files itself and sends nothing anywhere; the `shako` CLI talks to Shako.

## Requirements

macOS or Linux (on Windows, Orca in WSL), `curl`, and python3 3.10 or newer for the CLI.

## Develop

```
node --test test/shako.test.mjs
orca plugin validate . --json
orca plugin dev load .
```

## License

MIT
