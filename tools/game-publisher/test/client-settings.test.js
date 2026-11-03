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

test('updates platform hide_game_ui flags and pushes the client config', async (t) => {
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
  assert.deepEqual(initial.hide_game_ui, { android: false, ios: false });

  const updatedResponse = await fetch(`${baseUrl}/api/client-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hide_game_ui: { android: true, ios: false } }),
  });
  assert.equal(updatedResponse.status, 200);
  const updated = await updatedResponse.json();
  assert.deepEqual(updated.hide_game_ui, { android: true, ios: false });
  assert.equal(updated.changed, true);
  assert.equal(updated.pushed, true);
  assert.ok(updated.commit);

  const remoteClientConfig = JSON.parse(
    git(['--git-dir', remoteRoot, 'show', 'HEAD:public/config/client.json']),
  );
  assert.deepEqual(remoteClientConfig.hide_game_ui, {
    android: true,
    ios: false,
  });
  const remoteIndex = JSON.parse(
    git(['--git-dir', remoteRoot, 'show', 'HEAD:public/catalog/index.json']),
  );
  assert.equal(Object.hasOwn(remoteIndex, 'hide_game_ui'), false);

  const unchangedResponse = await fetch(`${baseUrl}/api/client-settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hide_game_ui: { android: true, ios: false } }),
  });
  const unchanged = await unchangedResponse.json();
  assert.deepEqual(unchanged.hide_game_ui, { android: true, ios: false });
  assert.equal(unchanged.changed, false);
  assert.equal(unchanged.pushed, false);
});

test('rejects platform flags that are not both booleans', async (t) => {
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
    body: JSON.stringify({ hide_game_ui: { android: true, ios: 'false' } }),
  });
  assert.equal(response.status, 400);
  const payload = await response.json();
  assert.equal(payload.code, 'INVALID_HIDE_GAME_UI');
});
