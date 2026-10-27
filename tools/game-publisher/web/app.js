'use strict';

const state = {
  config: null,
  games: [],
  catalogVersions: {},
  catalogRepositories: {},
  activeType: 'GBA',
  editingId: null,
  pendingDeleteGame: null,
  deleting: false,
  deleteTimer: null,
  autoFilledName: null,
};

const el = (id) => document.getElementById(id);
const gameForm = el('gameForm');
const existingGame = el('existingGame');
const gameName = el('gameName');
const gameNameEn = el('gameNameEn');
const gameType = el('gameType');
const romFile = el('romFile');
const coverFile = el('coverFile');
const submitButton = el('submitButton');
const syncButton = el('syncButton');
const notice = el('notice');
const progress = el('uploadProgress');
const progressBar = el('progressBar');
const gameList = el('gameList');
const typeTabs = el('typeTabs');
const catalogVersion = el('catalogVersion');
const catalogVersionText = el('catalogVersionText');
const catalogRepositoryLabel = el('catalogRepositoryLabel');
const catalogRepositoryLink = el('catalogRepositoryLink');
const newGameButton = el('newGameButton');
const deleteDialog = el('deleteDialog');
const deleteDialogText = el('deleteDialogText');
const deleteConfirmActions = el('deleteConfirmActions');
const deleteProgressWrap = el('deleteProgressWrap');
const deleteProgressBar = el('deleteProgressBar');
const deleteProgressText = el('deleteProgressText');
const deleteConfirmButton = el('deleteConfirmButton');
const deleteCancelButton = el('deleteCancelButton');
const deleteCloseButton = el('deleteCloseButton');
const deleteRetryButton = el('deleteRetryButton');

