# Security

## What this tool touches

- Starts a local `opencode` process bound to `127.0.0.1` on a fixed port,
  guarded by a bearer token. It is not reachable off-host.
- Appends entries to `~/.workbuddy/models.json` (a backup is written first).
- May download the official opencode binary (~57 MB, sha512-verified by the
  upstream plugin) when no binary is found.
- Does **not** read or modify your own OpenCode configuration or credentials;
  the isolated runtime uses its own XDG root and a random per-start password.

## Reporting

Open a private security advisory on GitHub, or an issue if the matter is not
sensitive. Please include reproduction steps and the affected version.

## Design note

The bridge deliberately runs a **real** opencode runtime because OpenCode Zen's
free tier rejects non-OpenCode traffic. The runtime is configured with
`permission:{'*':'ask'}` and every approval is refused locally, so the gate stays
open while no local action ever executes. Do not change that policy to `deny`
(it breaks the gate) or to `allow` (it would execute local actions).
