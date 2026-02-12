# AGENTS.md

## Project Intent
AI Skill Sync is a focused Electron desktop app for one-way skill synchronization:

- Source of truth: `~/.codex/skills`
- Default targets:
  - `~/.claude/skills`
  - `~/agents`

The app intentionally does not do two-way merges. It mirrors from source to selected targets in a predictable, explicit operation.

## Product Constraints
- Keep the UI minimal and fast.
- Keep synchronization deterministic and auditable.
- Keep renderer isolated from direct Node access.
- Treat missing targets as recoverable (auto-create on sync).
- Allow optional pruning for strict mirror mode.

## Stack
- Electron (`^31.0.0`)
- Node.js ESM (`"type": "module"`)
- Vanilla HTML/CSS/JS renderer (no frontend framework)
- Node built-in test runner (`node --test`)

## Runtime Architecture

### Process Boundaries
1. Main process (`src/main/main.js`)
2. Preload bridge (`src/main/preload.cjs`)
3. Renderer (`src/renderer/app.js`)
4. Domain sync service (`src/main/sync-service.js`)

Renderer never receives raw `fs` access. It can only call methods exposed by preload.

### Security Model
- `contextIsolation: true`
- `nodeIntegration: false`
- Explicit IPC handlers via `ipcMain.handle(...)`
- Narrow preload API surface:
  - `getConfig()`
  - `inspect(payload)`
  - `sync(payload)`
  - `openPath(path)`
  - `skillDetails(payload)`

## File-by-File Implementation

### `package.json`
- Entry: `"main": "src/main/main.js"`
- Scripts:
  - `npm run dev` / `npm start` launches Electron
  - `npm run check` runs syntax checks (`node --check`) on all JS modules
  - `npm test` runs unit tests

### `src/main/main.js`
Responsibilities:
- Create and configure `BrowserWindow`
- Register all IPC handlers
- Normalize payloads before calling domain logic
- Handle macOS activation lifecycle and non-macOS close/quit behavior

IPC contract:
- `skill-sync:get-config` -> `{ source, targets }`
- `skill-sync:inspect` -> inspect snapshot
- `skill-sync:sync` -> sync execution report
- `skill-sync:open-path` -> opens Finder at path
- `skill-sync:skill-details` -> selected skill details (`SKILL.md` metadata preview + child directories)

Important details:
- `normalizeTargets(...)` sanitizes user input and falls back to defaults.
- Payload `prune` defaults to `true` unless explicitly `false`.

### `src/main/preload.cjs`
Responsibilities:
- Expose a strict bridge using `contextBridge.exposeInMainWorld`.
- Convert renderer calls into `ipcRenderer.invoke(...)`.

This file is intentionally small to keep trust boundaries obvious.

### `src/main/sync-service.js`
This is the core domain/service layer.

Exports:
- `DEFAULT_SOURCE`
- `DEFAULT_TARGETS`
- `resolveUserPath(input)`
- `inspectPaths({ source, targets })`
- `syncSkills({ source, targets, prune })`

Core helpers:
- `uniq(items)` for deduping targets
- `exists(path)` and `isDirectory(path)` guards
- `readEntriesSafe(path)` for resilient reads
- `listSkillNames(entries)` to derive skill list
- `shouldIgnore(name)` currently ignores `.DS_Store`

Path rules:
- Supports `~` and `~/...` expansion
- Uses absolute `path.resolve(...)` for non-tilde input

Inspect flow (`inspectPaths`):
1. Resolve source and target paths
2. Summarize source and each target:
  - existence
  - directory validity
  - derived skill names/count
3. Return time-stamped snapshot (`checkedAt`)

Sync flow (`syncSkills`):
1. Resolve source/targets and validate source directory
2. Read source entries once
3. For each target:
  - skip if target equals source
  - create target directory if missing
  - copy each source entry by replacing target entry first (`fs.rm` + `fs.cp`)
  - if prune enabled: remove target entries absent from source
  - compute final target skill summary
