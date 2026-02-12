const directoryListEl = document.querySelector('#directory-list');
const directorySummaryEl = document.querySelector('#directory-summary');
const detailTitleEl = document.querySelector('#detail-title');
const detailPathEl = document.querySelector('#detail-path');
const detailMetaEl = document.querySelector('#detail-meta');
const detailSkillsEl = document.querySelector('#detail-skills');
const openDirBtnEl = document.querySelector('#open-dir-btn');
const selectedSummaryEl = document.querySelector('#selected-summary');
const statusLineEl = document.querySelector('#status-line');
const activityLogEl = document.querySelector('#activity-log');
const pruneToggleEl = document.querySelector('#prune-toggle');
const syncBtnEl = document.querySelector('#sync-btn');
const refreshBtnEl = document.querySelector('#refresh-btn');
const skillNameEl = document.querySelector('#skill-name');
const skillPathEl = document.querySelector('#skill-path');
const skillDescriptionEl = document.querySelector('#skill-description');
const skillPreviewEl = document.querySelector('#skill-preview');
const skillChildrenMetaEl = document.querySelector('#skill-children-meta');
const skillChildrenEl = document.querySelector('#skill-children');
const openSkillBtnEl = document.querySelector('#open-skill-btn');

const state = {
  source: '',
  targets: [],
  selectedTargets: new Set(),
  inspectResult: null,
  activePath: '',
  activeSkillDirectoryPath: '',
  activeSkillName: '',
  skillDetail: null,
  skillDetailLoading: false,
  skillDetailRequestId: 0,
  running: false,
  selectionInitialized: false,
  log: []
};

function formatTime(value) {
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function shortPath(inputPath) {
  return inputPath.replace(/^\/Users\/[^/]+/, '~');
}

function directoryStatusLabel(summary) {
  if (!summary.exists) {
    return 'Missing (created on sync)';
  }

  if (!summary.isDirectory) {
    return 'Path is not a directory';
  }

  return `${summary.skillCount} skills`;
}

function setStatus(type, message) {
  statusLineEl.className = `status ${type}`;
  statusLineEl.textContent = message;
}

function pushLog(message) {
  state.log.unshift(`${new Date().toLocaleTimeString()} - ${message}`);
  state.log = state.log.slice(0, 18);

  activityLogEl.innerHTML = '';
  for (const line of state.log) {
    const item = document.createElement('li');
    item.textContent = line;
    activityLogEl.append(item);
  }
}

function getDirectoryItems() {
  if (!state.inspectResult) {
    return [];
  }

  return [
    {
      title: 'Source',
      summary: state.inspectResult.source,
      syncable: false
    },
    ...state.inspectResult.targets.map((targetSummary, index) => ({
      title: `Target ${index + 1}`,
      summary: targetSummary,
      syncable: true
    }))
  ];
}

function ensureActivePath(items) {
  if (items.length === 0) {
    state.activePath = '';
    return;
  }

  if (!items.some((item) => item.summary.path === state.activePath)) {
    state.activePath = items[0].summary.path;
  }
}

function updateSelectionSummary() {
  const selected = state.selectedTargets.size;
  const total = state.targets.length;
  selectedSummaryEl.textContent = `${selected} of ${total} targets selected`;
}

function setEmptySkillDetail(message = 'Click a skill to view details.') {
  skillNameEl.textContent = 'Select a skill';
  skillPathEl.textContent = '-';
  skillDescriptionEl.textContent = message;
  skillPreviewEl.textContent = '';
  skillChildrenMetaEl.textContent = '';
  skillChildrenEl.innerHTML = '';
  openSkillBtnEl.disabled = true;
}

function renderSkillDetail(detail) {
  if (!detail) {
    setEmptySkillDetail();
    return;
  }

  const title = detail.title || detail.skillName;
  skillNameEl.textContent = title;
  skillPathEl.textContent = detail.skillPath;

  if (!detail.exists) {
    skillDescriptionEl.textContent = 'Skill directory is missing.';
    skillPreviewEl.textContent = '';
    skillChildrenMetaEl.textContent = '';
    skillChildrenEl.innerHTML = '';
    openSkillBtnEl.disabled = true;
    return;
  }

  if (!detail.isDirectory) {
    skillDescriptionEl.textContent = 'Skill path exists but is not a directory.';
    skillPreviewEl.textContent = '';
    skillChildrenMetaEl.textContent = '';
    skillChildrenEl.innerHTML = '';
    openSkillBtnEl.disabled = true;
    return;
  }

  const description = detail.description || detail.shortDescription || 'No description found in SKILL.md.';
  skillDescriptionEl.textContent = description;
  skillPreviewEl.textContent = detail.preview ? detail.preview : '';

  skillChildrenEl.innerHTML = '';
  if (detail.childDirectoryCount > 0) {
    skillChildrenMetaEl.textContent = `${detail.childDirectoryCount} child directories`;

    const previewChildren = detail.childDirectories.slice(0, 8);
    for (const childName of previewChildren) {
      const chip = document.createElement('span');
      chip.className = 'chip';
      chip.textContent = childName;
      skillChildrenEl.append(chip);
    }

    if (detail.childDirectoryCount > previewChildren.length) {
      const extraChip = document.createElement('span');
      extraChip.className = 'chip';
      extraChip.textContent = `+${detail.childDirectoryCount - previewChildren.length} more`;
      skillChildrenEl.append(extraChip);
    }
  } else {
    skillChildrenMetaEl.textContent = 'No child directories';
  }

  openSkillBtnEl.disabled = state.running;
}

function renderSkillButtons(summary) {
  detailSkillsEl.innerHTML = '';

  if (!summary.isDirectory || !summary.exists || summary.skillNames.length === 0) {
    return;
  }

  for (const skillName of summary.skillNames) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `skill-btn ${skillName === state.activeSkillName ? 'active' : ''}`;
    button.textContent = skillName;
    button.disabled = state.running;
    button.addEventListener('click', () => {
      if (state.activeSkillName === skillName) {
        return;
      }

      state.activeSkillName = skillName;
      renderSkillButtons(summary);
      void loadSkillDetail(summary.path, skillName);
    });

    detailSkillsEl.append(button);
  }
}

