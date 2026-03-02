import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_SOURCE,
  DEFAULT_TARGETS,
  getSkillDetails,
  inspectPaths,
  resolveUserPath,
  syncSkills
} from './sync-service.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const TRAY_SKILL_PREVIEW_LIMIT = 6;
const TRAY_TARGET_PREVIEW_LIMIT = 4;

let mainWindow = null;
let tray = null;

const trayState = {
  source: DEFAULT_SOURCE,
  targets: [...DEFAULT_TARGETS],
  prune: true,
  syncing: false,
  inspectResult: null,
  inspectError: '',
  lastSyncResult: null,
  lastSyncError: ''
};

function normalizeTargets(targets) {
  if (!Array.isArray(targets)) {
    return DEFAULT_TARGETS;
  }

  const sanitized = targets
    .filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
    .map((entry) => resolveUserPath(entry));

  return sanitized.length > 0 ? sanitized : DEFAULT_TARGETS;
}

function shortPath(inputPath) {
  return inputPath.replace(/^\/(?:Users|home)\/[^/]+/, '~');
}

function formatTime(value) {
  try {
    return new Date(value).toLocaleTimeString();
  } catch {
    return value;
  }
}

function truncate(value, maxLength = 74) {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength - 3)}...`;
}

function createTrayIcon(state = 'idle') {
  const isDarwin = process.platform === 'darwin';
  const fill = isDarwin ? 'black' : { idle: 'white', syncing: '#58a6ff', error: '#f85149', success: '#3fb950' }[state] || 'white';

  const icons = {
    idle: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${fill}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>`,
    syncing: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${fill}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/></svg>`,
    error: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${fill}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
    success: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="${fill}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>`
  };

  const svg = icons[state] || icons.idle;
  const image = nativeImage.createFromDataURL(`data:image/svg+xml,${encodeURIComponent(svg)}`);
  if (isDarwin) {
    image.setTemplateImage(true);
  }
  return image.resize({ width: 18, height: 18 });
}

function getTrayIconState() {
  if (trayState.syncing) return 'syncing';
  if (trayState.lastSyncError) return 'error';
  if (trayState.lastSyncResult?.success) return 'success';
  return 'idle';
}

function updateTrayIcon() {
  if (!tray) return;
  tray.setImage(createTrayIcon(getTrayIconState()));
}

function updateTrayTitle() {
  if (!tray) {
    return;
  }

  const sourceSummary = trayState.inspectResult?.source;
  let compact = 'Skills ?';

  if (trayState.syncing) {
    compact = 'Sync...';
  } else if (trayState.lastSyncError) {
    compact = 'Sync !';
  } else if (sourceSummary?.exists && sourceSummary.isDirectory) {
    compact = `Skills ${sourceSummary.skillCount}`;
  }

  if (process.platform === 'darwin') {
    tray.setTitle(compact);
  }

  tray.setToolTip(`AI Skill Sync | ${compact}`);
}

function summarizeSyncResult(result) {
  if (!result) {
    return 'Status: waiting for first sync';
  }

  const okCount = result.results.filter((entry) => entry.status === 'ok').length;
  const errorCount = result.results.filter((entry) => entry.status === 'error').length;
  const skippedCount = result.results.filter((entry) => entry.status === 'skipped').length;

  return `Last sync ${formatTime(result.finishedAt)} | ok ${okCount}, error ${errorCount}, skipped ${skippedCount}`;
}

function sourceStatusLine(sourceSummary) {
  if (!sourceSummary) {
    return 'Source: loading...';
  }

  if (!sourceSummary.exists) {
    return 'Source: missing';
  }

  if (!sourceSummary.isDirectory) {
    return 'Source: path is not a directory';
  }

  return `Source: ${sourceSummary.skillCount} skills`;
}

function buildSkillPreviewItems(sourceSummary) {
  if (!sourceSummary || !sourceSummary.exists || !sourceSummary.isDirectory) {
    return [{ label: 'No source skills available', enabled: false }];
  }

  if (sourceSummary.skillNames.length === 0) {
    return [{ label: 'No skill directories found', enabled: false }];
  }

  const previewItems = sourceSummary.skillNames
    .slice(0, TRAY_SKILL_PREVIEW_LIMIT)
    .map((skillName) => ({ label: `- ${skillName}`, enabled: false }));

  if (sourceSummary.skillNames.length > TRAY_SKILL_PREVIEW_LIMIT) {
    previewItems.push({
      label: `+${sourceSummary.skillNames.length - TRAY_SKILL_PREVIEW_LIMIT} more`,
      enabled: false
    });
  }

  return previewItems;
}

