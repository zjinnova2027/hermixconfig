'use strict';

const state = {
  config: null,
  overview: null,
  selectedType: null,
  preview: null,
  job: null,
  pollTimer: null,
};

const el = (id) => document.getElementById(id);
const notice = el('notice');
const repositoryCards = el('repositoryCards');
const routeRows = el('routeRows');
const migrationDialog = el('migrationDialog');
const migrationError = el('migrationError');
const formStep = el('migrationFormStep');
const checkStep = el('migrationCheckStep');
const progressStep = el('migrationProgressStep');
const targetRepositoryUrl = el('targetRepositoryUrl');
const targetBranch = el('targetBranch');
const preflightButton = el('preflightButton');
const startMigrationButton = el('startMigrationButton');
const retryMigrationButton = el('retryMigrationButton');
const restartMigrationButton = el('restartMigrationButton');
const migrationDoneButton = el('migrationDoneButton');
const migrationCloseButton = el('migrationCloseButton');

async function init() {
  bindEvents();
  try {
    const [config, overview] = await Promise.all([
      api('/api/config'),
      api('/api/repositories'),
    ]);
    state.config = config;
    renderOverview(overview);
    const requestedType = new URLSearchParams(window.location.search).get('type');
    if (requestedType) {
      const item = overview.game_types.find((entry) => entry.type === requestedType);
      if (item) openMigration(item);
    }
    const latest = await api('/api/repositories/migrations/latest');
    if (latest.job) renderLatestJob(latest.job);
  } catch (error) {
    showNotice(error.message, 'error');
  }
}

function bindEvents() {
  el('cancelMigrationButton').addEventListener('click', closeMigration);
  migrationCloseButton.addEventListener('click', closeMigration);
  migrationDialog.addEventListener('click', (event) => {
    if (event.target === migrationDialog && !isRunning()) closeMigration();
  });
  preflightButton.addEventListener('click', runPreflight);
  el('backToFormButton').addEventListener('click', showFormStep);
  startMigrationButton.addEventListener('click', startMigration);
  retryMigrationButton.addEventListener('click', retryMigration);
  restartMigrationButton.addEventListener('click', restartMigration);
  migrationDoneButton.addEventListener('click', closeMigration);
  targetRepositoryUrl.addEventListener('input', clearMigrationError);
  targetBranch.addEventListener('input', clearMigrationError);
}

function renderOverview(overview) {
  state.overview = overview;
  const mainId = state.config.main_repository;
  const mainRepo = overview.repositories.find((repo) => repo.id === mainId);
  el('mainRepoLink').textContent = mainRepo?.url || '未配置';
  el('mainRepoLink').href = mainRepo?.url || '#';
  el('mainRepoMeta').textContent = `${mainId} · ${mainRepo?.branch || 'main'}`;
  el('repositoryCount').textContent = `${overview.repositories.length} 个仓库`;

  repositoryCards.replaceChildren();
  for (const repository of overview.repositories) {
    const card = document.createElement('article');
    card.className = 'repository-item';
    const head = document.createElement('div');
    head.className = 'repository-item-head';
    const title = document.createElement('strong');
    title.textContent = repository.id;
    const badge = document.createElement('span');
    badge.className = repository.id === mainId ? 'repo-badge main' : 'repo-badge';
    badge.textContent = repository.id === mainId ? '总库' : '分类库';
    head.append(title, badge);

    const link = document.createElement('a');
    link.href = repository.url;
    link.target = '_blank';
    link.rel = 'noreferrer';
    link.textContent = repository.url;

    const meta = document.createElement('div');
    meta.className = 'repository-meta';
    meta.textContent = `${repository.branch} · ${repository.types.length ? repository.types.join(' / ') : '未分配分类'}`;

    card.append(head, link, meta);
    repositoryCards.append(card);
  }

  routeRows.replaceChildren();
  for (const item of overview.game_types) {
    const row = document.createElement('tr');
    row.append(
      cell(item.type, 'route-type'),
      repositoryCell(item.repository, item.repository_url),
      cell(String(item.games)),
      cell(item.updated_at ? formatTime(item.updated_at) : '暂无版本', 'route-version'),
    );
    const action = document.createElement('td');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'secondary';
    button.textContent = '迁移到新仓库';
    button.addEventListener('click', () => openMigration(item));
    action.append(button);
    row.append(action);
    routeRows.append(row);
  }

  if (overview.pending_job) {
    renderLatestJob(overview.pending_job);
  }
}

