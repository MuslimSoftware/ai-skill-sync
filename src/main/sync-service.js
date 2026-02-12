import fs from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';

export const DEFAULT_SOURCE = path.join(homedir(), '.codex', 'skills');
export const DEFAULT_TARGETS = [
  path.join(homedir(), '.claude', 'skills'),
  path.join(homedir(), 'agents')
];

function uniq(items) {
  return [...new Set(items)];
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function isDirectory(p) {
  try {
    const stat = await fs.stat(p);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

async function readEntriesSafe(dir) {
  try {
    return await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

function shouldIgnore(name) {
  return name === '.DS_Store';
}

function listSkillNames(entries) {
  return entries
    .filter((entry) => entry.isDirectory() && !shouldIgnore(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function isSafeSkillName(value) {
  if (typeof value !== 'string') {
    return false;
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    return false;
  }

  return !trimmed.includes('/') && !trimmed.includes('\\');
}

function stripQuotedValue(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return '';
  }

  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1).trim();
  }

  return trimmed;
}

function parseSkillFrontmatter(rawText) {
  const normalized = rawText.replace(/\r\n/g, '\n');
  const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);

  if (!match) {
    return {
      name: '',
      description: '',
      shortDescription: '',
      body: normalized
    };
  }

  const block = match[1];
  const body = normalized.slice(match[0].length);
  let name = '';
  let description = '';
  let shortDescription = '';
  let metadataOpen = false;

  for (const line of block.split('\n')) {
    if (!line.trim()) {
      continue;
    }

    if (/^metadata:\s*$/.test(line.trim())) {
      metadataOpen = true;
      continue;
    }

    if (/^\S/.test(line)) {
      metadataOpen = false;
    }

    const directMatch = line.match(/^(name|description):\s*(.+)\s*$/);
    if (directMatch) {
      const key = directMatch[1];
      const value = stripQuotedValue(directMatch[2]);
      if (key === 'name') {
        name = value;
      } else if (key === 'description') {
        description = value;
      }
      continue;
    }

    if (!metadataOpen) {
      continue;
    }

    const shortMatch = line.match(/^\s+short-description:\s*(.+)\s*$/);
    if (shortMatch) {
      shortDescription = stripQuotedValue(shortMatch[1]);
    }
  }

  return {
    name,
    description,
    shortDescription,
    body
  };
}

function extractPreview(body) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) {
      continue;
    }

    return trimmed;
  }

  return '';
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function walkDirectory(dirPath, relativeTo) {
  const results = [];

  async function walk(currentPath) {
    const entries = await readEntriesSafe(currentPath);
    for (const entry of entries) {
      if (shouldIgnore(entry.name)) continue;

      const fullPath = path.join(currentPath, entry.name);
      const relPath = path.relative(relativeTo, fullPath);

      if (entry.isDirectory()) {
        results.push({ name: entry.name, path: relPath, type: 'directory', size: 0 });
        await walk(fullPath);
      } else {
        let size = 0;
        try {
          const stat = await fs.stat(fullPath);
          size = stat.size;
        } catch {}
        results.push({ name: entry.name, path: relPath, type: 'file', size });
      }
    }
  }

  await walk(dirPath);
  return results;
}

export function resolveUserPath(input) {
  if (!input || typeof input !== 'string') {
    return '';
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return '';
  }

  if (trimmed === '~') {
    return homedir();
  }

  if (trimmed.startsWith('~/')) {
    return path.join(homedir(), trimmed.slice(2));
  }

  return path.resolve(trimmed);
}

async function summarizePath(p) {
  const resolvedPath = resolveUserPath(p);
  const pathExists = await exists(resolvedPath);

  if (!pathExists) {
    return {
      path: resolvedPath,
      exists: false,
      isDirectory: false,
      skillCount: 0,
      skillNames: []
    };
  }

  const dir = await isDirectory(resolvedPath);
  if (!dir) {
    return {
      path: resolvedPath,
      exists: true,
      isDirectory: false,
      skillCount: 0,
      skillNames: []
    };
  }

  const entries = await readEntriesSafe(resolvedPath);
  const skillNames = listSkillNames(entries);

  return {
    path: resolvedPath,
    exists: true,
    isDirectory: true,
    skillCount: skillNames.length,
    skillNames
  };
}

export async function inspectPaths({
  source = DEFAULT_SOURCE,
  targets = DEFAULT_TARGETS
} = {}) {
  const resolvedSource = resolveUserPath(source);
  const resolvedTargets = uniq((targets ?? []).map(resolveUserPath).filter(Boolean));

  const [sourceSummary, targetSummaries] = await Promise.all([
    summarizePath(resolvedSource),
    Promise.all(resolvedTargets.map((target) => summarizePath(target)))
  ]);

  return {
    checkedAt: new Date().toISOString(),
    source: sourceSummary,
    targets: targetSummaries
  };
}

export async function getSkillDetails({
  directoryPath = '',
  skillName = ''
} = {}) {
  const resolvedDirectory = resolveUserPath(directoryPath);
  if (!resolvedDirectory || !(await isDirectory(resolvedDirectory))) {
    throw new Error(`Directory is missing or invalid: ${resolvedDirectory}`);
  }

  if (!isSafeSkillName(skillName)) {
    throw new Error(`Invalid skill name: ${skillName}`);
  }

  const skillPath = path.join(resolvedDirectory, skillName);
  const skillExists = await exists(skillPath);

  if (!skillExists) {
    return {
      directoryPath: resolvedDirectory,
      skillName,
      skillPath,
      exists: false,
      isDirectory: false,
      hasSkillFile: false,
      title: skillName,
      description: '',
      shortDescription: '',
      preview: '',
      childDirectoryCount: 0,
      childDirectories: []
    };
  }

  const skillIsDirectory = await isDirectory(skillPath);
  if (!skillIsDirectory) {
    return {
      directoryPath: resolvedDirectory,
      skillName,
      skillPath,
      exists: true,
      isDirectory: false,
      hasSkillFile: false,
      title: skillName,
      description: '',
      shortDescription: '',
      preview: '',
      childDirectoryCount: 0,
      childDirectories: []
    };
  }

  const entries = await readEntriesSafe(skillPath);
  const childDirectories = listSkillNames(entries);
  const skillFilePath = path.join(skillPath, 'SKILL.md');
  const hasSkillFile = await exists(skillFilePath);

  let title = skillName;
  let description = '';
  let shortDescription = '';
  let preview = '';
  let skillFileContent = '';

  if (hasSkillFile) {
    try {
      const rawSkillFile = await fs.readFile(skillFilePath, 'utf8');
      skillFileContent = rawSkillFile;
      const parsed = parseSkillFrontmatter(rawSkillFile);
      title = parsed.name || skillName;
      description = parsed.description;
      shortDescription = parsed.shortDescription;
      preview = extractPreview(parsed.body);
    } catch {
      preview = '';
    }
  }

  const fileTree = await walkDirectory(skillPath, skillPath);
  const files = fileTree.filter((f) => f.type === 'file');
  const directories = fileTree.filter((f) => f.type === 'directory');
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);

  return {
    directoryPath: resolvedDirectory,
    skillName,
    skillPath,
    exists: true,
    isDirectory: true,
    hasSkillFile,
    title,
    description,
    shortDescription,
    preview,
    skillFileContent,
    childDirectoryCount: childDirectories.length,
    childDirectories,
    fileTree,
    fileCount: files.length,
    directoryCount: directories.length,
    totalSize,
    totalSizeFormatted: formatFileSize(totalSize)
  };
}

async function copyEntry(sourcePath, targetPath) {
  await fs.rm(targetPath, { recursive: true, force: true });
  await fs.cp(sourcePath, targetPath, {
    recursive: true,
    force: true,
    preserveTimestamps: true,
    errorOnExist: false
  });
}

async function syncTarget({ source, target, sourceEntries, prune }) {
  await fs.mkdir(target, { recursive: true });

  const usableSourceEntries = sourceEntries.filter((entry) => !shouldIgnore(entry.name));
  const sourceNameSet = new Set(usableSourceEntries.map((entry) => entry.name));

  let copied = 0;
  for (const entry of usableSourceEntries) {
    const sourcePath = path.join(source, entry.name);
    const targetPath = path.join(target, entry.name);
    await copyEntry(sourcePath, targetPath);
    copied += 1;
  }

  let removed = 0;
  if (prune) {
    const targetEntries = await readEntriesSafe(target);
    for (const entry of targetEntries) {
      if (!sourceNameSet.has(entry.name)) {
        await fs.rm(path.join(target, entry.name), { recursive: true, force: true });
        removed += 1;
      }
    }
  }

  const finalEntries = await readEntriesSafe(target);
  const skillNames = listSkillNames(finalEntries);

  return {
    target,
    status: 'ok',
    copied,
    removed,
    skillCount: skillNames.length,
    skillNames
  };
}

export async function syncSkills({
  source = DEFAULT_SOURCE,
  targets = DEFAULT_TARGETS,
  prune = true
} = {}) {
  const startedAt = new Date();
  const resolvedSource = resolveUserPath(source);
  const resolvedTargets = uniq((targets ?? []).map(resolveUserPath).filter(Boolean));

  if (!(await isDirectory(resolvedSource))) {
    throw new Error(`Source directory is missing or invalid: ${resolvedSource}`);
  }

  const sourceEntries = await readEntriesSafe(resolvedSource);
  const results = [];
  let success = true;

  for (const target of resolvedTargets) {
    if (target === resolvedSource) {
      results.push({
        target,
        status: 'skipped',
        copied: 0,
        removed: 0,
        skillCount: 0,
        skillNames: [],
        error: 'Target equals source path and was skipped.'
      });
      continue;
    }

    try {
      const result = await syncTarget({
        source: resolvedSource,
        target,
        sourceEntries,
        prune: Boolean(prune)
      });
      results.push(result);
    } catch (error) {
      success = false;
      results.push({
        target,
        status: 'error',
        copied: 0,
        removed: 0,
        skillCount: 0,
        skillNames: [],
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  const finishedAt = new Date();

  return {
    success,
    source: resolvedSource,
    prune: Boolean(prune),
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    sourceEntryCount: sourceEntries.filter((entry) => !shouldIgnore(entry.name)).length,
    results
  };
}