async function loadSkillDetail(directoryPath, skillName) {
  if (typeof window.skillSync?.skillDetails !== 'function') {
    setStatus('warn', 'Skill details are unavailable. Fully restart the app.');
    setEmptySkillDetail('Skill details need a full app restart (quit app, then run npm run dev).');
    return;
  }

  const requestId = state.skillDetailRequestId + 1;
  state.skillDetailRequestId = requestId;
  state.skillDetailLoading = true;
  state.skillDetail = null;

  skillNameEl.textContent = skillName;
  skillPathEl.textContent = `${shortPath(directoryPath)}/${skillName}`;
  skillDescriptionEl.textContent = 'Loading skill details...';
  skillPreviewEl.textContent = '';
  skillChildrenMetaEl.textContent = '';
  skillChildrenEl.innerHTML = '';
  openSkillBtnEl.disabled = true;

  try {
    const detail = await window.skillSync.skillDetails({ directoryPath, skillName });
    if (state.skillDetailRequestId !== requestId) {
      return;
    }

    state.skillDetailLoading = false;
    state.skillDetail = detail;
    renderSkillDetail(detail);
  } catch (error) {
    if (state.skillDetailRequestId !== requestId) {
      return;
    }

    state.skillDetailLoading = false;
    state.skillDetail = null;
    const message = error instanceof Error ? error.message : String(error);
    const noHandler = message.includes("No handler registered for 'skill-sync:skill-details'");

    if (noHandler) {
      setStatus('warn', 'Skill details need a full app restart.');
      setEmptySkillDetail('Quit AI Skill Sync completely, then run npm run dev again.');
      return;
    }

    setStatus('error', message);
    setEmptySkillDetail('Could not load skill details.');
  }
}

