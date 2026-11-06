import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

// 人设样例放在仓库的 plugins/persona/（公开版路径已替换为示例值）。
// 真实部署时这两个文件位于私人工作区根目录；缺失时相关用例跳过。
const personaDir = path.resolve(import.meta.dirname, '..', '..', 'persona');
const agentsPath = path.join(personaDir, 'AGENTS.md');
const personaPath = path.join(personaDir, '大肥鱼人设.md');
const memorySummaryPath = path.resolve(
  import.meta.dirname, '..', '..', '..', '.dsh', 'memories-feiyu', 'memory_summary.md',
);

test('AGENTS.md 是工作区级固定人设，不是全局配置', async (t) => {
  if (!existsSync(agentsPath)) {
    t.skip('未找到 plugins/persona/AGENTS.md');
    return;
  }
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

test('大肥鱼人设.md 覆盖完整外观、性格和一致性要求', async (t) => {
  if (!existsSync(personaPath)) {
    t.skip('未找到 plugins/persona/大肥鱼人设.md');
    return;
  }
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

test('固定人设没有被写进长期记忆摘要', async (t) => {
  if (!existsSync(memorySummaryPath)) {
    t.skip('没有本地记忆库，跳过');
    return;
  }
  const text = await readFile(memorySummaryPath, 'utf8');
  assert.equal(text.includes('大肥鱼人设档案'), false);
  assert.equal(text.includes('鲸鱼娘拟人化女仆'), false);
});

test('人设文件位于工作区根目录（公开版为 plugins/persona/）', async () => {
  assert.equal(path.dirname(agentsPath), personaDir);
  assert.equal(path.dirname(personaPath), personaDir);
});
