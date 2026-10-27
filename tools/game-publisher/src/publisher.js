'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  cleanDisplayName,
  detectCoverExtension,
  downloadFileNameForUpload,
  makeGameId,
  normalizeType,
  sha256,
  validateGameId,
  validateRom,
} = require('./files');
const { commitAndPush, prepareRepository } = require('./git');

class GamePublisher {
  constructor(config, store) {
    this.config = config;
    this.store = store;
    this.operation = Promise.resolve();
  }

  async saveGame({ fields, files }) {
    return this.serialized(() => this.saveGameInternal({ fields, files }));
  }

  async deleteGame(id) {
    return this.serialized(() => this.deleteGameInternal(id));
  }

  serialized(task) {
    const current = this.operation.then(task, task);
    this.operation = current.catch(() => undefined);
    return current;
  }

  async saveGameInternal({ fields, files }) {
    const requestedId = String(fields.id || '').trim();
    const isUpdate = Boolean(requestedId);
    let type;
    let existing;

    if (isUpdate) {
      if (!validateGameId(requestedId)) {
        throw httpError(400, 'INVALID_GAME_ID', '游戏 ID 格式不正确');
      }
      existing = this.store.findGame(requestedId);
      if (!existing) {
        throw httpError(404, 'GAME_NOT_FOUND', '要更新的游戏不存在');
      }
      type = existing.type;
      const requestedType = String(fields.game_type || type)
        .trim()
        .toUpperCase();
      if (requestedType !== type) {
        throw httpError(
          400,
          'TYPE_CHANGE_NOT_ALLOWED',
          '已有游戏不能修改类型，请删除后重新上传',
        );
      }
    } else {
      type = normalizeType(fields.game_type, this.config.gameTypes);
    }

    const hasNewRom = Boolean(files.rom && files.rom.buffer);
    const uploadLocked = this.config.gameTypes[type].uploadEnabled === false;
    const lockedOriginalName =
      isUpdate && uploadLocked ? existing.game.name : null;
    if (uploadLocked && !isUpdate) {
      throw httpError(403, 'UPLOAD_LOCKED', `${type} 游戏库已锁定，不能新增`);
    }
    if (uploadLocked && hasNewRom) {
      throw httpError(
        403,
        'ROM_UPLOAD_LOCKED',
        `${type} 的 ROM 已锁定，只能更新封面`,
      );
    }

    const name = cleanDisplayName(fields.name);
    const requestedNameEn = String(fields.name_en || '').trim();
    const nameEn = requestedNameEn
      ? cleanDisplayName(requestedNameEn)
      : isUpdate
        ? String(existing.game.name_en || '').trim()
        : '';
    if (!nameEn) {
      throw httpError(400, 'MISSING_ENGLISH_NAME', '英文名称不能为空');
    }
    if (
      lockedOriginalName !== null &&
      (name !== lockedOriginalName ||
        nameEn !== String(existing.game.name_en || '').trim())
    ) {
      throw httpError(
        403,
        'CPS1_NAME_LOCKED',
        `${type} 游戏名称、英文名称和 ROM 已锁定，只能更新封面`,
      );
    }
    if (!isUpdate && !hasNewRom) {
      throw httpError(400, 'MISSING_ROM', '新游戏必须选择 ROM 或 ZIP 游戏包');
    }
    const rom = hasNewRom
      ? await validateRom(
          files.rom,
          type,
          this.config.gameTypes,
          this.config.romBytes,
          {
            maxEntries: this.config.zipMaxEntries,
            maxUncompressedBytes: this.config.zipMaxUncompressedBytes,
          },
        )
      : null;
    const coverExtension = detectCoverExtension(
      files.cover,
      this.config.coverBytes,
    );

    const typeRepository = this.store.repositoryForType(type);
    const mainRepository = this.store.mainRepository;
    const catalogPath = this.store.catalogPath(type);
    const indexPath = this.store.indexPath();
    const typeInitialPaths = [
      this.toRelative(typeRepository, catalogPath),
    ];
    if (isUpdate) {
      if (rom) {
        typeInitialPaths.push(
          this.toRelative(
            typeRepository,
            this.store.gameDirectory(type, 'rom', requestedId),
          ),
        );
      }
      if (coverExtension) {
        typeInitialPaths.push(
          this.toRelative(
            typeRepository,
            this.store.gameDirectory(type, 'cover', requestedId),
          ),
        );
      }
    }
    await this.prepareRepositories([
      { repository: typeRepository, paths: typeInitialPaths },
      {
        repository: mainRepository,
        paths: [this.toRelative(mainRepository, indexPath)],
      },
    ]);

    if (isUpdate) {
      existing = this.store.findGame(requestedId);
      if (!existing) {
        throw httpError(
          409,
          'GAME_NOT_FOUND_AFTER_SYNC',
          '同步远端后目标游戏已不存在，请刷新页面',
        );
      }
      type = existing.type;
    }

    const id = isUpdate ? requestedId : this.uniqueGameId(type);
    const downloadName = rom
      ? downloadFileNameForUpload(type, id, rom.extension, files.rom.filename)
      : null;
    const romDigest = rom ? sha256(rom.buffer) : null;
    if (rom) {
      const duplicate = this.store.findDuplicateHash(romDigest, id);
      if (duplicate) {
        throw httpError(
          409,
          'DUPLICATE_ROM',
          `相同 ROM 已存在于 ${duplicate.game_type} / ${duplicate.name}`,
        );
      }
    }

    const catalog = this.store.readCatalog(type);
    const now = this.store.nextTimestamp(catalog.updated_at);
    const romDirectory = this.store.gameDirectory(type, 'rom', id);
    const coverDirectory = this.store.gameDirectory(type, 'cover', id);
    const romPath = rom
      ? this.store.romFile(
          type,
          id,
          rom.extension,
          type === 'CPS1' ? downloadName : null,
        )
      : null;
    const coverPath = coverExtension
      ? this.store.coverFile(type, id, coverExtension)
      : null;

    let game;
    let currentIndex = -1;
    if (isUpdate) {
      currentIndex = catalog.games.findIndex((item) => item.id === id);
      if (currentIndex === -1) {
        throw httpError(404, 'GAME_NOT_FOUND', '要更新的游戏不存在');
      }
      const previous = catalog.games[currentIndex];
      game = {
        id,
        name,
        name_en: nameEn,
        cover_path: coverExtension
          ? this.store.catalogRelativeCoverPath(type, id, coverExtension)
          : previous.cover_path || null,
        rom_path: rom
          ? this.store.catalogRelativeRomPath(
              type,
              id,
              rom.extension,
              type === 'CPS1' ? downloadName : null,
            )
          : previous.rom_path,
        file_name: rom ? downloadName : previous.file_name,
        file_size: rom ? rom.buffer.length : previous.file_size,
        sha256: romDigest || previous.sha256,
        revision: Number(previous.revision || 0) + 1,
        updated_at: now,
      };
    } else {
      game = {
        id,
        name,
        name_en: nameEn,
        cover_path: coverExtension
          ? this.store.catalogRelativeCoverPath(type, id, coverExtension)
          : null,
        rom_path: this.store.catalogRelativeRomPath(
          type,
          id,
          rom.extension,
          type === 'CPS1' ? downloadName : null,
        ),
        file_name: downloadName,
        file_size: rom.buffer.length,
        sha256: romDigest,
        revision: 1,
        updated_at: now,
      };
    }

    const affectedAbsolutePaths = [catalogPath, indexPath];
    if (rom) affectedAbsolutePaths.push(romDirectory);
    if (coverExtension) affectedAbsolutePaths.push(coverDirectory);
    const transaction = this.createTransaction(affectedAbsolutePaths);
    let pushedAny = false;

    try {
      if (rom) {
        fs.mkdirSync(romDirectory, { recursive: true });
        fs.rmSync(romDirectory, { recursive: true, force: true });
        fs.mkdirSync(romDirectory, { recursive: true });
        fs.writeFileSync(romPath, rom.buffer);
      }

      if (coverExtension) {
        fs.rmSync(coverDirectory, { recursive: true, force: true });
        fs.mkdirSync(coverDirectory, { recursive: true });
        fs.writeFileSync(coverPath, files.cover.buffer);
      }

      if (isUpdate) {
        catalog.games[currentIndex] = game;
      } else {
        catalog.games.unshift(game);
      }
      catalog.updated_at = now;
      this.store.writeCatalog(type, catalog);
      this.store.writeIndex();

      const typeCommitPaths = [this.toRelative(typeRepository, catalogPath)];
      if (rom) typeCommitPaths.push(this.toRelative(typeRepository, romDirectory));
      if (coverExtension) {
        typeCommitPaths.push(this.toRelative(typeRepository, coverDirectory));
      }
      const indexCommitPaths = [this.toRelative(mainRepository, indexPath)];
      const action = isUpdate ? 'update' : 'add';
      const commits = {};
      let primaryCommit;

      if (typeRepository.id === mainRepository.id) {
        const result = await commitAndPush(
          typeRepository,
          [...typeCommitPaths, ...indexCommitPaths],
          `game: ${action} ${type} ${name}`,
        );
        primaryCommit = result.commit;
        commits[typeRepository.id] = result.commit;
        pushedAny = true;
      } else {
        const typeResult = await commitAndPush(
          typeRepository,
          typeCommitPaths,
          `game: ${action} ${type} ${name}`,
        );
        commits[typeRepository.id] = typeResult.commit;
        pushedAny = true;
        const indexResult = await commitAndPush(
          mainRepository,
          indexCommitPaths,
          `catalog: refresh index after ${action} ${type} ${name}`,
        );
        commits[mainRepository.id] = indexResult.commit;
        primaryCommit = indexResult.commit;
      }

      transaction.cleanup();
      return {
        ok: true,
        game: { ...game, game_type: type },
        package: rom
          ? rom.archive
            ? {
                format: 'zip',
                detected_type: rom.archive.detectedType,
                detection: rom.archive.detection,
                entry_count: rom.archive.entryCount,
                uncompressed_size: rom.archive.uncompressedSize,
              }
            : { format: rom.extension.replace(/^\./, '') }
          : {
              format: String(
                game.rom_path.split('.').pop() || 'preserved',
              ).toLowerCase(),
              preserved: true,
            },
        commit: primaryCommit,
        commits,
        repository: typeRepository.id,
        pushed: true,
        public: this.store.publicGameUrls(type, game),
      };
    } catch (error) {
      if (!pushedAny && !error.pushFailed) transaction.rollback();
      else transaction.cleanup();
      if (!error.repository) error.repository = typeRepository.id;
      throw error;
    }
  }