function renderDirectories(items) {
  directoryListEl.innerHTML = '';

  if (items.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'meta';
    empty.textContent = 'No directories found.';
    directoryListEl.append(empty);
    directorySummaryEl.textContent = '0 directories';
    return;
  }

  for (const itemData of items) {
    const summary = itemData.summary;
    const item = document.createElement('div');
    item.className = 'directory-item';
    if (summary.path === state.activePath) {
      item.classList.add('active');
    }

    const main = document.createElement('button');
    main.type = 'button';
    main.className = 'directory-main';
    main.setAttribute('aria-label', `Open ${summary.path}`);
    main.addEventListener('click', () => {
      state.activePath = summary.path;
      renderDirectories(items);
      renderActiveDirectory(items);
    });

    const titleEl = document.createElement('p');
    titleEl.className = 'directory-title';
    titleEl.textContent = itemData.title;

    const pathEl = document.createElement('p');
    pathEl.className = 'directory-path';
    pathEl.textContent = summary.path;

    const statusEl = document.createElement('p');
    statusEl.className = `directory-status ${summary.exists && summary.isDirectory ? 'ok' : 'muted'}`;
    statusEl.textContent = directoryStatusLabel(summary);

    main.append(titleEl, pathEl, statusEl);
    item.append(main);

    if (itemData.syncable) {
      const toggleWrap = document.createElement('label');
      toggleWrap.className = 'directory-toggle';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = state.selectedTargets.has(summary.path);
      checkbox.disabled = state.running;
      checkbox.setAttribute('aria-label', `Include ${summary.path} in sync`);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) {
          state.selectedTargets.add(summary.path);
        } else {
          state.selectedTargets.delete(summary.path);
        }

        updateSelectionSummary();
      });

      const labelText = document.createElement('span');
      labelText.textContent = 'Sync';

      toggleWrap.append(checkbox, labelText);
      item.append(toggleWrap);
    }

    directoryListEl.append(item);
  }

  directorySummaryEl.textContent = `${items.length} directories`;
}

function renderActiveDirectory(items) {
  const active = items.find((item) => item.summary.path === state.activePath);

  if (!active) {
    detailTitleEl.textContent = 'Directory skills';
    detailPathEl.textContent = '-';
    detailMetaEl.textContent = 'Select a directory to inspect.';
    detailSkillsEl.innerHTML = '';
    state.activeSkillName = '';
    state.activeSkillDirectoryPath = '';
    state.skillDetail = null;
    state.skillDetailRequestId += 1;
    setEmptySkillDetail();
    openDirBtnEl.disabled = true;
    return;
  }

  const summary = active.summary;
  detailTitleEl.textContent = `${active.title} skills`;
  detailPathEl.textContent = summary.path;
  openDirBtnEl.disabled = state.running;

  if (!summary.exists) {
    detailMetaEl.textContent = 'Directory is missing.';
    detailSkillsEl.innerHTML = '';
    state.activeSkillName = '';
    state.activeSkillDirectoryPath = '';
    state.skillDetail = null;
    state.skillDetailRequestId += 1;
    setEmptySkillDetail('This directory does not exist yet.');
    return;
  }

  if (!summary.isDirectory) {
    detailMetaEl.textContent = 'Path exists but is not a directory.';
    detailSkillsEl.innerHTML = '';
    state.activeSkillName = '';
    state.activeSkillDirectoryPath = '';
    state.skillDetail = null;
    state.skillDetailRequestId += 1;
    setEmptySkillDetail('This path is not a directory.');
    return;
  }

  if (state.activeSkillDirectoryPath !== summary.path) {
    state.activeSkillDirectoryPath = summary.path;
    state.activeSkillName = '';
    state.skillDetail = null;
    state.skillDetailRequestId += 1;
  }

  if (summary.skillNames.length === 0) {
    detailMetaEl.textContent = 'No skills found in this directory.';
    detailSkillsEl.innerHTML = '';
    state.activeSkillName = '';
    state.skillDetail = null;
    setEmptySkillDetail('No skill to inspect in this directory.');
    return;
  }

  detailMetaEl.textContent = `${summary.skillCount} skills found. Click one for details.`;

  if (!summary.skillNames.includes(state.activeSkillName)) {
    state.activeSkillName = summary.skillNames[0];
  }

  renderSkillButtons(summary);

  const hasMatchingDetail =
    Boolean(state.skillDetail) &&
    state.skillDetail.directoryPath === summary.path &&
    state.skillDetail.skillName === state.activeSkillName;

  if (hasMatchingDetail) {
    renderSkillDetail(state.skillDetail);
    return;
  }

  void loadSkillDetail(summary.path, state.activeSkillName);
}