async function init() {
  bindEvents();
  const requestedType = new URLSearchParams(window.location.search).get('type');
  if (requestedType) state.activeType = requestedType.toUpperCase();
  try {
    const [configResult, gamesResult] = await Promise.all([
      api('/api/config'),
      api('/api/games'),
    ]);
    state.config = configResult;
    state.games = gamesResult.games || [];
    state.catalogVersions = gamesResult.catalog_versions || {};
    state.catalogRepositories = gamesResult.catalog_repositories || {};
    renderConfig();
    renderTypeTabs();
    renderExistingOptions();
    renderGames();
    showNotice('后台已就绪。分类使用独立仓库时，会分别提交分类仓库和总库索引。', 'success', 4200);
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

function bindEvents() {
  gameForm.addEventListener('submit', handleSubmit);
  existingGame.addEventListener('change', () => selectExistingGame(existingGame.value));
  newGameButton.addEventListener('click', clearEditMode);
  gameType.addEventListener('change', updateExtensionHint);
  romFile.addEventListener('change', handleRomSelected);
  coverFile.addEventListener('change', previewCover);
  syncButton.addEventListener('click', retryPush);
  deleteCancelButton.addEventListener('click', closeDeleteDialog);
  deleteCloseButton.addEventListener('click', closeDeleteDialog);
  deleteConfirmButton.addEventListener('click', confirmDelete);
  deleteRetryButton.addEventListener('click', retryDeletePush);
  deleteDialog.addEventListener('click', (event) => {
    if (event.target === deleteDialog && !state.deleting) closeDeleteDialog();
  });
}

function renderConfig() {
  const mainRepositoryId = state.config.main_repository;
  const repo = state.config.repositories[mainRepositoryId];
  renderUploadTypes();
  el('repoLink').textContent = repo.url || `${repo.remote}/${repo.branch}`;
  el('repoLink').href = repo.url || '#';
  el('branchLabel').textContent =
    `${mainRepositoryId} · ${repo.remote} / ${repo.branch} · ${repo.content_root}`;
  el('romHint').textContent = `最大 ${formatLimit(state.config.limits.rom_bytes)}`;
  el('coverHint').textContent = `JPG / PNG / WebP，最大 ${formatLimit(state.config.limits.cover_bytes)}`;
  updateExtensionHint();
}

function renderUploadTypes() {
  const current = gameType.value;
  gameType.replaceChildren();
  for (const [type, config] of Object.entries(state.config.game_types)) {
    const option = document.createElement('option');
    option.value = type;
    option.disabled = config.upload_enabled === false;
    option.textContent = config.upload_enabled === false
      ? `${type}（已锁定）`
      : type;
    gameType.append(option);
  }
  if (current && state.config.game_types[current]) gameType.value = current;
  if (gameType.selectedOptions[0]?.disabled) {
    const firstEnabled = [...gameType.options].find((option) => !option.disabled);
    if (firstEnabled) gameType.value = firstEnabled.value;
  }
}

function renderTypeTabs() {
  const types = Object.keys(state.config.game_types);
  if (!types.includes(state.activeType) && types.length) state.activeType = types[0];
  typeTabs.replaceChildren();
  for (const type of types) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `type-tab${type === state.activeType ? ' active' : ''}`;
    const count = state.games.filter((game) => game.game_type === type).length;
    button.textContent = `${type} (${count})`;
    button.addEventListener('click', () => {
      state.activeType = type;
      renderTypeTabs();
      renderGames();
    });
    typeTabs.append(button);
  }
}

function renderExistingOptions() {
  const selected = state.editingId || '';
  existingGame.replaceChildren();
  const empty = document.createElement('option');
  empty.value = '';
  empty.textContent = '新游戏';
  existingGame.append(empty);

  for (const game of state.games) {
    const option = document.createElement('option');
    const uploadEnabled =
      state.config.game_types[game.game_type]?.upload_enabled !== false;
    option.value = game.id;
    option.textContent = uploadEnabled
      ? `[${game.game_type}] ${game.name}`
      : `[${game.game_type}·仅封面] ${game.name}`;
    existingGame.append(option);
  }
  existingGame.value = selected;
}

function renderGames() {
  const visible = state.games.filter((game) => game.game_type === state.activeType);
  el('gameCount').textContent = `${visible.length} 个游戏`;
  const version = state.catalogVersions[state.activeType] || null;
  catalogVersionText.textContent = version
    ? `版本 ${formatVersionTime(version)}`
    : '暂无版本时间';
  catalogVersion.title = version
    ? `${state.activeType} 分类版本\n${version}`
    : `${state.activeType} 分类尚无版本时间`;
  const repository = state.catalogRepositories[state.activeType];
  catalogRepositoryLabel.textContent = `${state.activeType} 发布仓库`;
  if (repository?.url) {
    catalogRepositoryLink.textContent = repository.url;
    catalogRepositoryLink.href = repository.url;
    catalogRepositoryLink.title = `${repository.repository} · ${repository.url}`;
  } else {
    catalogRepositoryLink.textContent = '未配置仓库地址';
    catalogRepositoryLink.href = '#';
    catalogRepositoryLink.title = '';
  }
  gameList.replaceChildren();

  if (visible.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    const title = document.createElement('strong');
    title.textContent = '这个类型还没有游戏';
    const body = document.createElement('span');
    body.textContent = '从左侧上传一个 ROM，发布后手机端即可读取。';
    empty.append(title, body);
    gameList.append(empty);
    return;
  }

  for (const game of visible) gameList.append(createGameRow(game));
}

function createGameRow(game) {
  const row = document.createElement('article');
  row.className = 'game-row';

  if (game.local.cover || game.public.cover) {
    const image = document.createElement('img');
    image.className = 'game-cover';
    image.src = game.local.cover || game.public.cover;
    image.alt = `${game.name} 海报`;
    image.loading = 'lazy';
    image.addEventListener('error', () => {
      if (game.public.cover && image.src !== game.public.cover) {
        image.src = game.public.cover;
      } else {
        image.replaceWith(coverPlaceholder(game));
      }
    });
    row.append(image);
  } else {
    row.append(coverPlaceholder(game));
  }

  const info = document.createElement('div');
  info.className = 'game-info';
  const name = document.createElement('h3');
  name.className = 'game-name';
  name.textContent = game.name;

  const meta = document.createElement('div');
  meta.className = 'game-meta';
  meta.append(
    metaItem(game.game_type),
    metaItem(formatBytes(game.file_size)),
    metaItem(`v${game.revision}`),
    metaItem(shortHash(game.sha256)),
  );

  const links = document.createElement('div');
  links.className = 'game-links';
  links.append(
    externalLink('ROM', game.public.rom),
    externalLink('海报', game.public.cover),
    externalLink('JSON', game.public.catalog),
  );
  info.append(name, meta, links);

  const actions = document.createElement('div');
  actions.className = 'game-actions';
  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'secondary';
  const uploadEnabled =
    state.config.game_types[game.game_type]?.upload_enabled !== false;
  edit.title = uploadEnabled
    ? '更新游戏'
    : `${game.game_type} ROM 已锁定，只能更新封面`;
  edit.textContent = uploadEnabled ? '更新' : '更新封面';
  edit.addEventListener('click', () => {
    existingGame.value = game.id;
    selectExistingGame(game.id);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'danger';
  remove.textContent = '删除';
  remove.addEventListener('click', () => deleteGame(game));
  actions.append(edit, remove);

  row.append(info, actions);
  return row;
}

function coverPlaceholder(game) {
  const placeholder = document.createElement('div');
  placeholder.className = 'cover-placeholder';
  placeholder.textContent = game.game_type.slice(0, 2);
  return placeholder;
}

function metaItem(text) {
  const span = document.createElement('span');
  span.textContent = text;
  return span;
}

function externalLink(label, href) {
  if (!href) return document.createTextNode(`${label}: 无`);
  const link = document.createElement('a');
  link.href = href;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = label;
  return link;
}

function selectExistingGame(id) {
  const game = state.games.find((item) => item.id === id);
  if (!game) {
    clearEditMode();
    return;
  }
  state.editingId = id;
  state.autoFilledName = null;
  existingGame.value = id;
  const uploadEnabled =
    state.config.game_types[game.game_type]?.upload_enabled !== false;
  gameName.value = game.name;
  gameName.readOnly = !uploadEnabled;
  gameNameEn.value = game.name_en || '';
  gameNameEn.readOnly = !uploadEnabled;
  gameType.value = game.game_type;
  gameType.disabled = true;
  romFile.value = '';
  romFile.disabled = !uploadEnabled;
  coverFile.value = '';
  el('coverPreviewWrap').classList.add('hidden');
  romFile.required = false;
  el('romRequired').classList.add('hidden');
  el('romLabel').childNodes[0].nodeValue = uploadEnabled
    ? '替换 ROM / ZIP 游戏包 '
    : 'ROM / ZIP 游戏包 已锁定 ';
  submitButton.textContent = uploadEnabled ? '保存修改' : '保存封面';
  newGameButton.classList.remove('hidden');
  el('currentRom').classList.remove('hidden');
  el('currentRomName').textContent = game.file_name;
  el('currentRomMeta').textContent =
    `${formatBytes(game.file_size)} · SHA-256 ${shortHash(game.sha256)}`;
  el('currentRomLink').href = game.public.rom || '#';
  el('selectedCover').classList.remove('hidden');
  el('selectedCover').textContent = game.cover_path
    ? uploadEnabled
      ? '当前海报会保留；选择新海报后替换。'
      : '当前海报会保留；选择新海报后替换，ROM 和名称不可修改。'
    : '当前没有海报；可以选择一个。';
  el('romHint').textContent = uploadEnabled
    ? '不选择新文件则保留当前 ROM。'
    : `${game.game_type} ROM 已锁定，仅允许更新封面。`;
  updateExtensionHint();
}

function clearEditMode() {
  state.editingId = null;
  state.autoFilledName = null;
  gameForm.reset();
  existingGame.value = '';
  gameType.disabled = false;
  gameName.readOnly = false;
  gameNameEn.readOnly = false;
  romFile.disabled = false;
  romFile.required = true;
  el('romRequired').classList.remove('hidden');
  el('romLabel').childNodes[0].nodeValue = 'ROM / ZIP 游戏包 ';
  submitButton.textContent = '上传并发布';
  newGameButton.classList.add('hidden');
  el('currentRom').classList.add('hidden');
  el('selectedCover').classList.add('hidden');
  el('coverPreviewWrap').classList.add('hidden');
  el('romHint').textContent = state.config
    ? `最大 ${formatLimit(state.config.limits.rom_bytes)}`
    : '最大 10MB';
  updateExtensionHint();
}

function handleRomSelected() {
  updateExtensionHint();
  const file = romFile.files?.[0];
  if (!file || state.editingId) return;

  const currentName = gameName.value.trim();
  if (currentName && currentName !== state.autoFilledName) return;

  const defaultName = stripFileExtension(file.name);
  gameName.value = defaultName;
  state.autoFilledName = defaultName;
}

function stripFileExtension(filename) {
  const value = String(filename || '').trim();
  const lastDot = value.lastIndexOf('.');
  if (lastDot <= 0) return value;
  return value.slice(0, lastDot);
}

function updateExtensionHint() {
  if (!state.config) return;
  const type = gameType.value;
  const extensions = state.config.game_types[type]?.extensions || [];
  el('extensionHint').textContent = `允许扩展名：${extensions.join('、')}`;
  if (romFile.files?.[0]) {
    const name = romFile.files[0].name;
    const extension = `.${name.split('.').pop().toLowerCase()}`;
    if (!extensions.includes(extension)) {
      el('romHint').textContent = `当前文件 ${extension} 与 ${type} 不匹配`;
    } else {
      el('romHint').textContent = `${formatBytes(romFile.files[0].size)}，最大 ${formatLimit(state.config.limits.rom_bytes)}`;
    }
  }
}

function previewCover() {
  const file = coverFile.files?.[0];
  if (!file) {
    el('coverPreviewWrap').classList.add('hidden');
    return;
  }
  const imageUrl = URL.createObjectURL(file);
  el('coverPreview').src = imageUrl;
  el('coverPreviewMeta').textContent = `${file.name} · ${formatBytes(file.size)}`;
  el('coverPreviewWrap').classList.remove('hidden');
}

async function handleSubmit(event) {
  event.preventDefault();
  clearMessage();
  const rom = romFile.files?.[0];
  if (rom && isUploadLocked()) {
    showNotice(`${gameType.value} ROM 已锁定，只能更新封面。`, 'error');
    return;
  }
  if (!rom && !state.editingId) {
    showNotice('新游戏必须选择 ROM 或 ZIP 游戏包。', 'error');
    return;
  }

  const maxRom = state.config.limits.rom_bytes;
  const maxCover = state.config.limits.cover_bytes;
  if (rom && rom.size > maxRom) {
    showNotice(`游戏包超过 ${formatLimit(maxRom)}。`, 'error');
    return;
  }
  if (coverFile.files?.[0] && coverFile.files[0].size > maxCover) {
    showNotice(`海报超过 ${formatLimit(maxCover)}。`, 'error');
    return;
  }

  const form = new FormData();
  form.append('name', gameName.value.trim());
  form.append('name_en', gameNameEn.value.trim());
  form.append('game_type', gameType.value);
  if (rom) form.append('rom', rom, rom.name);
  if (state.editingId) form.append('id', state.editingId);
  if (coverFile.files?.[0]) form.append('cover', coverFile.files[0], coverFile.files[0].name);

  setBusy(true);
  try {
    const result = await upload('/api/games', form);
    const packageSummary = result.package?.preserved
      ? `已保留原有 ${result.package.format.toUpperCase()} 游戏包。`
      : result.package?.format === 'zip'
        ? `ZIP 内容识别为 ${result.package.detected_type}，共 ${result.package.entry_count} 个文件。`
        : `游戏包格式：${result.package?.format || 'unknown'}。`;
    showNotice(
      `发布成功，commit ${result.commit}。\n${packageSummary}\n手机端列表：${result.public.catalog}`,
      'success',
    );
    await reloadGames();
    clearEditMode();
  } catch (error) {
    showNotice(error.message, 'error');
    if (error.code === 'PUSH_FAILED') {
      syncButton.dataset.repository = error.repository || '';
      syncButton.classList.remove('hidden');
    }
  } finally {
    setBusy(false);
  }
}

function upload(url, body) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.upload.addEventListener('progress', (event) => {
      if (!event.lengthComputable) return;
      const percent = Math.max(2, Math.round((event.loaded / event.total) * 100));
      progressBar.style.width = `${percent}%`;
    });
    request.addEventListener('load', () => {
      let payload = {};
      try { payload = JSON.parse(request.responseText || '{}'); } catch {}
      if (request.status >= 200 && request.status < 300) resolve(payload);
      else {
        const error = new Error(payload.error || `上传失败 (HTTP ${request.status})`);
        error.code = payload.code;
        error.commit = payload.commit;
        error.repository = payload.repository;
        reject(error);
      }
    });
    request.addEventListener('error', () => reject(new Error('无法连接本地发布服务')));
    request.send(body);
  });
}

