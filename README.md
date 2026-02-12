# AI Skill Sync

AI Skill Sync is a focused desktop app that mirrors skills from `~/.codex/skills` into:

- `~/.claude/skills`
- `~/agents`

The app treats `.codex` as the source of truth and syncs selected targets with one click.

## Features

- One-click sync from `.codex` to selected targets
- Clean mirror mode with optional pruning (remove target entries not present in source)
- Fast source/target scan view with skill counts
- Clickable skill list with per-skill details (`SKILL.md` metadata + quick preview)
- macOS menu bar mode with compact skill info, quick sync button, and target status preview
- Activity log for each sync run
- Secure Electron boundary using `contextIsolation` + preload IPC bridge

## Run locally

```bash
npm install
npm run dev
```

## Validate

```bash
npm run check
npm test
```

## Project structure

- `src/main/main.js`: Electron process, IPC wiring, app window, menu bar tray actions
- `src/main/preload.cjs`: strict renderer API bridge
- `src/main/sync-service.js`: sync logic and filesystem operations
- `src/renderer/index.html`: UI markup
- `src/renderer/styles.css`: visual design and responsive layout
- `src/renderer/app.js`: renderer state and interactions
- `tests/sync-service.test.js`: Node tests for sync behavior
