# Contributing

Thanks for improving `opencode-free-models-workbuddy`.

## Ground rules

- Keep the bridge **dependency-free** (Node built-ins only). It intentionally
  reuses the `dsh-opencode-xdbridge` core modules at runtime instead of vendoring
  them — do not copy their source into this repo.
- Do not commit secrets, tokens, personal absolute paths, or captured requests.
- Keep scripts portable: resolve paths from the environment (`DSH_HOME`,
  `OPENCODE_BRIDGE_*`), never hardcode a machine.

## Before opening a PR

```bash
node scripts/validate-skill.mjs   # must pass
```

Update `CHANGELOG.md` for user-visible changes.

## Adding a new script

1. Put it in `scripts/`.
2. Add a `node --check` entry to `scripts/validate-skill.mjs` if it is `.mjs`.
3. Document it in `README.md` and `SKILL.md` if it becomes part of the workflow.
