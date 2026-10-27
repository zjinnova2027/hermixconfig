'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseGitHubUrl } = require('../src/repository-migration');

test('parses supported GitHub repository URLs', () => {
  assert.deepEqual(parseGitHubUrl('https://github.com/owner/game-list.git'), {
    owner: 'owner',
    repo: 'game-list',
    githubUrl: 'https://github.com/owner/game-list',
    cloneUrl: 'git@github.com:owner/game-list.git',
  });
});

test('rejects non-GitHub and malformed repository URLs', () => {
  assert.throws(() => parseGitHubUrl('https://example.com/owner/repo'));
  assert.throws(() => parseGitHubUrl('https://github.com/owner'));
});
