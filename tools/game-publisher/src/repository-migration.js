'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { commitAndPush, prepareRepository, pushCurrent, runGit } = require('./git');

const execFileAsync = promisify(execFile);

function httpError(statusCode, code, message) {
  return Object.assign(new Error(message), { statusCode, code });
}

function nowIso() {
  return new Date().toISOString();
}

function nextTimestamp(previous) {
  const now = Date.now();
  const previousTime = Date.parse(previous || '');
  return new Date(
    Number.isFinite(previousTime) ? Math.max(now, previousTime + 1) : now,
  ).toISOString();
}

function parseGitHubUrl(value) {
  let parsed;
  try {
    parsed = new URL(String(value || '').trim());
  } catch {
    throw httpError(
      400,
      'INVALID_REPOSITORY_URL',
      '请输入完整的 GitHub 仓库地址',
    );
  }
  const parts = parsed.pathname.replace(/\/+$/, '').replace(/\.git$/, '').split('/').filter(Boolean);
  if (parsed.hostname !== 'github.com' || parts.length !== 2) {
    throw httpError(
      400,
      'INVALID_REPOSITORY_URL',
      '仓库地址必须是 https://github.com/<owner>/<repo>',
    );
  }
  const [owner, repo] = parts;
  return {
    owner,
    repo,
    githubUrl: `https://github.com/${owner}/${repo}`,
    cloneUrl: `git@github.com:${owner}/${repo}.git`,
  };
}

function repositoryIdFor(repo) {
  return repo
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'game-repository';
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  const buffer = fs.readFileSync(filePath);
  hash.update(buffer);
  return { sha256: hash.digest('hex'), size: buffer.length };
}

function walkFiles(root, prefix = '') {
  if (!fs.existsSync(root)) return [];
  const result = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const relative = path.posix.join(prefix, entry.name);
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) result.push(...walkFiles(absolute, relative));
    else if (entry.isFile()) result.push({ absolute, relative });
  }
  return result;
}

function safeRm(targetPath) {
  fs.rmSync(targetPath, { recursive: true, force: true });
}

function pathHasData(targetPath) {
  if (!fs.existsSync(targetPath)) return false;
  return !fs.statSync(targetPath).isDirectory() || fs.readdirSync(targetPath).length > 0;
}

function copyFileWithProgress(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function writeJsonAtomic(targetPath, value) {
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  const temp = `${targetPath}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`);
  fs.renameSync(temp, targetPath);
}

class RepositoryMigrationManager {
  constructor(runtime) {
    this.runtime = runtime;
    this.jobs = new Map();
    this.storageRoot = path.join(
      runtime.config.mainRepository.root,
      '.publisher',
      'migrations',
    );
    fs.mkdirSync(this.storageRoot, { recursive: true });
    this.loadJobs();
  }

  loadJobs() {
    if (!fs.existsSync(this.storageRoot)) return;
    for (const name of fs.readdirSync(this.storageRoot)) {
      if (!name.endsWith('.json')) continue;
      try {
        const job = JSON.parse(
          fs.readFileSync(path.join(this.storageRoot, name), 'utf8'),
        );
        this.jobs.set(job.id, job);
      } catch {
        // Ignore damaged historical job files.
      }
    }
  }

  persist(job) {
    job.updated_at = nowIso();
    writeJsonAtomic(path.join(this.storageRoot, `${job.id}.json`), job);
  }

  hasPendingJob() {
    return [...this.jobs.values()].some((job) =>
      ['running', 'needs_attention'].includes(job.status),
    );
  }

