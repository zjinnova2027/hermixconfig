'use strict';

const DEFAULT_TIMEOUT_MS = 7000;

function withCacheBuster(url) {
  try {
    const value = new URL(url);
    value.searchParams.set('t', String(Date.now()));
    return value.toString();
  } catch {
    return url;
  }
}

function publicFileUrl(baseUrl, relativePath) {
  return new URL(relativePath.replace(/^\/+/, ''), `${String(baseUrl).replace(/\/+$/, '')}/`).toString();
}

function friendlyError(error, timeoutMs) {
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return `请求超时（${timeoutMs}ms）`;
  }
  const code = error?.cause?.code || error?.code;
  if (code === 'ENOTFOUND') return '域名解析失败';
  if (code === 'ECONNREFUSED') return '连接被拒绝';
  if (code === 'ECONNRESET') return '连接被重置';
  return String(error?.message || error || '网络请求失败');
}

async function inspectUrl({
  key,
  label,
  url,
  timeoutMs,
  fetchImpl,
  method = 'GET',
  validate,
}) {
  const startedAt = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const check = {
    key,
    label,
    url,
    status: 'error',
    http_status: null,
    elapsed_ms: 0,
    detail: '',
    meta: null,
  };

  try {
    const response = await fetchImpl(withCacheBuster(url), {
      method,
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: method === 'HEAD' ? '*/*' : 'application/json,text/plain,*/*',
        'Cache-Control': 'no-cache',
        'User-Agent': 'game-list-publisher-network-test/1.0',
      },
    });
    check.http_status = response.status;
    check.elapsed_ms = Date.now() - startedAt;

    if (!response.ok) {
      check.detail = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
      try { await response.body?.cancel(); } catch {}
      return { check, payload: null };
    }

    if (method === 'HEAD') {
      check.status = 'ok';
      check.detail = '地址可访问';
      try { await response.body?.cancel(); } catch {}
      return { check, payload: null };
    }

    const body = await response.text();
    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      check.detail = '返回内容不是有效 JSON';
      return { check, payload: null };
    }

    const validation = validate
      ? validate(payload)
      : { status: 'ok', detail: 'JSON 格式有效' };
    check.status = validation.status || 'ok';
    check.detail = validation.detail || '检查通过';
    check.meta = validation.meta || null;
    return { check, payload };
  } catch (error) {
    check.elapsed_ms = Date.now() - startedAt;
    check.detail = friendlyError(error, timeoutMs);
    return { check, payload: null };
  } finally {
    clearTimeout(timeout);
  }
}

function soften(check, detail) {
  return {
    ...check,
    status: 'warning',
    detail: detail || check.detail,
  };
}

async function inspectPrimaryAndFallback(options) {
  const primaryPromise = inspectUrl({
    ...options,
    key: `${options.key}:primary`,
    label: `${options.label}（主地址）`,
    url: options.primaryUrl,
  });
  const fallbackPromise = options.fallbackUrl
    ? inspectUrl({
        ...options,
        key: `${options.key}:fallback`,
        label: `${options.label}（备用线路）`,
        url: options.fallbackUrl,
      })
    : Promise.resolve(null);

  let [{ check: primary, payload: primaryPayload }, fallbackResult] = await Promise.all([
    primaryPromise,
    fallbackPromise,
  ]);
  let fallback = fallbackResult?.check || null;
  let payload = primaryPayload;
  let source = primary.status === 'ok' || primary.status === 'warning' ? primary : null;

  if (primary.status === 'error' && fallback) {
    if (fallback.status === 'ok' || fallback.status === 'warning') {
      primary = soften(primary, `主地址不可用，已通过备用线路读取：${primary.detail}`);
      payload = fallbackResult.payload;
      source = fallback;
    } else {
      fallback = soften(fallback, `备用线路也不可用：${fallback.detail}`);
    }
  } else if (primary.status !== 'error' && fallback && fallback.status === 'error') {
    fallback = soften(fallback, `主地址正常，但备用线路不可用：${fallback.detail}`);
  }

  return {
    checks: [primary, fallback].filter(Boolean),
    payload,
    source,
  };
}