function syncSelectionWithInspect(targetPaths) {
  if (!state.selectionInitialized) {
    state.selectedTargets = new Set(targetPaths);
    state.selectionInitialized = true;
    return;
  }

  const nextSelected = new Set();
  for (const selectedPath of state.selectedTargets) {
    if (targetPaths.includes(selectedPath)) {
      nextSelected.add(selectedPath);
    }
  }

  state.selectedTargets = nextSelected;
}

async function refreshInspect({ keepStatus = false } = {}) {
  const payload = {
    source: state.source,
    targets: state.targets
  };

  const result = await window.skillSync.inspect(payload);
  state.inspectResult = result;

  const targetPaths = result.targets.map((target) => target.path);
  state.targets = targetPaths;
  syncSelectionWithInspect(targetPaths);

  const items = getDirectoryItems();
  ensureActivePath(items);
  renderDirectories(items);
  renderActiveDirectory(items);
  updateSelectionSummary();

  if (!keepStatus) {
    setStatus('info', `Checked paths at ${formatTime(result.checkedAt)}`);
  }
}

function setRunning(running) {
  state.running = running;
  syncBtnEl.disabled = running;
  refreshBtnEl.disabled = running;
  pruneToggleEl.disabled = running;
  openDirBtnEl.disabled = running || !state.activePath;
  openSkillBtnEl.disabled = running || !state.skillDetail?.skillPath;
  syncBtnEl.textContent = running ? 'Syncing...' : 'Sync Selected Targets';

  const items = getDirectoryItems();
  renderDirectories(items);
  renderActiveDirectory(items);
}

async function runSync() {
  if (state.running) {
    return;
  }

  const selectedTargets = [...state.selectedTargets];
  if (selectedTargets.length === 0) {
    setStatus('warn', 'Select at least one target to continue.');
    return;
  }

  setRunning(true);
  setStatus('info', 'Running sync...');

  try {
    const result = await window.skillSync.sync({
      source: state.source,
      targets: selectedTargets,
      prune: pruneToggleEl.checked
    });

    for (const targetResult of result.results) {
      if (targetResult.status === 'ok') {
        pushLog(
          `Synced ${shortPath(targetResult.target)} | copied ${targetResult.copied}, removed ${targetResult.removed}`
        );
      } else {
        pushLog(`Failed ${shortPath(targetResult.target)} | ${targetResult.error ?? 'Unknown error'}`);
      }
    }

    if (result.success) {
      setStatus('ok', `Sync completed in ${result.durationMs}ms.`);
    } else {
      setStatus('warn', 'Sync completed with one or more errors. Check activity log.');
    }

    await refreshInspect({ keepStatus: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus('error', message);
    pushLog(`Sync failed: ${message}`);
  } finally {
    setRunning(false);
  }
}

async function openActivePath() {
  if (!state.activePath || state.running) {
    return;
  }

  await window.skillSync.openPath(state.activePath);
}

async function openSelectedSkillPath() {
  if (!state.skillDetail?.skillPath || state.running) {
    return;
  }

  await window.skillSync.openPath(state.skillDetail.skillPath);
}

async function init() {
  if (!window.skillSync) {
    setStatus('error', 'Electron bridge unavailable. Start this app with npm run dev.');
    return;
  }

  setEmptySkillDetail();

  try {
    const config = await window.skillSync.getConfig();
    state.source = config.source;
    state.targets = config.targets;

    await refreshInspect();
    pushLog('App ready. Source and target paths loaded.');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    setStatus('error', message);
    pushLog(`Initialization failed: ${message}`);
  }
}

syncBtnEl.addEventListener('click', runSync);
refreshBtnEl.addEventListener('click', () => {
  void refreshInspect().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    setStatus('error', message);
  });
});
openDirBtnEl.addEventListener('click', () => {
  void openActivePath().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    setStatus('error', message);
  });
});
openSkillBtnEl.addEventListener('click', () => {
  void openSelectedSkillPath().catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    setStatus('error', message);
  });
});

init();
