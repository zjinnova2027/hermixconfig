'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { CatalogStore } = require('../src/catalog');
const { GamePublisher } = require('../src/publisher');
const { createApp } = require('../src/server');

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

test('updates hide_game_ui in the public index and pushes it to the remote', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-settings-'));
  const repoRoot = path.join(root, 'hermixrom');
  const remoteRoot = path.join(root, 'hermixrom.git');
  fs.mkdirSync(repoRoot, { recursive: true });
  git(['init', '--bare', remoteRoot]);
  git(['init', '-b', 'main'], { cwd: repoRoot });
  git(['config', 'user.email', 'test@example.com'], { cwd: repoRoot });
  git(['config', 'user.name', 'Test'], { cwd: repoRoot });
  git(['remote', 'add', 'origin', remoteRoot], { cwd: repoRoot });

  const repository = {
    id: 'hermixrom',
    root: repoRoot,
    remote: 'origin',
    branch: 'main',
    contentRoot: 'public',
    contentRootPath: path.join(repoRoot, 'public'),
    githubUrl: 'https://github.com/example/hermixrom',
    publicBaseUrl: 'https://raw.example/hermixrom/public',
    fallbackPublicBaseUrl: '',
  };
  const config = {
    repositoryRoot: repoRoot,
    repositories: { hermixrom: repository },
    mainRepositoryId: 'hermixrom',
    mainRepository: repository,
    gameTypes: {
      GBA: {
        catalog: 'gba.json',
        extensions: ['.gba', '.zip'],
        repository: 'hermixrom',
        uploadEnabled: true,
      },
    },
    romBytes: 1024 * 1024,
    coverBytes: 1024 * 1024,
    zipMaxEntries: 10,
    zipMaxUncompressedBytes: 1024 * 1024,
  };
  const store = new CatalogStore(config);
  store.ensureStructure();
  git(['add', '-A'], { cwd: repoRoot });
  git(['commit', '-m', 'initial'], { cwd: repoRoot });
  git(['push', '-u', 'origin', 'main'], { cwd: repoRoot });

  const publisher = new GamePublisher(config, store);
  const app = createApp(config, store, publisher);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });

  const initial = await (await fetch(`${baseUrl}/api/client-settings`)).json();
  assert.equal(initial.hide_game_ui, false);

  const updatedResponse = await fetch(`${baseUrl}/api/client-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hide_game_ui: true }),
  });
  assert.equal(updatedResponse.status, 200);
  const updated = await updatedResponse.json();
  assert.equal(updated.hide_game_ui, true);
  assert.equal(updated.changed, true);
  assert.equal(updated.pushed, true);
  assert.ok(updated.commit);

  const remoteIndex = JSON.parse(
    git(['--git-dir', remoteRoot, 'show', 'HEAD:public/catalog/index.json']),
  );
  assert.equal(remoteIndex.hide_game_ui, true);

  const unchangedResponse = await fetch(`${baseUrl}/api/client-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hide_game_ui: true }),
  });
  const unchanged = await unchangedResponse.json();
  assert.equal(unchanged.hide_game_ui, true);
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.pushed, false);
});

test('rejects a non-boolean hide_game_ui value', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'client-settings-invalid-'));
  const repository = {
    id: 'hermixrom',
    root,
    remote: 'origin',
    branch: 'main',
    contentRoot: 'public',
    contentRootPath: path.join(root, 'public'),
    githubUrl: 'https://github.com/example/hermixrom',
    publicBaseUrl: 'https://raw.example/hermixrom/public',
    fallbackPublicBaseUrl: '',
  };
  const config = {
    repositoryRoot: root,
    repositories: { hermixrom: repository },
    mainRepositoryId: 'hermixrom',
    mainRepository: repository,
    gameTypes: {
      GBA: {
        catalog: 'gba.json',
        extensions: ['.gba'],
        repository: 'hermixrom',
        uploadEnabled: true,
      },
    },
    romBytes: 1024,
    coverBytes: 1024,
    zipMaxEntries: 10,
    zipMaxUncompressedBytes: 1024,
  };
  const store = new CatalogStore(config);
  store.ensureStructure();
  const publisher = new GamePublisher(config, store);
  const app = createApp(config, store, publisher);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });

  const response = await fetch(`${baseUrl}/api/client-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hide_game_ui: 'true' }),
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.code, 'INVALID_HIDE_GAME_UI');
});
