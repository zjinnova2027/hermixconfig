'use strict';

const fs = require('node:fs');
const path = require('node:path');

const projectRoot = path.resolve(__dirname, '../../..');
const repositoryRoot = path.resolve(
  process.env.GAME_PUBLISHER_REPO_ROOT || projectRoot,
);
const configPath = path.resolve(
  process.env.GAME_PUBLISHER_CONFIG ||
    path.join(repositoryRoot, 'publisher.config.json'),
);

function fail(message) {
  throw new Error(`配置错误: ${message}`);
}

function normalizeUrl(value, label, { required = true } = {}) {
  const url = String(value || '').trim().replace(/\/+$/, '');
  if (!url && !required) return '';
  if (!url.startsWith('https://')) {
    fail(`${label} 必须是 HTTPS 地址`);
  }
  return url;
}

function normalizeRepository(id, rawValue, configDirectory, isDefault) {
  const value = rawValue || {};
  const root = path.resolve(
    configDirectory,
    String(value.root || (isDefault ? repositoryRoot : '')),
  );
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    fail(`仓库 ${id} 的 root 不存在或不是目录: ${root}`);
  }
  const remote = String(value.remote || 'origin');
  const branch = String(value.branch || 'main');
  const contentRoot = String(value.contentRoot || 'public');
  const githubUrl = String(value.githubUrl || '').trim().replace(/\/+$/, '');
  const publicBaseUrl = normalizeUrl(
    value.publicBaseUrl,
    `repositories.${id}.publicBaseUrl`,
  );
  const fallbackPublicBaseUrl = normalizeUrl(
    value.fallbackPublicBaseUrl,
    `repositories.${id}.fallbackPublicBaseUrl`,
    { required: false },
  );
  if (!githubUrl.startsWith('https://')) {
    fail(`repositories.${id}.githubUrl 必须是 HTTPS 地址`);
  }
  return {
    id,
    root,
    remote,
    branch,
    contentRoot,
    contentRootPath: path.join(root, contentRoot),
    githubUrl,
    publicBaseUrl,
    fallbackPublicBaseUrl,
  };
}

function loadConfig() {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (error) {
    throw new Error(`无法读取配置文件 ${configPath}: ${error.message}`);
  }

  const server = parsed.server || {};
  const limits = parsed.limits || {};
  const gameTypes = parsed.gameTypes || {};
  const configDirectory = path.dirname(configPath);

  const host = String(server.host || '127.0.0.1');
  const port = Number(server.port || 4173);
  const romBytes = Number(limits.romBytes || 10 * 1024 * 1024);
  const coverBytes = Number(limits.coverBytes || 2 * 1024 * 1024);
  const zipMaxEntries = Number(limits.zipMaxEntries || 2048);
  const zipMaxUncompressedBytes = Number(
    limits.zipMaxUncompressedBytes || 128 * 1024 * 1024,
  );

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    fail('server.port 必须是 1-65535 的整数');
  }
  if (!Number.isSafeInteger(romBytes) || romBytes < 1) {
    fail('limits.romBytes 必须是正整数');
  }
  if (!Number.isSafeInteger(coverBytes) || coverBytes < 1) {
    fail('limits.coverBytes 必须是正整数');
  }
  if (!Number.isSafeInteger(zipMaxEntries) || zipMaxEntries < 1) {
    fail('limits.zipMaxEntries 必须是正整数');
  }
  if (
    !Number.isSafeInteger(zipMaxUncompressedBytes) ||
    zipMaxUncompressedBytes < 1
  ) {
    fail('limits.zipMaxUncompressedBytes 必须是正整数');
  }
  if (Object.keys(gameTypes).length === 0) {
    fail('gameTypes 不能为空');
  }

  const rawRepositories = parsed.repositories;
  const mainRepositoryId = String(
    parsed.mainRepository || parsed.defaultRepository || 'gamelist',
  );
  let normalizedRepositories = {};

  if (rawRepositories && Object.keys(rawRepositories).length > 0) {
    for (const [rawId, value] of Object.entries(rawRepositories)) {
      const id = String(rawId).trim().toLowerCase();
      if (!/^[a-z0-9-]+$/.test(id)) {
        fail(`仓库 ID ${rawId} 只能包含小写字母、数字和连字符`);
      }
      normalizedRepositories[id] = normalizeRepository(
        id,
        value,
        configDirectory,
        id === mainRepositoryId,
      );
    }
  } else {
    // 兼容旧的单仓库配置结构；新配置应使用 repositories。
    const legacy = parsed.repository || {};
    normalizedRepositories = {
      [mainRepositoryId]: normalizeRepository(
        mainRepositoryId,
        {
          root: repositoryRoot,
          remote: legacy.remote,
          branch: legacy.branch,
          contentRoot: legacy.contentRoot,
          githubUrl: legacy.githubUrl,
          publicBaseUrl: parsed.publicBaseUrl,
          fallbackPublicBaseUrl: parsed.fallbackPublicBaseUrl,
        },
        configDirectory,
        true,
      ),
    };
  }

  if (!normalizedRepositories[mainRepositoryId]) {
    fail(`mainRepository 指向不存在的仓库: ${mainRepositoryId}`);
  }

  const normalizedTypes = {};
  for (const [rawType, rawValue] of Object.entries(gameTypes)) {
    const type = rawType.toUpperCase();
    const catalog = String(rawValue.catalog || '').trim();
    const extensions = (rawValue.extensions || []).map((value) =>
      String(value).toLowerCase(),
    );
    const repository = String(
      rawValue.repository || mainRepositoryId,
    ).trim().toLowerCase();

    if (!/^[A-Z0-9]+$/.test(type)) {
      fail(`游戏类型 ${rawType} 只能包含字母和数字`);
    }
    if (!/^[a-z0-9-]+\.json$/.test(catalog)) {
      fail(`${type}.catalog 必须是小写 JSON 文件名`);
    }
    if (extensions.length === 0 || extensions.some((ext) => !/^\.[a-z0-9]+$/.test(ext))) {
      fail(`${type}.extensions 配置无效`);
    }
    if (!normalizedRepositories[repository]) {
      fail(`${type}.repository 指向不存在的仓库: ${repository}`);
    }
    normalizedTypes[type] = {
      catalog,
      extensions: [...new Set(extensions)],
      repository,
      uploadEnabled: rawValue.uploadEnabled !== false,
    };
  }

  const mainRepository = normalizedRepositories[mainRepositoryId];
  return {
    configPath,
    repositoryRoot: mainRepository.root,
    repositories: normalizedRepositories,
    mainRepositoryId,
    mainRepository,
    host,
    port,
    remote: mainRepository.remote,
    branch: mainRepository.branch,
    contentRoot: mainRepository.contentRoot,
    githubUrl: mainRepository.githubUrl,
    publicBaseUrl: mainRepository.publicBaseUrl,
    fallbackPublicBaseUrl: mainRepository.fallbackPublicBaseUrl,
    romBytes,
    coverBytes,
    zipMaxEntries,
    zipMaxUncompressedBytes,
    gameTypes: normalizedTypes,
  };
}

module.exports = { loadConfig };