  async deleteGameInternal(id) {
    if (!validateGameId(id)) {
      throw httpError(400, 'INVALID_GAME_ID', '游戏 ID 格式不正确');
    }
    const initial = this.store.findGame(id);
    if (!initial) {
      throw httpError(404, 'GAME_NOT_FOUND', '游戏不存在');
    }

    const type = initial.type;
    const typeRepository = this.store.repositoryForType(type);
    const mainRepository = this.store.mainRepository;
    const catalogPath = this.store.catalogPath(type);
    const indexPath = this.store.indexPath();
    const romDirectory = this.store.gameDirectory(type, 'rom', id);
    const coverDirectory = this.store.gameDirectory(type, 'cover', id);
    await this.prepareRepositories([
      {
        repository: typeRepository,
        paths: [
          this.toRelative(typeRepository, catalogPath),
          this.toRelative(typeRepository, romDirectory),
          this.toRelative(typeRepository, coverDirectory),
        ],
      },
      {
        repository: mainRepository,
        paths: [this.toRelative(mainRepository, indexPath)],
      },
    ]);

    const current = this.store.findGame(id);
    if (!current) {
      throw httpError(409, 'GAME_NOT_FOUND_AFTER_SYNC', '同步远端后游戏已不存在');
    }

    const transaction = this.createTransaction([
      catalogPath,
      indexPath,
      romDirectory,
      coverDirectory,
    ]);
    let pushedAny = false;

    try {
      const catalog = current.catalog;
      catalog.games.splice(current.index, 1);
      catalog.updated_at = this.store.nextTimestamp(catalog.updated_at);
      this.store.writeCatalog(type, catalog);
      this.store.writeIndex();
      fs.rmSync(romDirectory, { recursive: true, force: true });
      fs.rmSync(coverDirectory, { recursive: true, force: true });

      const typeCommitPaths = [
        this.toRelative(typeRepository, catalogPath),
        this.toRelative(typeRepository, romDirectory),
        this.toRelative(typeRepository, coverDirectory),
      ];
      const indexCommitPaths = [this.toRelative(mainRepository, indexPath)];
      const commits = {};
      let primaryCommit;

      if (typeRepository.id === mainRepository.id) {
        const result = await commitAndPush(
          typeRepository,
          [...typeCommitPaths, ...indexCommitPaths],
          `game: delete ${type} ${current.game.name}`,
        );
        primaryCommit = result.commit;
        commits[typeRepository.id] = result.commit;
        pushedAny = true;
      } else {
        const typeResult = await commitAndPush(
          typeRepository,
          typeCommitPaths,
          `game: delete ${type} ${current.game.name}`,
        );
        commits[typeRepository.id] = typeResult.commit;
        pushedAny = true;
        const indexResult = await commitAndPush(
          mainRepository,
          indexCommitPaths,
          `catalog: refresh index after delete ${type} ${current.game.name}`,
        );
        commits[mainRepository.id] = indexResult.commit;
        primaryCommit = indexResult.commit;
      }

      transaction.cleanup();
      return {
        ok: true,
        deleted: current.game,
        commit: primaryCommit,
        commits,
        repository: typeRepository.id,
        pushed: true,
      };
    } catch (error) {
      if (!pushedAny && !error.pushFailed) transaction.rollback();
      else transaction.cleanup();
      if (!error.repository) error.repository = typeRepository.id;
      throw error;
    }
  }

