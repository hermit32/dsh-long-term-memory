import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');

test('插件清单声明 bundle patch 和入口', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.name, 'dsh-memory-feiyu');
  assert.equal(pkg.version, '2.0.2');
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.license, 'MIT');
  assert.equal(pkg.exports['.'], './lib/index.js');
  assert.equal(pkg.exports['./client'], './lib/client.js');
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(pkg.dsh.client.platform, 'web');
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings-general'));
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-api-workspace-files'));
  assert.ok(pkg.files.includes('lib'));
  assert.ok(pkg.files.includes('icon.svg'));
});

test('默认配置模板包含全部预算字段与演示工作区路径', async () => {
  const patch = await readFile(path.join(root, 'cordis.patch.yml'), 'utf8');
  for (const file of ['cordis.patch.yml', 'examples/config.example.yml']) {
    const config = await readFile(path.join(root, file), 'utf8');
    assert.match(config, /^\s*contextBudgetRatio: 0\s*$/m);
    assert.match(config, /^\s*contextBudgetHardRatio: 0\s*$/m);
  }
  for (const needle of [
    "privateWorkspace: 'C:\\demo\\workspace'",
    "memoryDir: 'C:\\demo\\workspace\\.dsh\\memories-feiyu'",
    'scopeMaxBytes: 12000',
    'maxBytes: 14000',
    'globalMaxBytes: 2000',
    'consolidateMaxBytes: 36000',
    'consolidateMaxTokens: 8192',
    'curateMaxBytes: 64000',
    'curateMaxTokens: 2000',
    'curateEntriesShown: 80',
    'keepSummaryVersions: 30',
    'rawArchiveMaxBytes: 300000',
    'injectIndex: true',
    'indexMaxBytes: 40960',
    'indexMaxTokens: 12000',
    'fallbackContextTokens: 8192',
    'digestMaxBytes: 12000',
    'digestMaxTokens: 4000',
    'fullSyncChangedEntries: 12',
    'fullSyncOnDelete: true',
    "longTermMode: 'off'",
    'curatorBackfill: false',
    'coreEnabled: true',
    'coreMaxItems: 10',
    'coreMaxBytes: 1600',
    'dreamingEnabled: true',
    'dreamingIntervalHours: 24',
    'usageHalfLifeDays: 30',
    'activityGraceHours: 24',
    'archiveRecallLimit: 20',
  ]) {
    assert.ok(patch.includes(needle), needle);
  }
});

test('默认配置模板不含任何本机绝对路径', async () => {
  const patch = await readFile(path.join(root, 'cordis.patch.yml'), 'utf8');
  const windowsPaths = new Set((patch.match(/[A-Za-z]:\\[^'\s]+/g) ?? []).map((item) => item.replace(/\\\\/g, '\\')));
  assert.deepEqual([...windowsPaths], ['C:\\demo\\workspace', 'C:\\demo\\workspace\\.dsh\\memories-feiyu', 'C:\\demo\\workspace\\.dsh\\memories-feiyu\\global']);
});

test('源码模块齐全', async () => {
  for (const file of [
    'lib/store.js',
    'lib/summary.js',
    'lib/index.js',
    'lib/feiyu.js',
    'lib/injection.js',
    'lib/curator.js',
    'lib/search.js',
    'lib/client.js',
    'lib/usage.js',
    'lib/activity.js',
    'lib/core.js',
    'lib/dreaming.js',
    'lib/config.js',
    'lib/text.js',
    'lib/types/index.d.ts',
  ]) {
    assert.ok((await stat(path.join(root, file))).isFile(), file);
  }
});

test('图标和本地化元数据有效', async () => {
  const icon = await readFile(path.join(root, 'icon.svg'), 'utf8');
  assert.match(icon, /^<svg[\s>]/);
  assert.match(icon, /<\/svg>\s*$/);
  const zh = JSON.parse(await readFile(path.join(root, 'locale', 'zh.json'), 'utf8'));
  const en = JSON.parse(await readFile(path.join(root, 'locale', 'en.json'), 'utf8'));
  assert.ok(zh.meta.title.length > 0);
  assert.ok(zh.meta.description.length > 0);
  assert.ok(en.meta.title.length > 0);
  assert.ok(en.meta.description.length > 0);
});
