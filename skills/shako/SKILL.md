---
name: shako
description: >-
  Create and manage Shako cloud VMs with the `shako` CLI, and host things on them: a web app or
  API at a public HTTPS URL, a private service (database, admin tool, preview) only the user's
  devices can open, or a background job, bot or cron. Use when the user asks to create, get or use
  a VM, server, box or remote machine, or to host, deploy, publish, share, put online or keep
  running an app, site, API, service, bot or job. Also use to list, wake, sleep, resize or delete
  Shako VMs, or to share or stop sharing a VM's port.
---

# Shako VMs

Shako VMs are small Linux VMs (Ubuntu, user `shako`, passwordless `sudo`). A VM sleeps when it is
quiet and wakes in about a second when a request, an SSH login or a cron job comes. Memory survives
a sleep, so running programs continue after a wake. The user pays per hour, less when asleep.

## 0. Check the setup first

Run `shako whoami`.

- **Command not found:** try `~/.local/bin/shako whoami`. If that also fails, the CLI is not
  installed. Ask the user to open the Shako panel in Orca, or to run
  `curl -fsSL https://shako.dev/install.sh | sh` (needs python3 3.10+).
- **Not logged in:** ask the user to run `shako login`. It opens a browser page where they sign
  up or sign in and approve this computer; the approval registers this computer's SSH key. You
  cannot approve for them.
- **Works:** the output names the tenant and the SSH and URL patterns, for example:

  ```
  tenant acme (me@example.com): 2 VMs, 1 keys
  ssh names  <vm>.acme.shako.dev
  app URLs   https://<vm>-<port>--acme.shakoapp.dev
  ```

  Use those exact patterns below. Never guess the tenant.

Run `shako <noun> <verb> --help` before using a command you have not used in this task.

## Rules

- **VM names:** `a-z`, `0-9` and single hyphens, start with a letter, at most 31 characters. The
  name is in the VM's SSH name and its URLs. Pick a short name from the project (`myapp`) and tell
  the user.
- **Ask before:** `shako vm rm` (deletes the disk, no undo), sharing a port `public` that the user
  did not ask to make public, `--sleep never` (it costs the awake price all the time), and any
  size above `small`.
- **Secrets:** copy `.env` files only when the user agrees. Never print secrets.
- **Listen on `0.0.0.0`,** not `127.0.0.1`, for a port you share.
- Prefer `shako vm ls` and `shako port ls <vm>` to find what exists before you make more.

## 1. Create a VM

```
shako vm create <name>                  # small: 1 vCPU, 2 GB. --size mid|large|xl for more
shako vm ls                             # all VMs and their state
ssh <name>.<tenant>.shako.dev 'uname -a'   # check SSH works
```

Run commands in the VM with `ssh <name>.<tenant>.shako.dev '<command>'`. For long jobs, use
`tmux` or a systemd service in the VM, not a foreground SSH command.

## 2. Host a web app or API at a public URL

1. Create the VM (step 1), or reuse one from `shako vm ls`.
2. Copy the code. From a Git remote the VM can reach: `ssh <vm>... 'git clone <url> app'`. From
   this computer: `rsync -az --exclude .git --exclude node_modules ./ <name>.<tenant>.shako.dev:app/`.
3. Install the runtime and dependencies in the VM (`sudo apt-get install -y ...`, `npm ci`,
   `pip install -r requirements.txt`, ...).
4. Run it as a systemd service so it restarts after a reboot or crash:

   ```
   ssh <name>.<tenant>.shako.dev 'sudo tee /etc/systemd/system/app.service >/dev/null <<EOF
   [Unit]
   Description=app
   After=network.target
   [Service]
   User=shako
   WorkingDirectory=/home/shako/app
   ExecStart=<start command, listening on 0.0.0.0:<port>>
   Restart=always
   Environment=PORT=<port>
   [Install]
   WantedBy=multi-user.target
   EOF
   sudo systemctl daemon-reload && sudo systemctl enable --now app'
   ```

5. Share the port: `shako port share <name> <port> public`. It prints the URL,
   `https://<name>-<port>--<tenant>.shakoapp.dev`.
6. Check it: `curl -sS -o /dev/null -w '%{http_code}\n' <url>`. Give the user the URL.

To deploy a new version, repeat steps 2 and 3, then `sudo systemctl restart app`. Logs:
`ssh <vm>... 'journalctl -u app -n 100 --no-pager'`.

## 3. Host a private service (database, admin tool, preview)

Same as step 2, but share the port `private`: `shako port share <name> <port> private`. The URL,
`https://<name>-<port>--<tenant>.net.shakoapp.dev`, opens only on the user's devices. A device
joins with `shako device add`, which uses `sudo` and installs WireGuard: ask the user to run it.

For a database that only one VM uses, do not share it: listen on `127.0.0.1` in that VM.

## 4. Run a background job, bot or cron

- A worker or bot: run it as a systemd service (step 2, point 4). It does not need a port.
- A scheduled job: add a crontab entry in the VM (`crontab -e` or `/etc/cron.d/`). The VM wakes
  2 minutes before each cron job. Check with `shako vm crons <name>`.
- A program that must never pause (for example it holds a long-lived outgoing connection):
  `shako vm set <name> --sleep never`, after the user agrees to the cost.

## 5. Manage

```
shako vm info <name>                    # one VM
shako vm sleep <name> | shako vm wake <name>
shako vm resize <name> --size mid --restart   # restarts the VM; files stay
shako port ls <name>                    # its ports and URLs
shako port unshare <name> <port>        # the URL stops working
shako vm usage                          # awake and asleep hours
shako credit show                       # prepaid credit left
shako vm rm <name>                      # deletes the VM and its disk: ask first
```