  uniqueGameId(type) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const id = makeGameId(type);
      if (!this.store.findGame(id)) return id;
    }
    throw new Error('无法生成唯一游戏 ID');
  }

  async prepareRepositories(requests) {
    const byRepository = new Map();
    for (const request of requests) {
      const current = byRepository.get(request.repository.id) || [];
      current.push(...request.paths);
      byRepository.set(request.repository.id, current);
    }
    for (const [repositoryId, paths] of byRepository) {
      const repository = this.store.repositories[repositoryId];
      await prepareRepository(repository, [...new Set(paths)]);
    }
  }

  toRelative(repository, absolutePath) {
    return path.relative(repository.root, absolutePath);
  }

  createTransaction(paths) {
    const backupRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'game-publisher-'));
    const records = [];

    try {
      paths.forEach((targetPath, index) => {
        const backupPath = path.join(backupRoot, String(index));
        const existed = fs.existsSync(targetPath);
        if (existed) {
          fs.cpSync(targetPath, backupPath, { recursive: true });
        }
        records.push({ targetPath, backupPath, existed });
      });
    } catch (error) {
      fs.rmSync(backupRoot, { recursive: true, force: true });
      throw new Error(`无法创建发布回滚快照: ${error.message}`);
    }

    return {
      rollback: () => {
        for (const record of [...records].reverse()) {
          fs.rmSync(record.targetPath, { recursive: true, force: true });
          if (record.existed) {
            fs.cpSync(record.backupPath, record.targetPath, { recursive: true });
          }
        }
        fs.rmSync(backupRoot, { recursive: true, force: true });
      },
      cleanup: () => {
        fs.rmSync(backupRoot, { recursive: true, force: true });
      },
    };
  }
}


function httpError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

module.exports = { GamePublisher };