function cell(text, className = '') {
  const td = document.createElement('td');
  td.textContent = text;
  if (className) td.className = className;
  return td;
}

function repositoryCell(id, url) {
  const td = document.createElement('td');
  const link = document.createElement('a');
  link.href = url;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = id;
  td.append(link);
  return td;
}

function renderLatestJob(job) {
  const panel = el('latestJobPanel');
  panel.classList.remove('hidden');
  const summary = el('latestJobSummary');
  summary.replaceChildren();
  const line = document.createElement('div');
  line.className = 'latest-job-line';
  const stateLabel = document.createElement('span');
  stateLabel.className = `job-state ${job.status}`;
  stateLabel.textContent = statusLabel(job.status);
  const text = document.createElement('strong');
  text.textContent = `${job.input.type} → ${job.preview.target_repository.url}`;
  const message = document.createElement('span');
  message.textContent = job.message;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'secondary';
  button.textContent = job.status === 'needs_attention' ? '处理任务' : '查看进度';
  button.addEventListener('click', () => {
    state.job = job;
    openMigrationForJob(job);
  });
  line.append(stateLabel, text, message, button);
  summary.append(line);
}

function openMigration(item) {
  state.selectedType = item.type;
  state.preview = null;
  state.job = null;
  clearMigrationError();
  el('migrationTypeLabel').textContent = item.type;
  el('migrationSourceRepo').textContent = `${item.repository} · ${item.repository_url}`;
  targetRepositoryUrl.value = '';
  targetBranch.value = 'main';
  showFormStep();
  setStep(1);
  migrationDialog.classList.remove('hidden');
  targetRepositoryUrl.focus();
}

function openMigrationForJob(job) {
  state.job = job;
  state.selectedType = job.input.type;
  state.preview = job.preview;
  clearMigrationError();
  el('migrationTypeLabel').textContent = job.input.type;
  el('migrationSourceRepo').textContent =
    `${job.preview.source_repository.id} · ${job.preview.source_repository.url}`;
  migrationDialog.classList.remove('hidden');
  showProgressStep();
  renderJob(job);
  if (isRunning()) startPolling(job.id);
}

function showFormStep() {
  setStep(1);
  formStep.classList.remove('hidden');
  checkStep.classList.add('hidden');
  progressStep.classList.add('hidden');
  stopPolling();
}

function showCheckStep() {
  setStep(2);
  formStep.classList.add('hidden');
  checkStep.classList.remove('hidden');
  progressStep.classList.add('hidden');
}

function showProgressStep() {
  setStep(3);
  formStep.classList.add('hidden');
  checkStep.classList.add('hidden');
  progressStep.classList.remove('hidden');
}

function setStep(step) {
  document.querySelectorAll('.migration-step').forEach((node) => {
    const value = Number(node.dataset.step);
    node.classList.toggle('active', value === step);
    node.classList.toggle('done', value < step);
  });
}

async function runPreflight() {
  clearMigrationError();
  const repositoryUrl = targetRepositoryUrl.value.trim();
  if (!repositoryUrl) {
    showMigrationError('请输入新 GitHub 仓库地址');
    targetRepositoryUrl.focus();
    return;
  }
  preflightButton.disabled = true;
  preflightButton.textContent = '正在检查...';
  try {
    const result = await api('/api/repositories/migrations/preflight', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: state.selectedType,
        repository_url: repositoryUrl,
        branch: targetBranch.value.trim() || 'main',
      }),
    });
    state.preview = result.preview;
    renderPreview(result.preview);
    showCheckStep();
  } catch (error) {
    showMigrationError(error.message);
  } finally {
    preflightButton.disabled = false;
    preflightButton.textContent = '检查环境';
  }
}

