import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { inspectPaths, syncSkills } from '../src/main/sync-service.js';

async function makeTempDir(name) {
  return fs.mkdtemp(path.join(os.tmpdir(), name));
}

async function writeText(filePath, content) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf8');
}

async function dirNames(target) {
  const entries = await fs.readdir(target, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

test('syncSkills mirrors source and prunes stale target entries', async (t) => {
  const root = await makeTempDir('skill-sync-prune-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const source = path.join(root, 'source');
  const target = path.join(root, 'target');

  await writeText(path.join(source, '.system', 'skill-installer', 'SKILL.md'), 'installer');
  await writeText(path.join(source, 'ralph', 'SKILL.md'), 'ralph');

  await writeText(path.join(target, 'legacy-skill', 'SKILL.md'), 'legacy');
  await writeText(path.join(target, 'ralph', 'OLD.md'), 'old-file');

  const result = await syncSkills({ source, targets: [target], prune: true });

  assert.equal(result.success, true);
  assert.equal(result.results[0].status, 'ok');
  assert.equal(result.results[0].copied, 2);
  assert.equal(result.results[0].removed, 1);

  const finalDirs = await dirNames(target);
  assert.deepEqual(finalDirs, ['.system', 'ralph']);

  const copiedText = await fs.readFile(path.join(target, 'ralph', 'SKILL.md'), 'utf8');
  assert.equal(copiedText, 'ralph');
});

test('syncSkills keeps non-source entries when prune is disabled', async (t) => {
  const root = await makeTempDir('skill-sync-keep-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const source = path.join(root, 'source');
  const target = path.join(root, 'target');

  await writeText(path.join(source, 'prd-workflow', 'SKILL.md'), 'prd');
  await writeText(path.join(target, 'custom-local-skill', 'SKILL.md'), 'custom');

  const result = await syncSkills({ source, targets: [target], prune: false });

  assert.equal(result.success, true);
  assert.equal(result.results[0].status, 'ok');
  assert.equal(result.results[0].removed, 0);

  const finalDirs = await dirNames(target);
  assert.deepEqual(finalDirs, ['custom-local-skill', 'prd-workflow']);
});

test('inspectPaths reports missing targets and source skills', async (t) => {
  const root = await makeTempDir('skill-sync-inspect-');
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  const source = path.join(root, 'source');
  const missingTarget = path.join(root, 'missing-target');

  await writeText(path.join(source, 'alpha', 'SKILL.md'), 'alpha');
  await writeText(path.join(source, 'beta', 'SKILL.md'), 'beta');

  const inspected = await inspectPaths({ source, targets: [missingTarget] });

  assert.equal(inspected.source.exists, true);
  assert.equal(inspected.source.skillCount, 2);
  assert.equal(inspected.targets[0].exists, false);
  assert.equal(inspected.targets[0].skillCount, 0);
});