  overview() {
    const { config, store } = this.runtime;
    return {
      repositories: Object.values(config.repositories).map((repository) => ({
        id: repository.id,
        url: repository.githubUrl,
        branch: repository.branch,
        public_base_url: repository.publicBaseUrl,
        fallback_public_base_url: repository.fallbackPublicBaseUrl || null,
        types: Object.entries(config.gameTypes)
          .filter(([, value]) => value.repository === repository.id)
          .map(([type]) => type),
      })),
      game_types: Object.entries(config.gameTypes).map(([type, value]) => {
        const repository = config.repositories[value.repository];
        const catalog = store.readCatalog(type);
        return {
          type,
          repository: value.repository,
          repository_url: repository.githubUrl,
          games: catalog.games.length,
          updated_at: catalog.updated_at || null,
        };
      }),
      pending_job: [...this.jobs.values()]
        .filter((job) => ['running', 'needs_attention'].includes(job.status))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0] || null,
    };
  }

  async preflight(input) {
    const type = String(input.type || '').trim().toUpperCase();
    const gameType = this.runtime.config.gameTypes[type];
    if (!gameType) {
      throw httpError(400, 'INVALID_GAME_TYPE', `不支持的分类: ${type}`);
    }
    const parsed = parseGitHubUrl(input.repository_url);
    const branch = String(input.branch || 'main').trim() || 'main';
    const sourceRepository = this.runtime.store.repositoryForType(type);
    if (sourceRepository.githubUrl === parsed.githubUrl) {
      throw httpError(
        400,
        'SAME_REPOSITORY',
        '目标仓库不能和当前仓库相同',
      );
    }

    const targetId = this.targetRepositoryId(parsed, sourceRepository);
    const targetRoot = this.targetRoot(parsed.repo, targetId);
    await this.ensureTargetRepository(parsed, branch, targetRoot);
    const targetContentRoot = path.join(targetRoot, 'public');
    const targetPaths = this.typePaths(type, gameType.catalog, targetContentRoot);
    const existing = [targetPaths.catalog, targetPaths.covers, targetPaths.roms]
      .filter((target) => pathHasData(target));
    if (existing.length > 0) {
      throw httpError(
        409,
        'TARGET_NOT_EMPTY',
        `目标仓库已存在 ${type} 数据，本流程不支持合并。请换一个空仓库。`,
      );
    }

    const sourceFiles = this.sourceManifest(type, gameType.catalog);
    const targetRepo = this.targetRepositoryConfig(
      targetId,
      parsed,
      branch,
      targetRoot,
    );
    return {
      type,
      branch,
      source_repository: this.repositorySummary(sourceRepository),
      target_repository: this.repositorySummary(targetRepo),
      target_local_root: targetRoot,
      catalog_file: gameType.catalog,
      summary: {
        games: sourceFiles.games,
        roms: sourceFiles.roms,
        covers: sourceFiles.covers,
        files: sourceFiles.files.length + 1,
        bytes: sourceFiles.files.reduce((sum, file) => sum + file.size, 0),
      },
      checks: [
        { key: 'repository', label: 'GitHub 仓库可以访问', ok: true },
        { key: 'branch', label: `目标分支 ${branch} 可用`, ok: true },
        { key: 'local', label: '本地目标目录可用', ok: true },
        { key: 'empty', label: '目标仓库没有该分类数据', ok: true },
        { key: 'catalog', label: '当前分类文件完整', ok: true },
        { key: 'roms', label: 'ROM 文件都存在', ok: true },
        { key: 'covers', label: '海报文件检查完成', ok: true },
      ],
      source_files: sourceFiles.files,
      target_paths: targetPaths,
    };
  }

  async start(input) {
    if (this.hasPendingJob()) {
      throw httpError(
        409,
        'MIGRATION_IN_PROGRESS',
        '已有迁移任务正在执行或等待处理，请先完成当前任务',
      );
    }
    const preview = await this.preflight(input);
    const job = {
      id: `migration-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`,
      status: 'running',
      stage: 'queued',
      stage_label: '准备迁移',
      progress: 1,
      message: '迁移任务已创建',
      error: null,
      safe_state: '旧仓库和线上索引尚未修改',
      input: {
        type: preview.type,
        repository_url: preview.target_repository.url,
        branch: preview.branch,
      },
      preview,
      completed: {},
      created_at: nowIso(),
      updated_at: nowIso(),
      log: [
        {
          at: nowIso(),
          level: 'info',
          message: `${preview.type} 迁移任务已创建`,
        },
      ],
    };
    this.persist(job);
    this.jobs.set(job.id, job);
    setImmediate(() => this.runJob(job).catch(() => undefined));
    return job;
  }

  retry(id) {
    const job = this.jobs.get(id);
    if (!job) throw httpError(404, 'MIGRATION_NOT_FOUND', '迁移任务不存在');
    if (job.status !== 'needs_attention') {
      throw httpError(409, 'MIGRATION_NOT_RETRYABLE', '当前任务不能重试');
    }
    job.status = 'running';
    job.error = null;
    job.safe_state = '正在从失败步骤继续';
    job.message = '正在重试';
    this.addLog(job, 'info', '用户请求从失败步骤继续');
    this.persist(job);
    setImmediate(() => this.runJob(job).catch(() => undefined));
    return job;
  }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) throw httpError(404, 'MIGRATION_NOT_FOUND', '迁移任务不存在');
    if (job.status === 'running') {
      throw httpError(409, 'MIGRATION_RUNNING', '迁移正在执行，暂时不能取消');
    }
    if (job.completed.target_pushed) {
      throw httpError(
        409,
        'TARGET_ALREADY_PUSHED',
        '新仓库已经 push 成功，请继续完成剩余步骤，不能放弃当前任务',
      );
    }
    if (job.target?.paths && job.completed.copy_started) {
      for (const target of Object.values(job.target.paths)) safeRm(target);
    }
    job.status = 'cancelled';
    job.stage = 'cancelled';
    job.stage_label = '已取消';
    job.message = '迁移已取消，可以重新填写仓库地址';
    job.safe_state = '旧仓库和线上索引没有修改';
    this.addLog(job, 'info', '用户取消了迁移任务');
    this.persist(job);
    return job;
  }

  getJob(id) {
    const job = this.jobs.get(id);
    if (!job) throw httpError(404, 'MIGRATION_NOT_FOUND', '迁移任务不存在');
    return job;
  }

  latestJob() {
    return [...this.jobs.values()].sort((a, b) =>
      b.updated_at.localeCompare(a.updated_at),
    )[0] || null;
  }

  async runJob(job) {
    try {
      if (!job.completed.target_prepared) {
        await this.stage(job, 'prepare_target', '准备目标仓库', 5, async () => {
          const parsed = parseGitHubUrl(job.input.repository_url);
          const targetId = job.preview.target_repository.id;
          const root = job.preview.target_local_root;
          await this.ensureTargetRepository(
            parsed,
            job.input.branch,
            root,
            Boolean(job.completed.copy_started),
          );
          const paths = this.typePaths(
            job.input.type,
            job.preview.catalog_file,
            path.join(root, 'public'),
          );
          if (!job.completed.copy_started) {
            for (const target of [paths.catalog, paths.covers, paths.roms]) {
              if (pathHasData(target)) {
                throw httpError(
                  409,
                  'TARGET_NOT_EMPTY',
                  `目标仓库出现了新的 ${job.input.type} 数据，迁移已停止`,
                );
              }
            }
          }
          job.target = {
            id: targetId,
            root,
            branch: job.input.branch,
            parsed,
            paths,
          };
        });
        job.completed.prepare_target = true;
        job.completed.target_prepared = true;
        this.persist(job);
      }

      if (!job.completed.target_pushed) {
        await this.stage(job, 'copy_files', '复制分类、海报和 ROM', 18, async () => {
          const target = job.target;
          job.completed.copy_started = true;
          this.persist(job);
          safeRm(target.paths.catalog);
          safeRm(target.paths.covers);
          safeRm(target.paths.roms);
          fs.mkdirSync(path.dirname(target.paths.catalog), { recursive: true });

          const sourceCatalog = JSON.parse(
            fs.readFileSync(this.sourceCatalogPath(job.input.type), 'utf8'),
          );
          sourceCatalog.updated_at = nextTimestamp(sourceCatalog.updated_at);
          writeJsonAtomic(target.paths.catalog, sourceCatalog);

          const sourcePaths = this.typePaths(
            job.input.type,
            job.preview.catalog_file,
            this.runtime.store.repositoryForType(job.input.type).contentRootPath,
          );
          const allFiles = [
            ...walkFiles(sourcePaths.covers),
            ...walkFiles(sourcePaths.roms),
          ];
          let copied = 0;
          for (const file of allFiles) {
            const baseRoot = file.absolute.startsWith(sourcePaths.covers)
              ? sourcePaths.covers
              : sourcePaths.roms;
            const targetRoot = baseRoot === sourcePaths.covers
              ? target.paths.covers
              : target.paths.roms;
            const relative = path.relative(baseRoot, file.absolute);
            copyFileWithProgress(file.absolute, path.join(targetRoot, relative));
            copied += 1;
            job.progress = 18 + Math.round((copied / Math.max(1, allFiles.length)) * 27);
            job.message = `正在复制文件 ${copied}/${allFiles.length}`;
            job.current_file = relative;
            this.persist(job);
          }
          job.new_catalog_updated_at = sourceCatalog.updated_at;
          job.copied_file_count = allFiles.length + 1;
        });

        await this.stage(job, 'verify_target', '校验目标文件', 48, async () => {
          this.verifyCopiedFiles(job);
          job.completed.copy_files = true;
          job.completed.verify_target = true;
          this.persist(job);
        });

        await this.stage(job, 'push_target', '提交并推送目标仓库', 58, async () => {
          const target = job.target;
          const targetRepo = this.targetRepositoryConfig(
            target.id,
            target.parsed,
            target.branch,
            target.root,
          );
          job.target.repository = this.repositorySummary(targetRepo);
          await this.prepareTargetGit(target.root, target.branch, false);
          const targetPaths = [
            this.relativeTo(target.root, target.paths.catalog),
            this.relativeTo(target.root, target.paths.covers),
            this.relativeTo(target.root, target.paths.roms),
          ].filter((value) => value && value !== '.');
          const result = await this.commitOrPush(
            targetRepo,
            targetPaths,
            `migrate: import ${job.input.type} catalog and assets`,
          );
          job.completed.push_target = true;
          job.completed.target_pushed = true;
          job.target.commit = result.commit;
          job.safe_state = '新仓库已推送，线上仍然使用旧仓库';
          this.addLog(job, 'success', `目标仓库已推送: ${result.commit}`);
          this.persist(job);
        });
        this.persist(job);
      }

      if (!job.completed.index_switched) {
        await this.stage(job, 'switch_index', '更新总库索引和仓库配置', 72, async () => {
          await this.switchIndexAndConfig(job);
          job.completed.switch_index = true;
          job.completed.index_switched = true;
          job.safe_state = '新仓库和总索引已切换，旧数据尚未删除';
          this.persist(job);
        });
        this.persist(job);
      }

      if (!job.completed.old_cleaned) {
        await this.stage(job, 'cleanup_old', '清理旧仓库分类数据', 90, async () => {
          await this.cleanupOldRepository(job);
          job.completed.cleanup_old = true;
          job.completed.old_cleaned = true;
          job.safe_state = '迁移完成';
          this.persist(job);
        });
      }

      job.status = 'completed';
      job.stage = 'completed';
      job.stage_label = '迁移完成';
      job.progress = 100;
      job.message = `${job.input.type} 已迁移到新仓库`;
      job.error = null;
      job.safe_state = '线上已使用新仓库';
      this.addLog(job, 'success', '迁移全部完成');
      this.persist(job);
      this.runtime.reload();
    } catch (error) {
      job.status = 'needs_attention';
      job.stage_label = '迁移暂停';
      job.message = '迁移遇到问题，请处理后重试';
      job.error = {
        code: error.code || 'MIGRATION_FAILED',
        message: error.message,
        repository: error.repository || job.target?.id || null,
      };
      this.addLog(job, 'error', error.message);
      this.persist(job);
      throw error;
    }
  }

  async stage(job, stage, label, progress, task) {
    job.status = 'running';
    job.stage = stage;
    job.stage_label = label;
    job.progress = progress;
    job.message = label;
    job.error = null;
    this.addLog(job, 'info', label);
    this.persist(job);
    await task();
  }

  sourceCatalogPath(type) {
    return this.runtime.store.catalogPath(type);
  }

  sourceManifest(type, catalogFile) {
    const store = this.runtime.store;
    const repository = store.repositoryForType(type);
    const catalogPath = store.catalogPath(type);
    const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
    const typePaths = this.typePaths(type, catalogFile, repository.contentRootPath);
    const files = [{ absolute: catalogPath, relative: catalogFile, ...hashFile(catalogPath) }];
    for (const root of [typePaths.covers, typePaths.roms]) {
      for (const file of walkFiles(root)) {
        files.push({
          absolute: file.absolute,
          relative: path.relative(repository.contentRootPath, file.absolute),
          ...hashFile(file.absolute),
        });
      }
    }
    const covers = walkFiles(typePaths.covers).length;
    const roms = walkFiles(typePaths.roms).length;
    return { games: catalog.games.length, covers, roms, files };
  }

  typePaths(type, catalogFile, contentRoot) {
    return {
      catalog: path.join(contentRoot, 'catalog', catalogFile),
      covers: path.join(contentRoot, 'covers', type.toLowerCase()),
      roms: path.join(contentRoot, 'roms', type.toLowerCase()),
    };
  }

  async ensureTargetRepository(parsed, branch, targetRoot, allowDirty = false) {
    try {
      await execFileAsync('git', ['ls-remote', '--heads', parsed.cloneUrl, branch]);
    } catch (error) {
      throw httpError(
        400,
        'TARGET_REPOSITORY_UNREACHABLE',
        `无法访问目标仓库。请确认仓库已经创建、地址正确，并且当前电脑有 SSH 权限。${error.stderr ? `\n${String(error.stderr).trim()}` : ''}`,
      );
    }
    if (!fs.existsSync(targetRoot)) {
      fs.mkdirSync(path.dirname(targetRoot), { recursive: true });
      try {
        await execFileAsync('git', ['clone', parsed.cloneUrl, targetRoot]);
      } catch (error) {
        throw httpError(
          400,
          'TARGET_CLONE_FAILED',
          `无法 clone 目标仓库。${error.stderr ? `\n${String(error.stderr).trim()}` : ''}`,
        );
      }
    } else {
      await this.ensureGitRepository(targetRoot);
      const remote = await execFileAsync('git', ['remote', 'get-url', 'origin'], {
        cwd: targetRoot,
      });
      if (!this.remoteMatches(remote.stdout.trim(), parsed)) {
        throw httpError(
          409,
          'TARGET_REMOTE_MISMATCH',
          `本地目录 origin 不是目标仓库: ${remote.stdout.trim()}`,
        );
      }
    }
    await this.prepareTargetGit(targetRoot, branch, !allowDirty);
  }

  async ensureGitRepository(root) {
    try {
      await execFileAsync('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root });
    } catch {
      throw httpError(409, 'TARGET_NOT_GIT_REPOSITORY', '目标目录不是 Git 仓库');
    }
  }

  async prepareTargetGit(root, branch, requireClean = true) {
    await this.ensureGitRepository(root);
    if (requireClean) {
      const status = await execFileAsync('git', ['status', '--porcelain'], { cwd: root });
      if (status.stdout.trim()) {
        throw httpError(409, 'TARGET_DIRTY', '目标仓库存在未提交改动，请先处理');
      }
    }
    await execFileAsync('git', ['fetch', 'origin'], { cwd: root }).catch(() => undefined);
    try {
      await execFileAsync('git', ['checkout', branch], { cwd: root });
    } catch {
      await execFileAsync('git', ['checkout', '-B', branch], { cwd: root });
    }
  }

  verifyCopiedFiles(job) {
    const target = job.target;
    if (!fs.existsSync(target.paths.catalog)) {
      throw httpError(409, 'TARGET_CATALOG_MISSING', '目标分类文件复制失败');
    }
    const targetCatalog = JSON.parse(fs.readFileSync(target.paths.catalog, 'utf8'));
    const sourceCatalog = JSON.parse(fs.readFileSync(this.sourceCatalogPath(job.input.type), 'utf8'));
    if (targetCatalog.games.length !== sourceCatalog.games.length) {
      throw httpError(409, 'TARGET_GAME_COUNT_MISMATCH', '游戏数量校验失败');
    }
    for (const file of job.preview.source_files) {
      if (file.relative === job.preview.catalog_file) continue;
      const targetFile = path.join(target.root, 'public', file.relative);
      if (!fs.existsSync(targetFile)) {
        throw httpError(409, 'TARGET_FILE_MISSING', `目标文件缺失: ${file.relative}`);
      }
      const digest = hashFile(targetFile);
      if (digest.size !== file.size || digest.sha256 !== file.sha256) {
        throw httpError(409, 'TARGET_FILE_MISMATCH', `文件校验失败: ${file.relative}`);
      }
    }
  }

  async switchIndexAndConfig(job) {
    const { config } = this.runtime;
    const mainRepository = config.mainRepository;
    const configPath = config.configPath;
    const indexPath = this.runtime.store.indexPath();
    const configRelative = this.relativeTo(mainRepository.root, configPath);
    const indexRelative = this.relativeTo(mainRepository.root, indexPath);
    const alreadyConfigured =
      config.gameTypes[job.input.type]?.repository === job.target.id;
    if (!alreadyConfigured) {
      await prepareRepository(mainRepository, [configRelative, indexRelative]);
    }

    const rawConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const target = job.target;
    rawConfig.repositories[target.id] = {
      root: path.relative(path.dirname(configPath), target.root).replace(/\\/g, '/'),
      remote: 'origin',
      branch: target.branch,
      contentRoot: 'public',
      githubUrl: target.parsed.githubUrl,
      publicBaseUrl: `https://raw.githubusercontent.com/${target.parsed.owner}/${target.parsed.repo}/${target.branch}/public`,
      fallbackPublicBaseUrl: `https://gh-proxy.com/https://raw.githubusercontent.com/${target.parsed.owner}/${target.parsed.repo}/${target.branch}/public`,
    };
    rawConfig.gameTypes[job.input.type].repository = target.id;
    writeJsonAtomic(configPath, rawConfig);
    this.runtime.reload();
    this.runtime.store.writeIndex();

    const result = await this.commitOrPush(
      mainRepository,
      [configRelative, this.relativeTo(mainRepository.root, this.runtime.store.indexPath())],
      `migrate: switch ${job.input.type} to ${target.id}`,
    );
    job.index_commit = result.commit;
    this.addLog(job, 'success', `总库索引已推送: ${result.commit}`);
  }

  async cleanupOldRepository(job) {
    const oldRepository = job.preview.source_repository;
    const oldRepoConfig = this.runtime.config.repositories[oldRepository.id];
    if (!oldRepoConfig) {
      this.addLog(job, 'info', '旧仓库不在配置中，跳过清理');
      return;
    }
    const paths = this.typePaths(
      job.input.type,
      job.preview.catalog_file,
      oldRepoConfig.contentRootPath,
    );
    const existing = [paths.catalog, paths.covers, paths.roms].filter((target) =>
      fs.existsSync(target),
    );
    if (existing.length === 0) {
      this.addLog(job, 'info', '旧仓库中没有需要清理的分类数据');
      return;
    }
    const relativePaths = existing
      .map((target) => this.relativeTo(oldRepoConfig.root, target))
      .filter(Boolean);
    await prepareRepository(oldRepoConfig, relativePaths);
    for (const target of existing) safeRm(target);
    const result = await this.commitOrPush(
      oldRepoConfig,
      relativePaths,
      `migrate: remove old ${job.input.type} data after repository split`,
    );
    job.cleanup_commit = result.commit;
    this.addLog(job, 'success', `旧仓库清理已推送: ${result.commit}`);
  }

  targetRepositoryId(parsed, sourceRepository) {
    const existing = Object.values(this.runtime.config.repositories).find(
      (repository) =>
        repository.githubUrl.toLowerCase() === parsed.githubUrl.toLowerCase(),
    );
    if (existing) return existing.id;
    const base = repositoryIdFor(parsed.repo);
    if (!this.runtime.config.repositories[base]) return base;
    if (this.runtime.config.repositories[base].githubUrl === parsed.githubUrl) return base;
    let index = 2;
    while (this.runtime.config.repositories[`${base}-${index}`]) index += 1;
    return `${base}-${index}`;
  }

  targetRoot(repoName, targetId) {
    const existing = this.runtime.config.repositories[targetId];
    if (existing) return existing.root;
    return path.resolve(path.dirname(this.runtime.config.mainRepository.root), repoName);
  }

  remoteMatches(remote, parsed) {
    const normalized = String(remote || '')
      .trim()
      .replace(/^git@github\.com:/, 'https://github.com/')
      .replace(/^ssh:\/\/git@github\.com\//, 'https://github.com/')
      .replace(/\.git$/, '')
      .replace(/\/+$/, '');
    return normalized.toLowerCase() === parsed.githubUrl.toLowerCase();
  }

  async commitOrPush(repository, paths, message) {
    try {
      return await commitAndPush(repository, paths, message);
    } catch (error) {
      if (!String(error.message || '').includes('文件没有发生变化')) throw error;
      await pushCurrent(repository);
      const commit = await runGit(repository, ['rev-parse', '--short', 'HEAD']);
      return { commit, pushed: true, existingCommit: true };
    }
  }

  targetRepositoryConfig(id, parsed, branch, root) {
    return {
      id,
      root,
      remote: 'origin',
      branch,
      contentRoot: 'public',
      contentRootPath: path.join(root, 'public'),
      githubUrl: parsed.githubUrl,
      publicBaseUrl: `https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/public`,
      fallbackPublicBaseUrl: `https://gh-proxy.com/https://raw.githubusercontent.com/${parsed.owner}/${parsed.repo}/${branch}/public`,
    };
  }

  repositorySummary(repository) {
    return {
      id: repository.id,
      url: repository.githubUrl,
      branch: repository.branch,
      public_base_url: repository.publicBaseUrl,
    };
  }

  relativeTo(root, absolutePath) {
    return path.relative(root, absolutePath).replace(/\\/g, '/');
  }

  addLog(job, level, message) {
    job.log.push({ at: nowIso(), level, message });
    if (job.log.length > 200) job.log.splice(0, job.log.length - 200);
  }
}

module.exports = { RepositoryMigrationManager, parseGitHubUrl };