async function reloadGames() {
  const result = await api('/api/games');
  state.games = result.games || [];
  state.catalogVersions = result.catalog_versions || {};
  state.catalogRepositories = result.catalog_repositories || {};
  renderTypeTabs();
  renderExistingOptions();
  renderGames();
}

function deleteGame(game) {
  state.pendingDeleteGame = game;
  state.deleting = false;
  deleteDialogText.textContent =
    `确定删除“${game.name}”吗？\n\nROM、海报和 JSON 记录会在同一个 Git commit 中删除，并立即推送到 GitHub。`;
  deleteConfirmActions.classList.remove('hidden');
  deleteProgressWrap.classList.add('hidden', 'is-error', 'is-done');
  deleteProgressBar.style.width = '6%';
  deleteProgressText.textContent = '正在删除文件并提交到 GitHub...';
  deleteCloseButton.classList.add('hidden');
  deleteRetryButton.classList.add('hidden');
  deleteDialog.classList.remove('hidden');
  deleteConfirmButton.focus();
}

async function confirmDelete() {
  const game = state.pendingDeleteGame;
  if (!game || state.deleting) return;
  clearMessage();
  state.deleting = true;
  deleteConfirmActions.classList.add('hidden');
  deleteProgressWrap.classList.remove('hidden', 'is-error', 'is-done');
  deleteProgressText.textContent = '正在删除 JSON 记录、ROM 和海报，并创建 Git commit...';
  startDeleteProgress();

  try {
    const result = await api(`/api/games/${encodeURIComponent(game.id)}`, { method: 'DELETE' });
    finishDeleteProgress(`删除成功，commit ${result.commit}。正在刷新列表...`);
    if (state.editingId === game.id) clearEditMode();
    await reloadGames();
    showNotice(`删除成功，commit ${result.commit}。`, 'success');
    window.setTimeout(closeDeleteDialog, 900);
  } catch (error) {
    stopDeleteProgress();
    deleteProgressWrap.classList.remove('is-done');
    deleteProgressWrap.classList.add('is-error');
    deleteProgressText.textContent = error.code === 'PUSH_FAILED'
      ? `本地删除和 commit 已完成，但推送到 GitHub 失败。\n${error.message}`
      : `删除失败：${error.message}`;
    deleteRetryButton.classList.toggle('hidden', error.code !== 'PUSH_FAILED');
    deleteCloseButton.classList.remove('hidden');
    if (error.code === 'PUSH_FAILED') {
      deleteRetryButton.dataset.repository = error.repository || '';
      syncButton.dataset.repository = error.repository || '';
      syncButton.classList.remove('hidden');
    }
  } finally {
    state.deleting = false;
  }
}

