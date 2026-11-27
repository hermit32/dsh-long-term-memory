import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir, stat, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { MemoryStore } from '../lib/store.js';
import { buildSnapshot } from '../lib/injection.js';

const root = path.resolve(import.meta.dirname, '..');
const examplePath = path.join(root, 'examples', 'AGENTS.example.md');

test('示例人设是工作区级固定文件，不是全局配置', async () => {
  const text = await readFile(examplePath, 'utf8');
  assert.match(text, /只适用于 `C:\\demo\\workspace` 工作区/);
  assert.match(text, /名字：小满/);
  assert.match(text, /自称：我/);
  assert.match(text, /不写入全局配置/);
  assert.match(text, /memory_search/);
  assert.ok((await stat(examplePath)).size < 65536);
});

test('人设不会被写进记忆文件', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'feiyu-persona-'));
  try {
    const store = await new MemoryStore({ memoryDir: path.join(dir, 'mem') }).init();
    await store.add({ content: '用户偏好先给结论，再给依据。', summary: '偏好先给结论', tags: ['偏好'] });
    await store.writeSummary('# 我记住的用户\n\n- 用户偏好先给结论，再给依据。', { mode: 'auto' });
    const raw = await readFile(path.join(dir, 'mem', 'raw_memories.md'), 'utf8');
    const summary = await readFile(path.join(dir, 'mem', 'memory_summary.md'), 'utf8');
    for (const needle of ['小满', '圆框眼镜', '固定人设']) {
      assert.equal(raw.includes(needle), false, `raw_memories.md 不应包含人设文本：${needle}`);
      assert.equal(summary.includes(needle), false, `memory_summary.md 不应包含人设文本：${needle}`);
    }
    await store.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('注入快照说明人设留在记忆之外', () => {
  const snap = buildSnapshot({
    globalSummary: '',
    workspaceSummary: '# 我记住的用户\n\n- 用户偏好先给结论。',
    entries: [{
      id: 'mem-00000001',
      createdAt: '2026-11-05T23:10:00+08:00',
      tags: ['偏好'],
      source: 'test',
      summary: '偏好先给结论',
      importance: 1,
      content: '用户偏好先给结论，再给依据。',
    }],
    contextWindow: 128000,
    config: { privateWorkspace: 'C:/demo/workspace' },
  });
  assert.match(snap.text, /固定人设/);
  assert.match(snap.text, /不参与摘要压缩/);
  assert.equal(snap.text.includes('小满'), false);
});

test('插件源码不硬编码任何本机绝对路径', async () => {
  const libDir = path.join(root, 'lib');
  const files = await readdir(libDir, { withFileTypes: true });
  for (const entry of files) {
    if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
    const text = await readFile(path.join(libDir, entry.name), 'utf8');
    const matches = text.match(/[A-Za-z]:[\\/]{1,2}[A-Za-z0-9_.\-\\/]+/g) ?? [];
    assert.deepEqual(matches, [], `${entry.name} 不应包含硬编码路径：${matches.join(', ')}`);
  }
});
