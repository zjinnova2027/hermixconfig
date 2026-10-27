'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const SCHEMA_VERSION = 2;
const INDEX_SCHEMA_VERSION = 2;

class CatalogStore {
  constructor(config) {
    this.config = config;
    this.repositories =
      config.repositories || {
        gamelist: {
          id: 'gamelist',
          root: config.repositoryRoot,
          remote: config.remote || 'origin',
          branch: config.branch || 'main',
          contentRoot: config.contentRoot || 'public',
          contentRootPath: path.join(config.repositoryRoot, config.contentRoot || 'public'),
          githubUrl: config.githubUrl || '',
          publicBaseUrl: config.publicBaseUrl,
          fallbackPublicBaseUrl: config.fallbackPublicBaseUrl || '',
        },
      };
    this.mainRepositoryId = config.mainRepositoryId || 'gamelist';
    this.mainRepository =
      config.mainRepository || this.repositories[this.mainRepositoryId];
    if (!this.mainRepository) {
      throw new Error(`主仓库不存在: ${this.mainRepositoryId}`);
    }

    // 旧代码兼容属性，始终指向主仓库。
    this.contentRoot = this.mainRepository.contentRootPath;
    this.catalogRoot = path.join(this.contentRoot, 'catalog');
    this.coversRoot = path.join(this.contentRoot, 'covers');
    this.romsRoot = path.join(this.contentRoot, 'roms');
  }

  repositoryForType(type) {
    const repositoryId = this.config.gameTypes[type]?.repository || this.mainRepositoryId;
    const repository = this.repositories[repositoryId];
    if (!repository) {
      throw new Error(`${type} 配置的仓库不存在: ${repositoryId}`);
    }
    return repository;
  }

  repositoryCatalogRoot(repository) {
    return path.join(repository.contentRootPath, 'catalog');
  }

  repositoryCoversRoot(repository) {
    return path.join(repository.contentRootPath, 'covers');
  }

  repositoryRomsRoot(repository) {
    return path.join(repository.contentRootPath, 'roms');
  }

  ensureStructure() {
    const repositories = new Set([
      this.mainRepository,
      ...Object.keys(this.config.gameTypes).map((type) => this.repositoryForType(type)),
    ]);
    for (const repository of repositories) {
      fs.mkdirSync(this.repositoryCatalogRoot(repository), { recursive: true });
    }

    for (const type of Object.keys(this.config.gameTypes)) {
      const repository = this.repositoryForType(type);
      fs.mkdirSync(path.join(this.repositoryCoversRoot(repository), type.toLowerCase()), {
        recursive: true,
      });
      fs.mkdirSync(path.join(this.repositoryRomsRoot(repository), type.toLowerCase()), {
        recursive: true,
      });
      const catalogPath = this.catalogPath(type);
      if (!fs.existsSync(catalogPath)) {
        this.writeCatalog(type, this.emptyCatalog(type));
      }
    }

    this.writeIndex();
  }

  emptyCatalog(type) {
    return {
      schema_version: SCHEMA_VERSION,
      game_type: type,
      updated_at: null,
      games: [],
    };
  }

  indexPath() {
    return path.join(this.repositoryCatalogRoot(this.mainRepository), 'index.json');
  }

  writeIndex() {
    const catalogs = Object.keys(this.config.gameTypes).map((type) => ({
      type,
      repository: this.repositoryForType(type),
      catalog: this.readCatalog(type),
    }));
    const versions = catalogs
      .map(({ catalog }) => catalog.updated_at)
      .filter((value) => typeof value === 'string' && value)
      .sort();
    const repositories = Object.fromEntries(
      Object.values(this.repositories).map((repository) => [
        repository.id,
        {
          url: repository.githubUrl,
          branch: repository.branch,
          public_base_url: repository.publicBaseUrl,
          fallback_public_base_url: repository.fallbackPublicBaseUrl || null,
        },
      ]),
    );
    const catalogEntries = Object.fromEntries(
      catalogs.map(({ type, repository, catalog }) => [
        type,
        {
          repository: repository.id,
          repository_url: repository.githubUrl,
          url: this.publicCatalogUrl(type),
          fallback_url: this.fallbackCatalogUrl(type),
          updated_at: catalog.updated_at || null,
        },
      ]),
    );
    this.writeJsonAtomic(this.indexPath(), {
      schema_version: INDEX_SCHEMA_VERSION,
      updated_at: versions.length > 0 ? versions[versions.length - 1] : null,
      repositories,
      catalogs: catalogEntries,
    });
  }

  nextTimestamp(previous) {
    const now = Date.now();
    const previousTime = Date.parse(previous || '');
    return new Date(
      Number.isFinite(previousTime) ? Math.max(now, previousTime + 1) : now,
    ).toISOString();
  }