async function retryDeletePush() {
  if (state.deleting) return;
  state.deleting = true;
  deleteRetryButton.classList.add('hidden');
  deleteCloseButton.classList.add('hidden');
  deleteProgressWrap.classList.remove('is-error', 'is-done');
  deleteProgressText.textContent = '正在重试推送到 GitHub...';
  startDeleteProgress();
  try {
    const repository = deleteRetryButton.dataset.repository;
    const url = repository
      ? `/api/sync?repository=${encodeURIComponent(repository)}`
      : '/api/sync';
    const result = await api(url, { method: 'POST' });
    finishDeleteProgress(`${result.repository || repository || '主仓库'} 推送成功，游戏已从公开列表删除。`);
    syncButton.classList.add('hidden');
    await reloadGames();
    window.setTimeout(closeDeleteDialog, 900);
  } catch (error) {
    stopDeleteProgress();
    deleteProgressWrap.classList.add('is-error');
    deleteProgressText.textContent = `推送仍然失败：${error.message}`;
    if (error.repository) deleteRetryButton.dataset.repository = error.repository;
    deleteRetryButton.classList.remove('hidden');
    deleteCloseButton.classList.remove('hidden');
  } finally {
    state.deleting = false;
  }
}

function startDeleteProgress() {
  window.clearInterval(state.deleteTimer);
  let percent = 8;
  deleteProgressBar.style.width = `${percent}%`;
  state.deleteTimer = window.setInterval(() => {
    percent = Math.min(88, percent + Math.max(1, (90 - percent) * 0.08));
    deleteProgressBar.style.width = `${percent.toFixed(1)}%`;
  }, 220);
}

