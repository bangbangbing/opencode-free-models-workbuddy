# Security

## What this tool touches

- Starts a local `opencode` process bound to `127.0.0.1` on a fixed port,
  guarded by a bearer token. It is not reachable off-host.
- Appends entries to `~/.workbuddy/models.json` (a backup is written first).
- May download the official opencode binary (~57 MB, sha512-verified by the
  upstream plugin) when no binary is found. Set `OPENCODE_BRIDGE_NO_DOWNLOAD=1`
  to forbid this entirely.
- Does **not** read or modify your own OpenCode configuration or credentials;
  the isolated runtime uses its own XDG root and a random per-start password.

## `doctor.mjs` (the self-healing entry point)

`node scripts/doctor.mjs` is a plain Node script — no shell, no PowerShell.

- It **starts a detached background process** (`scripts/bridge.mjs`) when nothing
  is listening on the bridge port. That child is unreferenced, so it outlives the
  terminal that launched it. It is the same process you would start by hand with
  `npm run bridge`; nothing else is spawned.
- It **never terminates a process it did not start.** If the port is occupied by a
  foreign program, it reports `foreign` and exits non-zero without touching it.
- It writes only inside `~/.workbuddy/opencode-bridge/` (state + log) and
  `~/.workbuddy/models.json` (via the sync script, which backs up first).
- `--check` performs a **read-only** diagnosis and changes nothing.

No `sudo`, no registry writes, no scheduled tasks, no launch agents are created by
any script in this repository. Persistence is documentation-only and opt-in — you
copy the template from `references/persistence.md` yourself.

## Network

The only outbound calls are to the OpenCode Zen API (via the isolated runtime) and,
once, to the official opencode release URL if a binary must be downloaded. The
local endpoint is loopback-only.

## Reporting

Open a private security advisory on GitHub, or an issue if the matter is not
sensitive. Please include reproduction steps and the affected version.

## Design note

The bridge deliberately runs a **real** opencode runtime because OpenCode Zen's
free tier rejects non-OpenCode traffic. The runtime is configured with
`permission:{'*':'ask'}` and every approval is refused locally, so the gate stays
open while no local action ever executes. Do not change that policy to `deny`
(it breaks the gate) or to `allow` (it would execute local actions).
