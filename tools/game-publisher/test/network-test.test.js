'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runNetworkTest } = require('../src/network-health');

function makeConfig({ fallback = false } = {}) {
  const repository = {
    id: 'hermixrom',
    githubUrl: 'https://github.com/example/hermixrom',
    branch: 'main',
    publicBaseUrl: 'https://raw.githubusercontent.com/example/hermixrom/main/public',
    fallbackPublicBaseUrl: fallback
      ? 'https://gh-proxy.com/https://raw.githubusercontent.com/example/hermixrom/main/public'
      : '',
  };
  return {
    mainRepositoryId: 'hermixrom',
    mainRepository: repository,
    repositories: { hermixrom: repository },
  };
}

function response(payload, status = 200, statusText = 'OK') {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText,
    url: '',
    body: null,
    async text() {
      return typeof payload === 'string' ? payload : JSON.stringify(payload);
    },
  };
}

const index = {
  schema_version: 2,
  updated_at: '2026-11-03T10:00:00.000Z',
  catalogs: {
    GBA: {
      repository: 'hermixrom',
      repository_url: 'https://github.com/example/hermixrom',
      url: 'https://raw.githubusercontent.com/example/hermixrom/main/public/catalog/gba.json',
      fallback_url: null,
      updated_at: '2026-11-03T09:00:00.000Z',
    },
  },
};
const catalog = {
  schema_version: 1,
  game_type: 'GBA',
  updated_at: '2026-11-03T09:00:00.000Z',
  games: [{ id: 'gba-test', name: '测试游戏' }],
};
const clientConfig = {
  schema_version: 1,
  updated_at: '2026-11-03T09:30:00.000Z',
  hide_game_ui: { android: false, ios: true },
};

test('reports a healthy repository when GitHub, index and catalog are online', async () => {
  const fetchImpl = async (url, options) => {
    if (options.method === 'HEAD') return response(null);
    if (url.includes('/config/client.json')) return response(clientConfig);
    if (url.includes('/catalog/index.json')) return response(index);
    if (url.includes('/catalog/gba.json')) return response(catalog);
    throw new Error(`unexpected request: ${url}`);
  };

  const result = await runNetworkTest(makeConfig(), { fetchImpl, timeoutMs: 1000 });
  assert.equal(result.overall_status, 'ok');
  assert.equal(result.summary.error_count, 0);
  assert.equal(result.summary.warning_count, 0);
  assert.equal(result.groups.length, 1);
  assert.equal(result.groups[0].id, 'hermixrom');
  assert.equal(result.groups[0].status, 'ok');
  assert.deepEqual(
    result.groups[0].checks.map((check) => check.label),
    [
      'GitHub 仓库页面',
      '公开索引 index.json（主地址）',
      '客户端配置 client.json（主地址）',
      'GBA 分类表（主地址）',
    ],
  );
});

test('uses the fallback index when the primary GitHub Raw endpoint fails', async () => {
  const config = makeConfig({ fallback: true });
  const fetchImpl = async (url, options) => {
    if (options.method === 'HEAD') return response(null);
    if (url.startsWith('https://gh-proxy.com/')) {
      if (url.includes('/config/client.json')) return response(clientConfig);
      if (url.includes('/catalog/index.json')) return response(index);
      if (url.includes('/catalog/gba.json')) return response(catalog);
    }
    if (url.includes('/config/client.json')) return response(clientConfig);
    if (url.includes('/catalog/index.json')) return response('upstream error', 502, 'Bad Gateway');
    if (url.includes('/catalog/gba.json')) return response(catalog);
    throw new Error(`unexpected request: ${url}`);
  };

  const result = await runNetworkTest(config, { fetchImpl, timeoutMs: 1000 });
  assert.equal(result.overall_status, 'warning');
  assert.equal(result.summary.error_count, 0);
  assert.equal(result.summary.warning_count, 1);
  const indexPrimary = result.groups[0].checks.find(
    (check) => check.key === 'index:primary',
  );
  assert.equal(indexPrimary.status, 'warning');
  assert.match(indexPrimary.detail, /备用线路/);
});

test('reports an error when the public index has an unsupported schema', async () => {
  const fetchImpl = async (url, options) => {
    if (options.method === 'HEAD') return response(null);
    if (url.includes('/config/client.json')) return response(clientConfig);
    if (url.includes('/catalog/index.json')) {
      return response({ schema_version: 1, catalogs: {} });
    }
    throw new Error(`unexpected request: ${url}`);
  };

  const result = await runNetworkTest(makeConfig(), { fetchImpl, timeoutMs: 1000 });
  assert.equal(result.overall_status, 'error');
  assert.equal(result.summary.error_count, 1);
  const indexCheck = result.groups[0].checks.find((check) => check.key === 'index:primary');
  assert.equal(indexCheck.status, 'error');
  assert.match(indexCheck.detail, /schema_version/);
});

test('marks a catalog version mismatch as a warning', async () => {
  const mismatchedCatalog = {
    ...catalog,
    updated_at: '2026-11-03T08:00:00.000Z',
  };
  const fetchImpl = async (url, options) => {
    if (options.method === 'HEAD') return response(null);
    if (url.includes('/config/client.json')) return response(clientConfig);
    if (url.includes('/catalog/index.json')) return response(index);
    if (url.includes('/catalog/gba.json')) return response(mismatchedCatalog);
    throw new Error(`unexpected request: ${url}`);
  };

  const result = await runNetworkTest(makeConfig(), { fetchImpl, timeoutMs: 1000 });
  assert.equal(result.overall_status, 'warning');
  const catalogCheck = result.groups[0].checks.find(
    (check) => check.key === 'catalog:GBA:primary',
  );
  assert.equal(catalogCheck.status, 'warning');
  assert.match(catalogCheck.detail, /版本不一致/);
});