function stopDeleteProgress() {
  window.clearInterval(state.deleteTimer);
  state.deleteTimer = null;
}

function finishDeleteProgress(message) {
  stopDeleteProgress();
  deleteProgressWrap.classList.remove('is-error');
  deleteProgressWrap.classList.add('is-done');
  deleteProgressBar.style.width = '100%';
  deleteProgressText.textContent = message;
  deleteCloseButton.classList.remove('hidden');
}

function closeDeleteDialog() {
  if (state.deleting) return;
  stopDeleteProgress();
  deleteDialog.classList.add('hidden');
  state.pendingDeleteGame = null;
}

async function retryPush() {
  clearMessage();
  const repository = syncButton.dataset.repository;
  const url = repository
    ? `/api/sync?repository=${encodeURIComponent(repository)}`
    : '/api/sync';
  try {
    const result = await api(url, { method: 'POST' });
    syncButton.classList.add('hidden');
    showNotice(
      `${result.repository || repository || '主仓库'} 推送成功，GitHub 上的文件已更新。`,
      'success',
    );
  } catch (error) {
    if (error.repository) syncButton.dataset.repository = error.repository;
    showNotice(error.message, 'error');
  }
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok || payload.ok === false) {
    const error = new Error(payload.error || `请求失败 (HTTP ${response.status})`);
    error.code = payload.code;
    error.commit = payload.commit;
    error.repository = payload.repository;
    throw error;
  }
  return payload;
}

