'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const yazl = require('yazl');
const {
  detectCoverExtension,
  downloadFileNameForUpload,
  makeGameId,
  normalizeType,
  safeDownloadFileName,
  sha256,
  validateGameId,
  validateRom,
} = require('../src/files');

const gameTypes = {
  GBA: { catalog: 'gba.json', extensions: ['.gba', '.zip'] },
  MD: { catalog: 'md.json', extensions: ['.md', '.bin', '.zip'] },
  CPS1: { catalog: 'cps1.json', extensions: ['.zip'] },
  FC: { catalog: 'fc.json', extensions: ['.nes', '.zip'] },
};

test('normalizes supported game types', () => {
  assert.equal(normalizeType('gba', gameTypes), 'GBA');
  assert.throws(() => normalizeType('SNES', gameTypes), /不支持/);
});

test('validates ROM extension and preserves buffer', async () => {
  const buffer = Buffer.from('rom');
  const result = await validateRom(
    { filename: 'game.gba', buffer, truncated: false },
    'GBA',
    gameTypes,
    100,
  );
  assert.equal(result.extension, '.gba');
  assert.equal(result.buffer, buffer);
});

test('rejects oversized and mismatched ROMs', async () => {
  await assert.rejects(
    () =>
      validateRom(
        { filename: 'game.gba', buffer: Buffer.alloc(11), truncated: false },
        'GBA',
        gameTypes,
        10,
      ),
    /大小限制/,
  );
  await assert.rejects(
    () =>
      validateRom(
        { filename: 'game.gba', buffer: Buffer.from('rom'), truncated: false },
        'CPS1',
        gameTypes,
        100,
      ),
    /扩展名/,
  );
});

test('detects supported cover signatures', () => {
  const png = Buffer.from([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
  assert.equal(detectCoverExtension({ buffer: png, truncated: false }, 100), '.png');
  assert.throws(
    () => detectCoverExtension({ buffer: Buffer.from('not-image'), truncated: false }, 100),
    /JPG/,
  );
});

test('uses MAME set name for CPS1 download files', () => {
  assert.equal(
    downloadFileNameForUpload('CPS1', 'cps1-20261022-a1b2c3d4', '.zip', 'punisher.zip'),
    'punisher.zip',
  );
  assert.throws(
    () =>
      downloadFileNameForUpload(
        'CPS1',
        'cps1-20261022-a1b2c3d4',
        '.zip',
        '惩罚者（世界版）.zip',
      ),
    /MAME 集合短名/,
  );
});

test('creates download names containing only letters, numbers and extension', () => {
  const name = safeDownloadFileName('gba-20261022-a1b2c3d4', '.zip');
  assert.equal(name, 'gba20261022a1b2c3d4.zip');
  assert.match(name, /^[A-Za-z0-9]+\.[A-Za-z0-9]+$/);
});

test('creates parseable game IDs and stable SHA-256 values', () => {
  const id = makeGameId('GBA', new Date(2026, 9, 22));
  assert.match(id, /^gba-20261022-[a-f0-9]{8}$/);
  assert.equal(validateGameId(id), true);
  assert.equal(
    sha256(Buffer.from('abc')),
    'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
  );
});

test('detects GBA, MD and FC headers inside ZIP archives', async () => {
  const gba = await validateRom(
    await zipFile('game.zip', { 'game.gba': makeGba() }),
    'GBA',
    gameTypes,
    1024 * 1024,
  );
  assert.equal(gba.archive.detectedType, 'GBA');

  const md = await validateRom(
    await zipFile('game.zip', { 'roms/game.bin': makeMd() }),
    'MD',
    gameTypes,
    1024 * 1024,
  );
  assert.equal(md.archive.detectedType, 'MD');

  const fc = await validateRom(
    await zipFile('game.zip', { 'game.nes': makeFc() }),
    'FC',
    gameTypes,
    1024 * 1024,
  );
  assert.equal(fc.archive.detectedType, 'FC');
});

test('rejects a ZIP whose detected type does not match the selection', async () => {
  const archive = await zipFile('game.zip', { 'game.gba': makeGba() });
  await assert.rejects(
    () => validateRom(archive, 'MD', gameTypes, 1024 * 1024),
    /识别为 GBA/,
  );
});

test('rejects a ZIP containing mixed game types', async () => {
  const archive = await zipFile('game.zip', {
    'game.gba': makeGba(),
    'game.md': makeMd(),
  });
  await assert.rejects(
    () => validateRom(archive, 'GBA', gameTypes, 1024 * 1024),
    /多种游戏类型/,
  );
});

test('accepts an arcade-style CPS1 ZIP with untyped data files', async () => {
  const result = await validateRom(
    await zipFile('game.zip', {
      'sf2ce.03': Buffer.from('arcade-data-a'),
      'sf2ce.04': Buffer.from('arcade-data-b'),
      'sf2ce.11m': Buffer.from('arcade-data-c'),
    }),
    'CPS1',
    gameTypes,
    1024 * 1024,
  );
  assert.equal(result.archive.detectedType, 'CPS1');
  assert.equal(result.archive.detection, 'arcade-archive');
});

test('rejects invalid ZIP contents', async () => {
  const archive = await zipFile('game.zip', {
    'readme.txt': Buffer.from('hello'),
  });
  await assert.rejects(
    () => validateRom(archive, 'GBA', gameTypes, 1024 * 1024),
    /未找到可识别/,
  );
});

function makeGba() {
  const buffer = Buffer.alloc(0xc0);
  buffer[4] = 0x24;
  buffer[5] = 0xff;
  buffer[6] = 0xae;
  buffer[7] = 0x51;
  buffer[0xb2] = 0x96;
  return buffer;
}

function makeMd() {
  const buffer = Buffer.alloc(0x110);
  buffer.write('SEGA MEGA DRIVE ', 0x100, 'ascii');
  return buffer;
}

function makeFc() {
  return Buffer.from([0x4e, 0x45, 0x53, 0x1a, ...Buffer.alloc(28)]);
}

async function zipFile(filename, entries) {
  return {
    filename,
    buffer: await createZip(entries),
    truncated: false,
  };
}

function createZip(entries) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const chunks = [];
    for (const [name, data] of Object.entries(entries)) {
      zip.addBuffer(data, name);
    }
    zip.outputStream.on('data', (chunk) => chunks.push(chunk));
    zip.outputStream.on('error', reject);
    zip.outputStream.on('end', () => resolve(Buffer.concat(chunks)));
    zip.end();
  });
}