  catalogPath(type) {
    return path.join(
      this.repositoryCatalogRoot(this.repositoryForType(type)),
      this.config.gameTypes[type].catalog,
    );
  }

  readCatalog(type) {
    const catalogPath = this.catalogPath(type);
    let value;
    try {
      value = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    } catch (error) {
      throw new Error(`无法读取 ${type} 游戏列表: ${error.message}`);
    }
    if (!value || value.game_type !== type || !Array.isArray(value.games)) {
      throw new Error(`${type} 游戏列表格式不正确`);
    }
    return value;
  }

  writeCatalog(type, value) {
    this.writeJsonAtomic(this.catalogPath(type), {
      schema_version: SCHEMA_VERSION,
      game_type: type,
      updated_at: value.updated_at || null,
      games: value.games,
    });
  }

  allCatalogs() {
    return Object.keys(this.config.gameTypes).map((type) => ({
      type,
      repository: this.repositoryForType(type),
      catalog: this.readCatalog(type),
    }));
  }

  allGames() {
    return this.allCatalogs().flatMap(({ type, catalog }) =>
      catalog.games.map((game) => ({ ...game, game_type: type })),
    );
  }

  findGame(id) {
    for (const type of Object.keys(this.config.gameTypes)) {
      const catalog = this.readCatalog(type);
      const index = catalog.games.findIndex((game) => game.id === id);
      if (index !== -1) {
        return {
          type,
          repository: this.repositoryForType(type),
          catalog,
          game: catalog.games[index],
          index,
        };
      }
    }
    return null;
  }

  findDuplicateHash(sha256, ignoredId = null) {
    return this.allGames().find(
      (game) => game.sha256 === sha256 && game.id !== ignoredId,
    );
  }

  gameDirectory(type, kind, id) {
    const repository = this.repositoryForType(type);
    const root =
      kind === 'cover'
        ? this.repositoryCoversRoot(repository)
        : this.repositoryRomsRoot(repository);
    return path.join(root, type.toLowerCase(), id);
  }

  coverFile(type, id, extension) {
    return path.join(this.gameDirectory(type, 'cover', id), `cover${extension}`);
  }

  romFile(type, id, extension, preferredName = null) {
    return path.join(
      this.gameDirectory(type, 'rom', id),
      preferredName || `game${extension}`,
    );
  }

  gamePathFromCatalogPath(type, value) {
    if (!value) return null;
    const repository = this.repositoryForType(type);
    const resolved = path.resolve(this.repositoryCatalogRoot(repository), value);
    if (!resolved.startsWith(`${repository.contentRootPath}${path.sep}`)) {
      throw new Error('游戏资源路径超出对应仓库的公开目录');
    }
    return resolved;
  }

  catalogRelativeCoverPath(type, id, extension) {
    if (!extension) return null;
    return path.posix.join(
      '..',
      'covers',
      type.toLowerCase(),
      id,
      `cover${extension}`,
    );
  }

  catalogRelativeRomPath(type, id, extension, preferredName = null) {
    return path.posix.join(
      '..',
      'roms',
      type.toLowerCase(),
      id,
      preferredName || `game${extension}`,
    );
  }

  publicCatalogUrl(type) {
    const repository = this.repositoryForType(type);
    return `${repository.publicBaseUrl}/catalog/${this.config.gameTypes[type].catalog}`;
  }

  fallbackCatalogUrl(type) {
    const repository = this.repositoryForType(type);
    if (!repository.fallbackPublicBaseUrl) return null;
    return `${repository.fallbackPublicBaseUrl}/catalog/${this.config.gameTypes[type].catalog}`;
  }

  localAssetUrl(type, relativePath) {
    if (!relativePath) return null;
    const repository = this.repositoryForType(type);
    const normalized = path.posix
      .normalize(`/${relativePath}`)
      .replace(/^\/+/, '');
    return `/media/${repository.id}/${normalized}`;
  }

  publicAssetUrl(type, relativePath) {
    if (!relativePath) return null;
    const repository = this.repositoryForType(type);
    const normalized = path.posix
      .normalize(`/${relativePath}`)
      .replace(/^\/+/, '');
    return `${repository.publicBaseUrl}/${normalized}`;
  }

  publicGameUrls(type, game) {
    return {
      catalog: this.publicCatalogUrl(type),
      cover: this.publicAssetUrl(type, game.cover_path),
      rom: this.publicAssetUrl(type, game.rom_path),
    };
  }

  writeJsonAtomic(targetPath, value) {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const temporaryPath = `${targetPath}.${process.pid}.${crypto
      .randomBytes(4)
      .toString('hex')}.tmp`;
    fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(temporaryPath, targetPath);
  }
}

module.exports = { CatalogStore, SCHEMA_VERSION, INDEX_SCHEMA_VERSION };