function indexValidator(payload) {
  if (!payload || typeof payload !== 'object') {
    return { status: 'error', detail: '索引内容为空' };
  }
  if (payload.schema_version !== 2) {
    return {
      status: 'error',
      detail: `索引 schema_version 应为 2，实际为 ${payload.schema_version ?? '缺失'}`,
    };
  }
  if (!payload.catalogs || typeof payload.catalogs !== 'object') {
    return { status: 'error', detail: '索引缺少 catalogs 对象' };
  }
  return {
    status: 'ok',
    detail: `${Object.keys(payload.catalogs).length} 个分类可读取`,
    meta: {
      schema_version: payload.schema_version,
      updated_at: payload.updated_at || null,
    },
  };
}

function clientConfigValidator(payload) {
  if (!payload || typeof payload !== 'object') {
    return { status: 'error', detail: '客户端配置内容为空' };
  }
  if (payload.schema_version !== 1) {
    return {
      status: 'error',
      detail: `客户端配置 schema_version 应为 1，实际为 ${payload.schema_version ?? '缺失'}`,
    };
  }
  const flags = payload.hide_game_ui;
  if (
    !flags ||
    typeof flags !== 'object' ||
    typeof flags.android !== 'boolean' ||
    typeof flags.ios !== 'boolean'
  ) {
    return {
      status: 'error',
      detail: 'hide_game_ui 必须同时包含布尔值 android 和 ios',
    };
  }
  return {
    status: 'ok',
    detail: `Android ${flags.android ? '隐藏' : '正常'} · iOS ${flags.ios ? '隐藏' : '正常'}`,
    meta: {
      schema_version: payload.schema_version,
      updated_at: payload.updated_at || null,
      hide_game_ui: flags,
    },
  };
}

function catalogValidator(payload) {
  if (!payload || typeof payload !== 'object') {
    return { status: 'error', detail: '分类表内容为空' };
  }
  if (!Array.isArray(payload.games)) {
    return { status: 'error', detail: '分类表缺少 games 数组' };
  }
  if (!Number.isInteger(payload.schema_version)) {
    return { status: 'error', detail: '分类表缺少 schema_version' };
  }
  return {
    status: 'ok',
    detail: `${payload.games.length} 个游戏`,
    meta: {
      schema_version: payload.schema_version,
      game_type: payload.game_type || null,
      updated_at: payload.updated_at || null,
    },
  };
}

function ensureGroup(groups, repositoryId, repository = null) {
  const id = String(repositoryId || 'unknown');
  if (!groups.has(id)) {
    groups.set(id, {
      id,
      label: repository?.id || id,
      github_url: repository?.githubUrl || '',
      branch: repository?.branch || '',
      public_base_url: repository?.publicBaseUrl || '',
      fallback_public_base_url: repository?.fallbackPublicBaseUrl || '',
      checks: [],
    });
  } else if (repository) {
    const group = groups.get(id);
    group.github_url ||= repository.githubUrl || '';
    group.branch ||= repository.branch || '';
    group.public_base_url ||= repository.publicBaseUrl || '';
    group.fallback_public_base_url ||= repository.fallbackPublicBaseUrl || '';
  }
  return groups.get(id);
}