function formatTargetSummary(targetSummary) {
  const labelPath = shortPath(targetSummary.path);

  if (!targetSummary.exists) {
    return `${labelPath} | missing`;
  }

  if (!targetSummary.isDirectory) {
    return `${labelPath} | not a directory`;
  }

  return `${labelPath} | ${targetSummary.skillCount} skills`;
}

function buildTargetPreviewItems(targetSummaries) {
  if (targetSummaries.length === 0) {
    return [{ label: 'No targets configured', enabled: false }];
  }

  const preview = targetSummaries
    .slice(0, TRAY_TARGET_PREVIEW_LIMIT)
    .map((targetSummary) => ({
      label: formatTargetSummary(targetSummary),
      enabled: false
    }));

  if (targetSummaries.length > TRAY_TARGET_PREVIEW_LIMIT) {
    preview.push({
      label: `+${targetSummaries.length - TRAY_TARGET_PREVIEW_LIMIT} more targets`,
      enabled: false
    });
  }

  return preview;
}

function showMainWindow() {
  app.dock?.show();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = createWindow();
}

function updateTrayMenu() {
  if (!tray) {
    return;
  }

  updateTrayIcon();

  const sourceSummary = trayState.inspectResult?.source;
  const targetSummaries =
    trayState.inspectResult?.targets ?? trayState.targets.map((target) => ({ path: target, exists: false, isDirectory: true, skillCount: 0 }));

  const statusLine = trayState.syncing
    ? 'Sync in progress...'
    : trayState.lastSyncError
      ? `Last sync error: ${truncate(trayState.lastSyncError)}`
      : summarizeSyncResult(trayState.lastSyncResult);

  const checkedAtLine = trayState.inspectResult
    ? `Last refresh: ${formatTime(trayState.inspectResult.checkedAt)}`
    : trayState.inspectError
      ? `Refresh error: ${truncate(trayState.inspectError)}`
      : 'Last refresh: pending';

  const menuTemplate = [
    { label: 'AI Skill Sync', enabled: false },
    { label: truncate(statusLine), enabled: false },
    { label: checkedAtLine, enabled: false },
    { type: 'separator' },
    { label: sourceStatusLine(sourceSummary), enabled: false },
    { label: shortPath(trayState.source), enabled: false },
    { type: 'separator' },
    { label: 'Skills', enabled: false },
    ...buildSkillPreviewItems(sourceSummary),
    { type: 'separator' },
    { label: 'Targets', enabled: false },
    ...buildTargetPreviewItems(targetSummaries),
    { type: 'separator' },
    {
      label: trayState.syncing ? 'Syncing...' : 'Sync Now',
      enabled: !trayState.syncing,
      click: () => {
        void runSyncAndRefreshTray({
          source: trayState.source,
          targets: trayState.targets,
          prune: trayState.prune
        }).catch(() => {});
      }
    },
    {
      label: 'Mirror mode (prune extras)',
      type: 'checkbox',
      checked: trayState.prune,
      enabled: !trayState.syncing,
      click: (item) => {
        trayState.prune = item.checked;
        updateTrayMenu();
      }
    },
    {
      label: 'Refresh Info',
      enabled: !trayState.syncing,
      click: () => {
        void refreshTrayInspect({
          source: trayState.source,
          targets: trayState.targets
        }).catch(() => {});
      }
    },
    { type: 'separator' },
    {
      label: 'Launch at Login',
      type: 'checkbox',
      checked: app.getLoginItemSettings().openAtLogin,
      click: (item) => {
        app.setLoginItemSettings({ openAtLogin: item.checked });
      }
    },
    { type: 'separator' },
    {
      label: 'Open Source Folder',
      click: () => {
        shell.showItemInFolder(trayState.source);
      }
    },
    {
      label: 'Open Main Window',
      click: () => {
        showMainWindow();
      }
    },
    { type: 'separator' },
    {
      label: 'Quit',
      role: 'quit'
    }
  ];

  tray.setContextMenu(Menu.buildFromTemplate(menuTemplate));
  updateTrayTitle();
}

