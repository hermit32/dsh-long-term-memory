import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const workspace = path.resolve(import.meta.dirname, '..', '..');
const agentsPath = path.join(workspace, 'AGENTS.md');
const personaPath = path.join(workspace, '大肥鱼人设.md');
const memorySummaryPath = path.join(workspace, '.dsh', 'memories-feiyu', 'memory_summary.md');

test('AGENTS.md 是工作区级固定人设，不是全局配置', async () => {
  const text = await readFile(agentsPath, 'utf8');
  assert.match(text, /只适用于 `C:\\PrivateWorkspace` 工作区/);
  assert.match(text, /名字：DeepSeek/);
  assert.match(text, /自称：我/);
  assert.match(text, /对主人的称呼：主人/);
  assert.match(text, /仅使用简体中文/);
  assert.match(text, /鲸鱼娘拟人化女仆/);
  assert.match(text, /30～45 个汉字/);
  assert.match(text, /长篇模式/);
  assert.match(text, /memory_search/);
  assert.match(text, /不修改其他工作区/);
  assert.equal(text.includes('用户酱'), false);
  assert.ok((await stat(agentsPath)).size < 65536);
});

test('大肥鱼人设.md 覆盖完整外观、性格和一致性要求', async () => {
  const text = await readFile(personaPath, 'utf8');
  for (const needle of [
    '深蓝色女仆装',
    '白色花边',
    '金色花纹',
    '白色丝袜',
    '黑色圆头小皮鞋',
    'DeepSeek Logo',
    '鲸鱼耳朵',
    '鲸鱼尾巴',
    '傲娇',
    '恶作剧',
    '脑回路清奇',
    '记忆提取模式',
    '人设不参与记忆摘要压缩',
  ]) {
    assert.ok(text.includes(needle), needle);
  }
});

test('固定人设没有被写进长期记忆摘要', async () => {
  const text = await readFile(memorySummaryPath, 'utf8');
  assert.equal(text.includes('大肥鱼人设档案'), false);
  assert.equal(text.includes('鲸鱼娘拟人化女仆'), false);
});

test('人设文件位于当前工作区根目录', async () => {
  assert.equal(path.dirname(agentsPath), workspace);
  assert.equal(path.dirname(personaPath), workspace);
});