async function runNetworkTest(config, options = {}) {
  const startedAt = Date.now();
  const timeoutMs = Number(options.timeoutMs) > 0
    ? Number(options.timeoutMs)
    : DEFAULT_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw new Error('当前 Node.js 环境不支持 fetch，请升级到 Node.js 20 或更高版本');
  }

  const repositories = Object.values(config.repositories || {});
  const mainRepository = config.mainRepository ||
    config.repositories?.[config.mainRepositoryId];
  if (!mainRepository) throw new Error('配置中缺少主仓库');

  const groups = new Map();
  for (const repository of repositories) ensureGroup(groups, repository.id, repository);

  const indexPath = 'catalog/index.json';
  const indexPrimaryUrl = publicFileUrl(mainRepository.publicBaseUrl, indexPath);
  const indexFallbackUrl = mainRepository.fallbackPublicBaseUrl
    ? publicFileUrl(mainRepository.fallbackPublicBaseUrl, indexPath)
    : '';
  const clientConfigPath = 'config/client.json';
  const clientConfigPrimaryUrl = publicFileUrl(
    mainRepository.publicBaseUrl,
    clientConfigPath,
  );
  const clientConfigFallbackUrl = mainRepository.fallbackPublicBaseUrl
    ? publicFileUrl(mainRepository.fallbackPublicBaseUrl, clientConfigPath)
    : '';

  const [githubChecks, indexResult, clientConfigResult] = await Promise.all([
    Promise.all(
      repositories.map(async (repository) => ({
        repository,
        result: await inspectUrl({
          key: `repository:${repository.id}`,
          label: 'GitHub 仓库页面',
          url: repository.githubUrl,
          timeoutMs,
          fetchImpl,
          method: 'HEAD',
        }),
      })),
    ),
    inspectPrimaryAndFallback({
      key: 'index',
      label: '公开索引 index.json',
      primaryUrl: indexPrimaryUrl,
      fallbackUrl: indexFallbackUrl,
      timeoutMs,
      fetchImpl,
      validate: indexValidator,
    }),
    inspectPrimaryAndFallback({
      key: 'client-config',
      label: '客户端配置 client.json',
      primaryUrl: clientConfigPrimaryUrl,
      fallbackUrl: clientConfigFallbackUrl,
      timeoutMs,
      fetchImpl,
      validate: clientConfigValidator,
    }),
  ]);

  for (const { repository, result } of githubChecks) {
    const check = result.check.status === 'error'
      ? soften(result.check, `GitHub 页面不可访问：${result.check.detail}`)
      : result.check;
    ensureGroup(groups, repository.id, repository).checks.push(check);
  }
  const mainGroup = ensureGroup(groups, mainRepository.id, mainRepository);
  mainGroup.checks.push(...indexResult.checks, ...clientConfigResult.checks);

  const index = indexResult.payload;
  if (index?.schema_version === 2 && index.catalogs) {
    const catalogChecks = await Promise.all(
      Object.entries(index.catalogs).map(async ([type, entry]) => {
        if (!entry?.url) {
          return {
            repositoryId: entry?.repository || mainRepository.id,
            checks: [{
              key: `catalog:${type}`,
              label: `${type} 分类表`,
              url: '',
              status: 'error',
              http_status: null,
              elapsed_ms: 0,
              detail: '索引缺少分类地址',
              meta: null,
            }],
          };
        }
        const result = await inspectPrimaryAndFallback({
          key: `catalog:${type}`,
          label: `${type} 分类表`,
          primaryUrl: entry.url,
          fallbackUrl: entry.fallback_url || '',
          timeoutMs,
          fetchImpl,
          validate: catalogValidator,
        });
        if (result.payload && entry.updated_at && result.payload.updated_at !== entry.updated_at) {
          for (const check of result.checks) {
            if (check.status === 'ok') {
              check.status = 'warning';
              check.detail = `版本不一致：索引 ${entry.updated_at}，分类表 ${result.payload.updated_at || '缺失'}`;
            }
          }
        }
        return {
          repositoryId: entry.repository || mainRepository.id,
          checks: result.checks,
        };
      }),
    );

    for (const item of catalogChecks) {
      const group = ensureGroup(groups, item.repositoryId);
      group.checks.push(...item.checks);
    }
  }

  const outputGroups = [...groups.values()].map((group) => {
    const errors = group.checks.filter((check) => check.status === 'error').length;
    const warnings = group.checks.filter((check) => check.status === 'warning').length;
    return {
      ...group,
      status: errors ? 'error' : warnings ? 'warning' : 'ok',
      error_count: errors,
      warning_count: warnings,
      check_count: group.checks.length,
    };
  });
  const allChecks = outputGroups.flatMap((group) => group.checks);
  const errorCount = allChecks.filter((check) => check.status === 'error').length;
  const warningCount = allChecks.filter((check) => check.status === 'warning').length;
  const okCount = allChecks.filter((check) => check.status === 'ok').length;

  return {
    checked_at: new Date().toISOString(),
    duration_ms: Date.now() - startedAt,
    overall_status: errorCount ? 'error' : warningCount ? 'warning' : 'ok',
    summary: {
      repository_count: outputGroups.length,
      check_count: allChecks.length,
      ok_count: okCount,
      warning_count: warningCount,
      error_count: errorCount,
    },
    groups: outputGroups,
  };
}

module.exports = {
  DEFAULT_TIMEOUT_MS,
  catalogValidator,
  clientConfigValidator,
  indexValidator,
  inspectUrl,
  publicFileUrl,
  runNetworkTest,
};