function renderPreview(preview) {
  const checks = el('checkList');
  checks.replaceChildren();
  for (const check of preview.checks) {
    const row = document.createElement('div');
    row.className = 'check-row';
    const icon = document.createElement('span');
    icon.className = 'check-icon ok';
    icon.textContent = '✓';
    const label = document.createElement('span');
    label.textContent = check.label;
    row.append(icon, label);
    checks.append(row);
  }

  const summary = el('migrationSummary');
  summary.replaceChildren();
  const flow = document.createElement('div');
  flow.className = 'migration-flow-card';
  flow.innerHTML = `
    <div><span>当前仓库</span><strong>${escapeHtml(preview.source_repository.id)}</strong></div>
    <div class="migration-arrow">→</div>
    <div><span>新仓库</span><strong>${escapeHtml(preview.target_repository.id)}</strong></div>
  `;

  const stats = document.createElement('div');
  stats.className = 'migration-stats';
  stats.append(
    statCard('游戏', String(preview.summary.games)),
    statCard('ROM', String(preview.summary.roms)),
    statCard('海报', String(preview.summary.covers)),
    statCard('总文件', String(preview.summary.files)),
    statCard('总大小', formatBytes(preview.summary.bytes)),
  );

  const path = document.createElement('div');
  path.className = 'migration-hint';
  path.innerHTML = `
    本地目录：<code>${escapeHtml(preview.target_local_root)}</code><br>
    迁移成功后会更新总库索引，并删除旧仓库中的 ${escapeHtml(preview.type)} 分类数据。
  `;
  summary.append(flow, stats, path);
}

function statCard(label, value) {
  const node = document.createElement('div');
  node.className = 'migration-stat';
  const strong = document.createElement('strong');
  strong.textContent = value;
  const span = document.createElement('span');
  span.textContent = label;
  node.append(strong, span);
  return node;
}

async function startMigration() {
  if (!state.preview) return;
  clearMigrationError();
  startMigrationButton.disabled = true;
  startMigrationButton.textContent = '正在启动...';
  try {
    const result = await api('/api/repositories/migrations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: state.selectedType,
        repository_url: targetRepositoryUrl.value.trim(),
        branch: targetBranch.value.trim() || 'main',
      }),
    });
    state.job = result.job;
    showProgressStep();
    renderJob(result.job);
    startPolling(result.job.id);
  } catch (error) {
    showMigrationError(error.message);
  } finally {
    startMigrationButton.disabled = false;
    startMigrationButton.textContent = '开始迁移';
  }
}

async function restartMigration() {
  if (!state.job) return;
  clearMigrationError();
  try {
    await api(
      `/api/repositories/migrations/${encodeURIComponent(state.job.id)}/cancel`,
      { method: 'POST' },
    );
    const item = state.overview.game_types.find(
      (entry) => entry.type === state.selectedType,
    );
    state.job = null;
    state.preview = null;
    if (item) openMigration(item);
    await refreshOverview();
  } catch (error) {
    showMigrationError(error.message);
  }
}

async function retryMigration() {
  if (!state.job) return;
  clearMigrationError();
  try {
    const result = await api(
      `/api/repositories/migrations/${encodeURIComponent(state.job.id)}/retry`,
      { method: 'POST' },
    );
    state.job = result.job;
    renderJob(result.job);
    startPolling(result.job.id);
  } catch (error) {
    showMigrationError(error.message);
  }
}

function startPolling(jobId) {
  stopPolling();
  state.pollTimer = window.setInterval(() => pollJob(jobId), 800);
  pollJob(jobId);
}

function stopPolling() {
  window.clearInterval(state.pollTimer);
  state.pollTimer = null;
}