function setBusy(busy) {
  submitButton.disabled = busy;
  submitButton.textContent = busy
    ? '正在保存并推送...'
    : state.editingId
      ? isUploadLocked()
        ? '保存封面'
        : '保存修改'
      : '上传并发布';
  progress.classList.toggle('hidden', !busy);
  if (!busy) progressBar.style.width = '0%';
}

function showNotice(message, kind = 'info', timeout = 0) {
  notice.textContent = message;
  notice.className = `notice ${kind}`;
  if (timeout) {
    window.clearTimeout(showNotice.timer);
    showNotice.timer = window.setTimeout(clearMessage, timeout);
  }
}

function isUploadLocked(type = gameType.value) {
  return state.config?.game_types?.[type]?.upload_enabled === false;
}

function clearMessage() {
  window.clearTimeout(showNotice.timer);
  notice.className = 'notice hidden';
  notice.textContent = '';
}

function formatVersionTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const parts = new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const milliseconds = String(date.getMilliseconds()).padStart(3, '0');
  return `${values.year}-${values.month}-${values.day} ${values.hour}:${values.minute}:${values.second}.${milliseconds}`;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '';
  if (bytes >= 1024 * 1024) return `${Number((bytes / 1024 / 1024).toFixed(1))}MB`;
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)}KB`;
  return `${bytes}B`;
}

function formatLimit(bytes) {
  return formatBytes(bytes).replace('.0', '');
}

function shortHash(hash) {
  return hash ? `${hash.slice(0, 8)}…` : '';
}

init();
