'use strict';

const path = require('node:path');
const yauzl = require('yauzl');

const DEFAULT_MAX_ENTRIES = 2048;
const DEFAULT_MAX_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
const HEADER_BYTES = 0x120;

function inspectZip(buffer, selectedType, limits = {}) {
  const maxEntries = Number(limits.maxEntries || DEFAULT_MAX_ENTRIES);
  const maxUncompressedBytes = Number(
    limits.maxUncompressedBytes || DEFAULT_MAX_UNCOMPRESSED_BYTES,
  );

  return new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      buffer,
      { lazyEntries: true, decodeStrings: true },
      (error, zipFile) => {
        if (error || !zipFile) {
          reject(zipError(selectedType));
          return;
        }

        const entries = [];
        const detectedTypes = new Set();
        let totalUncompressed = 0;
        let finished = false;

        const fail = (failure) => {
          if (finished) return;
          finished = true;
          zipFile.close();
          reject(failure);
        };

        zipFile.on('error', () => fail(zipError(selectedType)));
        zipFile.on('entry', (entry) => {
          if (finished) return;

          const entryName = String(entry.fileName || '').replace(/\\/g, '/');
          if (isDirectory(entryName) || isIgnoredEntry(entryName)) {
            zipFile.readEntry();
            return;
          }
          if (isUnsafePath(entryName)) {
            fail(
              httpError(
                400,
                'UNSAFE_ZIP_ENTRY',
                `ZIP 包含不安全路径: ${entryName}`,
              ),
            );
            return;
          }
          if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
            fail(
              httpError(
                400,
                'ENCRYPTED_ZIP',
                '暂不支持加密 ZIP，请上传未加密的游戏包',
              ),
            );
            return;
          }
          if (path.posix.extname(entryName).toLowerCase() === '.zip') {
            fail(
              httpError(
                400,
                'NESTED_ZIP',
                'ZIP 内不能再嵌套 ZIP，请直接压缩游戏文件',
              ),
            );
            return;
          }

          entries.push({
            name: entryName,
            compressedSize: Number(entry.compressedSize || 0),
            uncompressedSize: Number(entry.uncompressedSize || 0),
          });
          totalUncompressed += Number(entry.uncompressedSize || 0);

          if (entries.length > maxEntries) {
            fail(
              httpError(
                400,
                'ZIP_TOO_MANY_ENTRIES',
                `ZIP 文件数量超过限制（最多 ${maxEntries} 个）`,
              ),
            );
            return;
          }
          if (totalUncompressed > maxUncompressedBytes) {
            fail(
              httpError(
                400,
                'ZIP_UNCOMPRESSED_TOO_LARGE',
                'ZIP 解压后体积超过安全限制',
              ),
            );
            return;
          }

          readPrefix(zipFile, entry)
            .then((prefix) => {
              if (finished) return;
              const detectedType = detectType(entryName, prefix);
              if (detectedType) detectedTypes.add(detectedType);
              zipFile.readEntry();
            })
            .catch(() => fail(zipError(selectedType)));
        });

        zipFile.on('end', () => {
          if (finished) return;
          finished = true;
          try {
            resolve(
              classifyArchive(selectedType, entries, detectedTypes, {
                maxEntries,
                maxUncompressedBytes,
              }),
            );
          } catch (failure) {
            reject(failure);
          }
        });

        zipFile.readEntry();
      },
    );
  });
}

function readPrefix(zipFile, entry) {
  return new Promise((resolve, reject) => {
    zipFile.openReadStream(entry, (error, stream) => {
      if (error || !stream) {
        reject(error || new Error('无法读取 ZIP 条目'));
        return;
      }

      const chunks = [];
      let captured = 0;
      stream.on('data', (chunk) => {
        if (captured >= HEADER_BYTES) return;
        const remaining = HEADER_BYTES - captured;
        const part = chunk.length <= remaining ? chunk : chunk.subarray(0, remaining);
        chunks.push(part);
        captured += part.length;
      });
      stream.on('error', reject);
      stream.on('end', () => resolve(Buffer.concat(chunks, captured)));
    });
  });
}

function detectType(entryName, prefix) {
  const extension = path.posix.extname(entryName).toLowerCase();
  if (isGba(prefix)) return 'GBA';
  if (isFc(prefix)) return 'FC';
  if (isMd(prefix) || extension === '.smd') return 'MD';
  return null;
}

function isGba(buffer) {
  return (
    buffer.length >= 0xc0 &&
    buffer[4] === 0x24 &&
    buffer[5] === 0xff &&
    buffer[6] === 0xae &&
    buffer[7] === 0x51 &&
    buffer[0xb2] === 0x96
  );
}

function isFc(buffer) {
  if (buffer.length < 4) return false;
  const magic = buffer.toString('ascii', 0, 4);
  return magic === 'NES\x1a' || magic === 'FDS\x1a' || magic === 'UNIF';
}

function isMd(buffer) {
  if (buffer.length < 0x110) return false;
  const header = buffer.toString('ascii', 0x100, 0x110);
  return (
    header.includes('SEGA MEGA DRIVE') ||
    header.includes('SEGA GENESIS') ||
    header.includes('SEGA 32X')
  );
}

function classifyArchive(selectedType, entries, detectedTypes, limits) {
  if (entries.length === 0) {
    throw httpError(400, 'EMPTY_ZIP', 'ZIP 内没有游戏文件');
  }

  const detected = [...detectedTypes];
  if (detected.length > 1) {
    throw httpError(
      400,
      'MIXED_GAME_TYPES',
      `ZIP 内包含多种游戏类型: ${detected.join(', ')}`,
    );
  }

  if (detected.length === 1) {
    const actualType = detected[0];
    if (actualType !== selectedType) {
      throw httpError(
        400,
        'GAME_TYPE_MISMATCH',
        `ZIP 内容识别为 ${actualType}，与选择的 ${selectedType} 不一致`,
      );
    }
    return {
      format: 'zip',
      detectedType: actualType,
      detection: 'file-header',
      entryCount: entries.length,
      uncompressedSize: entries.reduce(
        (sum, entry) => sum + entry.uncompressedSize,
        0,
      ),
      limits,
    };
  }

  if (selectedType === 'CPS1') {
    return {
      format: 'zip',
      detectedType: 'CPS1',
      detection: 'arcade-archive',
      entryCount: entries.length,
      uncompressedSize: entries.reduce(
        (sum, entry) => sum + entry.uncompressedSize,
        0,
      ),
      limits,
    };
  }

  throw httpError(
    400,
    'UNRECOGNIZED_GAME_TYPE',
    `ZIP 内未找到可识别的 ${selectedType} 游戏文件`,
  );
}

function isDirectory(name) {
  return name.endsWith('/');
}

function isIgnoredEntry(name) {
  const lower = name.toLowerCase();
  const base = path.posix.basename(lower);
  return (
    lower.startsWith('__macosx/') ||
    base === '.ds_store' ||
    base === 'thumbs.db' ||
    base === 'desktop.ini'
  );
}

function isUnsafePath(name) {
  if (name.startsWith('/') || /^[a-zA-Z]:\//.test(name)) return true;
  return name.split('/').some((part) => part === '..');
}

function zipError(type) {
  return httpError(
    400,
    'INVALID_ZIP',
    `${type} 的 ZIP 游戏包无法读取或格式无效`,
  );
}

function httpError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

module.exports = { detectType, inspectZip };