async function pollJob(jobId) {
  try {
    const result = await api(
      `/api/repositories/migrations/${encodeURIComponent(jobId)}`,
    );
    state.job = result.job;
    renderJob(result.job);
    if (!isRunning()) {
      stopPolling();
      if (result.job.status === 'completed') {
        await refreshOverview();
      }
    }
  } catch (error) {
    stopPolling();
    showMigrationError(error.message);
  }
}

function renderJob(job) {
  const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
  el('jobStageLabel').textContent = job.stage_label || statusLabel(job.status);
  el('jobMessage').textContent = job.message || '';
  el('jobProgressText').textContent = `${progress}%`;
  el('jobProgressBar').style.width = `${progress}%`;

  const steps = el('jobSteps');
  steps.replaceChildren();
  const labels = [
    ['prepare_target', '准备目标仓库'],
    ['copy_files', '复制分类、海报和 ROM'],
    ['verify_target', '校验目标文件'],
    ['push_target', '提交并推送新仓库'],
    ['switch_index', '更新总库索引和配置'],
    ['cleanup_old', '清理旧仓库分类数据'],
  ];
  let activeFound = false;
  for (const [key, label] of labels) {
    const node = document.createElement('div');
    const done = Boolean(job.completed?.[key]);
    const active = !done && !activeFound && job.status !== 'completed';
    if (active) activeFound = true;
    node.className = `job-step${done ? ' done' : ''}${active || job.stage === key ? ' active' : ''}`;
    const icon = document.createElement('span');
    icon.textContent = done ? '✓' : active || job.stage === key ? '•' : '○';
    const text = document.createElement('span');
    text.textContent = label;
    node.append(icon, text);
    steps.append(node);
  }

  const log = el('jobLog');
  log.replaceChildren();
  for (const item of (job.log || []).slice(-60)) {
    const line = document.createElement('div');
    line.className = `log-line ${item.level}`;
    const time = new Date(item.at).toLocaleTimeString('zh-CN', { hour12: false });
    line.textContent = `[${time}] ${item.message}`;
    log.append(line);
  }
  log.scrollTop = log.scrollHeight;

  const errorBox = el('migrationError');
  if (job.status === 'needs_attention' && job.error) {
    errorBox.classList.remove('hidden');
    errorBox.innerHTML = `
      <strong>迁移暂停</strong>
      <span>${escapeHtml(job.error.message)}</span>
      <small>${escapeHtml(job.safe_state || '')}</small>
    `;
  } else {
    errorBox.classList.add('hidden');
  }

  retryMigrationButton.classList.toggle('hidden', job.status !== 'needs_attention');
  restartMigrationButton.classList.toggle(
    'hidden',
    job.status !== 'needs_attention' || Boolean(job.completed?.target_pushed),
  );
  migrationDoneButton.classList.toggle('hidden', job.status !== 'completed');
  migrationDoneButton.textContent = job.status === 'completed' ? '完成' : '关闭';
}

function statusLabel(status) {
  return {
    running: '执行中',
    needs_attention: '需要处理',
    completed: '已完成',
  }[status] || status;
}

function isRunning() {
  return state.job?.status === 'running';
}

async function refreshOverview() {
  const overview = await api('/api/repositories');
  renderOverview(overview);
}

function closeMigration() {
  if (isRunning()) return;
  stopPolling();
  migrationDialog.classList.add('hidden');
  state.job = null;
  state.preview = null;
}

function showMigrationError(message) {
  migrationError.classList.remove('hidden');
  migrationError.textContent = message;
}

function clearMigrationError() {
  migrationError.classList.add('hidden');
  migrationError.textContent = '';
}

function showNotice(message, kind = 'info') {
  notice.textContent = message;
  notice.className = `notice ${kind}`;
}

async function api(url, options = {}) {
  const response = await fetch(url, options);
  let payload = {};
  try { payload = await response.json(); } catch {}
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.error || `请求失败 (HTTP ${response.status})`);
  }
  return payload;
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '0B';
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024 / 1024).toFixed(2)}GB`;
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
  if (bytes >= 1024) return `${Math.ceil(bytes / 1024)}KB`;
  return `${bytes}B`;
}

function formatTime(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

init();
