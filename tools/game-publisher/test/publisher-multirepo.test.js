'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { CatalogStore } = require('../src/catalog');
const { GamePublisher } = require('../src/publisher');

function git(args, options = {}) {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    ...options,
  });
}

function repository(id, root, publicBaseUrl, githubUrl) {
  return {
    id,
    root,
    remote: 'origin',
    branch: 'main',
    contentRoot: 'public',
    contentRootPath: path.join(root, 'public'),
    githubUrl,
    publicBaseUrl,
    fallbackPublicBaseUrl: '',
  };
}

test('publishes catalog assets and index across two repositories', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'publisher-multirepo-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const main = path.join(root, 'gamelist');
  const gba = path.join(root, 'gba');
  const mainRemote = path.join(root, 'gamelist.git');
  const gbaRemote = path.join(root, 'gba.git');
  fs.mkdirSync(main, { recursive: true });
  fs.mkdirSync(gba, { recursive: true });
  git(['init', '--bare', mainRemote]);
  git(['init', '--bare', gbaRemote]);

  for (const dir of [main, gba]) {
    git(['init', '-b', 'main'], { cwd: dir });
    git(['config', 'user.email', 'test@example.com'], { cwd: dir });
    git(['config', 'user.name', 'Test'], { cwd: dir });
  }

  const gamelistRepository = repository(
    'gamelist',
    main,
    'https://raw.example/gamelist/public',
    'https://github.com/example/gamelist',
  );
  const gbaRepository = repository(
    'gba',
    gba,
    'https://raw.example/gba/public',
    'https://github.com/example/gba',
  );
  git(['remote', 'add', 'origin', mainRemote], { cwd: main });
  git(['remote', 'add', 'origin', gbaRemote], { cwd: gba });

  const config = {
    repositoryRoot: main,
    repositories: {
      gamelist: gamelistRepository,
      gba: gbaRepository,
    },
    mainRepositoryId: 'gamelist',
    mainRepository: gamelistRepository,
    gameTypes: {
      GBA: {
        catalog: 'gba.json',
        extensions: ['.gba'],
        repository: 'gba',
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

  for (const dir of [main, gba]) {
    git(['add', '-A'], { cwd: dir });
    git(['commit', '-m', 'initial'], { cwd: dir });
    git(['push', '-u', 'origin', 'main'], { cwd: dir });
  }

  const publisher = new GamePublisher(config, store);
  const result = await publisher.saveGame({
    fields: {
      name: '测试游戏',
      name_en: 'Test Game',
      game_type: 'GBA',
    },
    files: {
      rom: {
        filename: 'test.gba',
        mimeType: 'application/octet-stream',
        buffer: Buffer.from('GBA'),
        truncated: false,
      },
    },
  });

  const index = JSON.parse(
    fs.readFileSync(path.join(main, 'public/catalog/index.json'), 'utf8'),
  );
  const catalog = JSON.parse(
    fs.readFileSync(path.join(gba, 'public/catalog/gba.json'), 'utf8'),
  );
  const mainFiles = git([
    '--git-dir',
    mainRemote,
    'ls-tree',
    '-r',
    '--name-only',
    'HEAD',
  ]);
  const gbaFiles = git([
    '--git-dir',
    gbaRemote,
    'ls-tree',
    '-r',
    '--name-only',
    'HEAD',
  ]);

  assert.equal(index.catalogs.GBA.repository, 'gba');
  assert.equal(index.catalogs.GBA.url, 'https://raw.example/gba/public/catalog/gba.json');
  assert.equal(catalog.games.length, 1);
  assert.deepEqual(mainFiles.trim().split('\n'), ['public/catalog/index.json']);
  assert.ok(gbaFiles.includes('public/catalog/gba.json'));
  assert.ok(gbaFiles.includes(`public/roms/gba/${result.game.id}/game.gba`));
  assert.equal(result.repository, 'gba');
  assert.deepEqual(Object.keys(result.commits).sort(), ['gamelist', 'gba']);
});
