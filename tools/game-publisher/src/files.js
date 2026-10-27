'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { inspectZip } = require('./zip-inspect');

function normalizeType(value, gameTypes) {
  const type = String(value || '').trim().toUpperCase();
  if (!Object.hasOwn(gameTypes, type)) {
    throw Object.assign(new Error(`不支持的游戏类型: ${value || '(空)'}`), {
      statusCode: 400,
      code: 'INVALID_GAME_TYPE',
    });
  }
  return type;
}

function extensionOf(filename) {
  return path.extname(String(filename || '')).toLowerCase();
}

function cleanDisplayName(value) {
  const name = String(value || '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim();
  if (!name) {
    throw Object.assign(new Error('游戏名称不能为空'), {
      statusCode: 400,
      code: 'INVALID_NAME',
    });
  }
  if (name.length > 160) {
    throw Object.assign(new Error('游戏名称不能超过 160 个字符'), {
      statusCode: 400,
      code: 'INVALID_NAME',
    });
  }
  return name;
}

function makeGameId(type, now = new Date()) {
  const date = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('');
  return `${type.toLowerCase()}-${date}-${crypto.randomBytes(4).toString('hex')}`;
}

function validateGameId(id) {
  return /^[a-z0-9]+-\d{8}-[a-f0-9]{8}$/.test(String(id || ''));
}

async function validateRom(file, type, gameTypes, maxBytes, zipLimits = {}) {
  if (!file || !file.buffer) {
    throw Object.assign(new Error('必须选择 ROM 文件'), {
      statusCode: 400,
      code: 'MISSING_ROM',
    });
  }
  if (file.truncated) {
    throw Object.assign(new Error('ROM 文件超过大小限制'), {
      statusCode: 413,
      code: 'ROM_TOO_LARGE',
    });
  }
  if (file.buffer.length === 0) {
    throw Object.assign(new Error('ROM 文件为空'), {
      statusCode: 400,
      code: 'EMPTY_ROM',
    });
  }
  if (file.buffer.length > maxBytes) {
    throw Object.assign(new Error('ROM 文件超过大小限制'), {
      statusCode: 413,
      code: 'ROM_TOO_LARGE',
    });
  }

  const extension = extensionOf(file.filename);
  if (!gameTypes[type].extensions.includes(extension)) {
    throw Object.assign(
      new Error(
        `${type} 允许的 ROM 扩展名: ${gameTypes[type].extensions.join(', ')}`,
      ),
      { statusCode: 400, code: 'INVALID_ROM_EXTENSION' },
    );
  }

  let archive = null;
  if (extension === '.zip') {
    archive = await inspectZip(file.buffer, type, zipLimits);
  }

  return {
    extension,
    filename: file.filename,
    buffer: file.buffer,
    archive,
  };
}


function detectCoverExtension(file, maxBytes) {
  if (!file || !file.buffer) return null;
  if (file.truncated || file.buffer.length > maxBytes) {
    throw Object.assign(new Error('海报文件超过大小限制'), {
      statusCode: 413,
      code: 'COVER_TOO_LARGE',
    });
  }

  const buffer = file.buffer;
  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return '.jpg';
  }
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return '.png';
  }
  if (
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP'
  ) {
    return '.webp';
  }

  throw Object.assign(new Error('海报仅支持 JPG、PNG 或 WebP'), {
    statusCode: 400,
    code: 'INVALID_COVER',
  });
}

function safeDownloadFileName(id, extension) {
  const stem = String(id || '').replace(/[^A-Za-z0-9]/g, '');
  const ext = String(extension || '')
    .replace(/^\./, '')
    .replace(/[^A-Za-z0-9]/g, '')
    .toLowerCase();
  if (!stem || !ext) throw new Error('无法生成安全的下载文件名');
  return `${stem}.${ext}`;
}

function downloadFileNameForUpload(type, id, extension, originalFilename) {
  if (String(type).toUpperCase() !== 'CPS1') {
    return safeDownloadFileName(id, extension);
  }

  const original = path.basename(String(originalFilename || '').replace(/\\/g, '/'));
  const stem = original.slice(0, Math.max(0, original.length - path.extname(original).length));
  if (!/^[a-z0-9]+$/.test(stem)) {
    throw Object.assign(
      new Error('CPS1 ZIP 文件名必须是 MAME 集合短名，例如 punisher.zip'),
      { statusCode: 400, code: 'INVALID_CPS1_FILE_NAME' },
    );
  }
  return `${stem}.zip`;
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) {
    const value = bytes / (1024 * 1024);
    return `${Number(value.toFixed(1))}MB`;
  }
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)}KB`;
  return `${bytes}B`;
}

module.exports = {
  cleanDisplayName,
  detectCoverExtension,
  downloadFileNameForUpload,
  extensionOf,
  formatBytes,
  makeGameId,
  normalizeType,
  safeDownloadFileName,
  sha256,
  validateGameId,
  validateRom,
};