4. Return run report:
  - overall success
  - run timings (`startedAt`, `finishedAt`, `durationMs`)
  - per-target results (`ok`, `skipped`, or `error`)

Why replace-then-copy:
- Prevent stale files inside existing skill directories.
- Guarantees each source entry in target is an exact replacement for that entry.

### `src/renderer/index.html`
Layout:
- Hero panel (context)
- Source panel
- Targets panel
- Sync action panel
- Activity panel

This is semantic, static markup with IDs for JS bindings.

### `src/renderer/styles.css`
Design approach:
- Minimalist, warm palette
- Explicit CSS variables in `:root`
- Subtle gradients and ambient background
- Responsive grid (2 columns desktop, 1 column mobile)
- Basic entrance animation (`riseIn`) and accessible contrast states

### `src/renderer/app.js`
Responsibilities:
- Query DOM once and maintain local view state
- Fetch startup config via bridge
- Render source and targets from inspect response
- Manage selected targets and prune toggle
- Execute sync and append activity log lines
- Handle busy state (disable controls during sync)

State model:
- `source`
- `targets`
- `selectedTargets` (`Set`)
- `inspectResult`
- `running`
- `log` (latest 18 lines)

Renderer behavior:
1. `init()` loads config and performs initial inspect.
2. `refreshInspect()` re-renders source/targets from backend snapshot.
3. `runSync()` validates selection, calls sync, logs per-target outcome, then refreshes view.

UX detail:
- Post-sync status is preserved during automatic refresh (`keepStatus: true`) to avoid success message flicker.

### `tests/sync-service.test.js`
Coverage includes:
- Mirror + prune behavior removes stale target entries
- Non-prune behavior preserves target-only entries
- Inspect behavior for missing targets and source skill count

Tests run against temporary filesystem roots and clean up after execution.

## Data Shapes

### Inspect result
```json
{
  "checkedAt": "ISO_DATE",
  "source": {
    "path": "/abs/path",
    "exists": true,
    "isDirectory": true,
    "skillCount": 3,
    "skillNames": [".system", "prd-workflow", "ralph"]
  },
  "targets": [
    {
      "path": "/abs/target",
      "exists": true,
      "isDirectory": true,
      "skillCount": 3,
      "skillNames": []
    }
  ]
}
```

### Sync result
```json
{
  "success": true,
  "source": "/abs/source",
  "prune": true,
  "startedAt": "ISO_DATE",
  "finishedAt": "ISO_DATE",
  "durationMs": 123,
  "sourceEntryCount": 3,
  "results": [
    {
      "target": "/abs/target",
      "status": "ok",
      "copied": 3,
      "removed": 0,
      "skillCount": 3,
      "skillNames": [".system", "prd-workflow", "ralph"]
    }
  ]
}
```

## Dev Workflow

### Run
```bash
npm install
npm run dev
```

### Validate
```bash
npm run check
npm test
```

### Manual smoke checks
1. Launch app.
2. Confirm source panel lists skills from `~/.codex/skills`.
3. Uncheck one target and sync.
4. Toggle mirror mode off and sync again.
5. Use "Open" button to verify target path integration with Finder.

## Extension Points
- Add additional default targets by updating `DEFAULT_TARGETS` in `src/main/sync-service.js`.
- Add a "dry run" mode by adding a boolean in `syncSkills` and bypassing `fs` write/delete calls.
- Add packaging (`electron-builder` or equivalent) without changing sync service contracts.
- Add richer conflict/reporting metadata (bytes copied, changed files) in sync results.

## Known Limitations
- No per-target custom source mapping (single global source).
- No scheduled/automatic sync.
- No advanced diff preview before sync.
- No Windows/Linux path presets yet (current defaults are macOS-oriented).

## Contribution Rules
- Preserve one-way source-of-truth semantics unless product requirements change.
- Keep logic in `sync-service.js` testable and renderer-agnostic.
- Avoid adding direct filesystem APIs in renderer.
- Update tests whenever sync semantics change.
