'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { CatalogStore } = require('../src/catalog');

function repository(root, id, publicBaseUrl, githubUrl) {
  return {
    id,
    root,
    remote: 'origin',
    branch: 'main',
    contentRoot: 'public',
    contentRootPath: path.join(root, 'public'),
    githubUrl,
    publicBaseUrl,
    fallbackPublicBaseUrl: `${publicBaseUrl}-proxy`,
  };
}

function makeStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-store-'));
  const gamelist = repository(
    root,
    'gamelist',
    'https://example.com/gamelist/public',
    'https://github.com/example/gamelist',
  );
  const config = {
    repositoryRoot: root,
    contentRoot: 'public',
    publicBaseUrl: gamelist.publicBaseUrl,
    repositories: { gamelist },
    mainRepositoryId: 'gamelist',
    mainRepository: gamelist,
    gameTypes: {
      GBA: { catalog: 'gba.json', extensions: ['.gba'], repository: 'gamelist' },
      MD: { catalog: 'md.json', extensions: ['.md'], repository: 'gamelist' },
    },
  };
  return new CatalogStore(config);
}

test('creates one catalog file per type and a versioned index', () => {
  const store = makeStore();
  store.ensureStructure();
  assert.equal(store.readCatalog('GBA').game_type, 'GBA');
  assert.equal(store.readCatalog('MD').games.length, 0);
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(store.catalogRoot, 'index.json'), 'utf8')),
    {
      schema_version: 2,
      updated_at: null,
      repositories: {
        gamelist: {
          url: 'https://github.com/example/gamelist',
          branch: 'main',
          public_base_url: 'https://example.com/gamelist/public',
          fallback_public_base_url: 'https://example.com/gamelist/public-proxy',
        },
      },
      catalogs: {
        GBA: {
          repository: 'gamelist',
          repository_url: 'https://github.com/example/gamelist',
          url: 'https://example.com/gamelist/public/catalog/gba.json',
          fallback_url: 'https://example.com/gamelist/public-proxy/catalog/gba.json',
          updated_at: null,
        },
        MD: {
          repository: 'gamelist',
          repository_url: 'https://github.com/example/gamelist',
          url: 'https://example.com/gamelist/public/catalog/md.json',
          fallback_url: 'https://example.com/gamelist/public-proxy/catalog/md.json',
          updated_at: null,
        },
      },
    },
  );
});

test('resolves relative asset paths against the type repository catalog directory', () => {
  const store = makeStore();
  assert.equal(
    store.publicAssetUrl('GBA', '../roms/gba/id/game.gba'),
    'https://example.com/gamelist/public/roms/gba/id/game.gba',
  );
  assert.equal(
    store.publicAssetUrl('GBA', '../covers/gba/id/cover.webp'),
    'https://example.com/gamelist/public/covers/gba/id/cover.webp',
  );
  assert.equal(
    store.localAssetUrl('GBA', '../roms/gba/id/game.gba'),
    '/media/gamelist/roms/gba/id/game.gba',
  );
});

test('index records each catalog updated_at and repository', () => {
  const store = makeStore();
  store.ensureStructure();
  store.writeCatalog('GBA', {
    updated_at: '2026-10-26T01:02:03.456Z',
    games: [],
  });
  store.writeCatalog('MD', {
    updated_at: '2026-10-26T04:05:06.789Z',
    games: [],
  });
  store.writeIndex();

  const index = JSON.parse(fs.readFileSync(store.indexPath(), 'utf8'));
  assert.equal(index.updated_at, '2026-10-26T04:05:06.789Z');
  assert.equal(index.catalogs.GBA.updated_at, '2026-10-26T01:02:03.456Z');
  assert.equal(index.catalogs.MD.updated_at, '2026-10-26T04:05:06.789Z');
  assert.equal(index.catalogs.GBA.repository, 'gamelist');
});

test('can place a game type in a separate repository', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'catalog-multi-repo-'));
  const gamelistRoot = path.join(root, 'gamelist');
  const gbaRoot = path.join(root, 'gba');
  fs.mkdirSync(gamelistRoot, { recursive: true });
  fs.mkdirSync(gbaRoot, { recursive: true });
  const gamelist = repository(
    gamelistRoot,
    'gamelist',
    'https://example.com/gamelist/public',
    'https://github.com/example/gamelist',
  );
  const gba = repository(
    gbaRoot,
    'gba',
    'https://example.com/gba/public',
    'https://github.com/example/gba',
  );
  const store = new CatalogStore({
    repositories: { gamelist, gba },
    mainRepositoryId: 'gamelist',
    mainRepository: gamelist,
    gameTypes: {
      GBA: { catalog: 'gba.json', extensions: ['.gba'], repository: 'gba' },
      MD: { catalog: 'md.json', extensions: ['.md'], repository: 'gamelist' },
    },
  });

  store.ensureStructure();
  store.writeCatalog('GBA', {
    updated_at: '2026-10-26T05:06:07.890Z',
    games: [],
  });
  store.writeIndex();

  const index = JSON.parse(fs.readFileSync(store.indexPath(), 'utf8'));
  assert.equal(index.catalogs.GBA.repository, 'gba');
  assert.equal(index.catalogs.GBA.repository_url, 'https://github.com/example/gba');
  assert.equal(
    index.catalogs.GBA.url,
    'https://example.com/gba/public/catalog/gba.json',
  );
  assert.equal(index.catalogs.MD.repository, 'gamelist');
  assert.ok(fs.existsSync(path.join(gbaRoot, 'public/catalog/gba.json')));
  assert.ok(fs.existsSync(path.join(gamelistRoot, 'public/catalog/index.json')));
});

test('nextTimestamp is millisecond precision and strictly increases', () => {
  const store = makeStore();
  const previous = new Date().toISOString();
  const next = store.nextTimestamp(previous);
  assert.match(next, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Date.parse(next) > Date.parse(previous));
});
