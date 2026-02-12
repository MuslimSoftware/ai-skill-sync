# 🔄 AI Skill Sync

A macOS menu bar app that mirrors skills from `~/.codex/skills` into `~/.claude/skills` and `~/agents` with one click. Codex is the source of truth — select your targets, hit sync, done.

## ✨ Features

- ⚡ **One-click sync** from `.codex` to selected targets
- 🪞 **Clean mirror mode** with optional pruning (removes target entries not in source)
- 🔍 **Fast source/target scan** with skill counts
- 📄 **Clickable skill list** with per-skill details (`SKILL.md` metadata + preview)
- 🖥️ **macOS menu bar tray** with compact skill info, quick sync, and target status
- 📋 **Activity log** for each sync run
- 🔒 **Secure Electron boundary** using `contextIsolation` + preload IPC bridge

## 📦 Installation

### Download

Grab the latest `.dmg` from [Releases](https://github.com/younesbenketira/ai-skill-sync/releases), open it, and drag **AI Skill Sync** into **Applications**.

> ⚠️ macOS Gatekeeper will warn about an unidentified developer since the app isn't code-signed. Right-click the app and choose **Open** to bypass.

### Build from source

```bash
git clone https://github.com/younesbenketira/ai-skill-sync.git
cd ai-skill-sync
npm install
npm run build
```

The `.dmg` and `.zip` are written to `dist/`.

## 🛠️ Development

```bash
npm install
npm run dev
```

| Script | Description |
|---|---|
| `npm run dev` | Launch the app from source |
| `npm run build` | Package into `.dmg` + `.zip` |
| `npm run build:dir` | Package into unpacked `.app` (faster, good for testing) |
| `npm run check` | Syntax-check all source files |
| `npm test` | Run Node test suite |

## ⚙️ How It Works

1. On launch, the app scans `~/.codex/skills` for skill directories (each containing a `SKILL.md`).
2. It compares source skills against configured targets (`~/.claude/skills`, `~/agents`).
3. When you sync, each selected target is mirrored to match the source. With pruning enabled, skills in the target that no longer exist in the source are removed.

## 🏗️ Architecture

```
src/
  main/
    main.js            Electron main process, IPC wiring, window + tray
    preload.cjs        Strict renderer API bridge (contextIsolation)
    sync-service.js    Sync logic and filesystem operations
  renderer/
    index.html         UI markup
    styles.css         Visual design and layout
    app.js             Renderer state and interactions
tests/
  sync-service.test.js Node tests for sync behavior
```

The renderer has no direct filesystem or Node access. All operations go through a minimal IPC API exposed by `preload.cjs`, keeping the security boundary tight.

## 🎨 App Icon

electron-builder uses a default icon. To add a custom one, place a 1024x1024 PNG at `build/icon.png` and rebuild.