async function refreshTrayInspect({ source, targets }) {
  const normalizedSource = source ? resolveUserPath(source) : DEFAULT_SOURCE;
  const normalizedTargets = normalizeTargets(targets);

  trayState.source = normalizedSource;
  trayState.targets = normalizedTargets;

  try {
    const result = await inspectPaths({
      source: normalizedSource,
      targets: normalizedTargets
    });

    trayState.inspectResult = result;
    trayState.inspectError = '';
    updateTrayMenu();
    return result;
  } catch (error) {
    trayState.inspectError = error instanceof Error ? error.message : String(error);
    updateTrayMenu();
    throw error;
  }
}

async function runSyncAndRefreshTray({ source, targets, prune }) {
  if (trayState.syncing) {
    throw new Error('A sync is already running.');
  }

  const normalizedSource = source ? resolveUserPath(source) : DEFAULT_SOURCE;
  const normalizedTargets = normalizeTargets(targets);
  const normalizedPrune = prune !== false;

  trayState.source = normalizedSource;
  trayState.targets = normalizedTargets;
  trayState.prune = normalizedPrune;
  trayState.syncing = true;
  trayState.lastSyncError = '';
  updateTrayMenu();

  try {
    const result = await syncSkills({
      source: normalizedSource,
      targets: normalizedTargets,
      prune: normalizedPrune
    });

    trayState.lastSyncResult = result;
    if (!result.success) {
      const firstError = result.results.find((entry) => entry.status === 'error');
      trayState.lastSyncError = firstError?.error ?? 'Sync completed with one or more target errors.';
    }

    try {
      await refreshTrayInspect({
        source: normalizedSource,
        targets: normalizedTargets
      });
    } catch {
      // keep sync successful even if refresh snapshot fails
    }

    return result;
  } catch (error) {
    trayState.lastSyncError = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    trayState.syncing = false;
    updateTrayMenu();
  }
}

function createTray() {
  if (tray) {
    return tray;
  }

  tray = new Tray(createTrayIcon('idle'));
  if (process.platform === 'linux') {
    tray.on('click', () => {
      tray.popUpContextMenu();
    });
  }
  tray.on('double-click', () => {
    showMainWindow();
  });

  updateTrayMenu();
  return tray;
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1120,
    height: 760,
    minWidth: 920,
    minHeight: 620,
    title: 'AI Skill Sync',
    backgroundColor: '#1a1a2e',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.cjs')
    }
  });

  window.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
    if (BrowserWindow.getAllWindows().length === 0 && process.platform === 'darwin') {
      app.dock?.hide();
    }
  });

  return window;
}

app.whenReady().then(() => {
  ipcMain.handle('skill-sync:get-config', () => ({
    source: DEFAULT_SOURCE,
    targets: DEFAULT_TARGETS
  }));

  ipcMain.handle('skill-sync:inspect', async (_event, payload = {}) => {
    const source = payload?.source ? resolveUserPath(payload.source) : DEFAULT_SOURCE;
    const targets = normalizeTargets(payload?.targets);
    return refreshTrayInspect({ source, targets });
  });

  ipcMain.handle('skill-sync:sync', async (_event, payload = {}) => {
    const source = payload?.source ? resolveUserPath(payload.source) : DEFAULT_SOURCE;
    const targets = normalizeTargets(payload?.targets);
    const prune = payload?.prune !== false;

    return runSyncAndRefreshTray({ source, targets, prune });
  });

  ipcMain.handle('skill-sync:open-path', async (_event, rawPath) => {
    const targetPath = resolveUserPath(rawPath);
    if (!targetPath) {
      return { ok: false, error: 'Invalid path.' };
    }

    shell.showItemInFolder(targetPath);
    return { ok: true };
  });

  ipcMain.handle('skill-sync:get-login-item', () => {
    return app.getLoginItemSettings();
  });

  ipcMain.handle('skill-sync:set-login-item', (_event, enabled) => {
    app.setLoginItemSettings({ openAtLogin: !!enabled });
    return app.getLoginItemSettings();
  });

  ipcMain.handle('skill-sync:skill-details', async (_event, payload = {}) => {
    const directoryPath = payload?.directoryPath ? resolveUserPath(payload.directoryPath) : '';
    const skillName = typeof payload?.skillName === 'string' ? payload.skillName : '';
    return getSkillDetails({ directoryPath, skillName });
  });

  app.dock?.hide();
  createTray();
  void refreshTrayInspect({
    source: DEFAULT_SOURCE,
    targets: DEFAULT_TARGETS
  }).catch(() => {});

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      showMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  tray?.destroy();
  tray = null;
});
