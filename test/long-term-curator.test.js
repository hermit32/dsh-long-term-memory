import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { MemoryStore } from '../lib/store.js';
import { buildLongTermInput, CuratorService, hideLongTermCitations, isProfileCandidate, LONG_TERM_SYSTEM_PROMPT } from '../lib/curator.js';
import { makeTempDir, sequenceIds, fixedNow } from './helpers.js';

const WORKSPACE = 'C:\\demo\\workspace';

function makeSession(id, turns, base = 1_700_000_000_000) {
  const events = [];
  let seq = 1;
  for (let turn = 1; turn <= turns; turn += 1) {
    events.push({ type: 'turn/start', seq: seq++, time: base + turn * 1000, data: { turn } });
    events.push({
      type: 'user/message',
      seq: seq++,
      time: base + turn * 1000 + 1,
      data: { turn, content: [{ type: 'text', text: `第 ${turn} 轮：用户说他喜欢周末整理记忆。` }] },
    });
    events.push({
      type: 'assistant/message',
      seq: seq++,
      time: base + turn * 1000 + 2,
      data: { turn, message: { content: [{ type: 'text', text: '收到。' }] } },
    });
    events.push({ type: 'turn/end', seq: seq++, time: base + turn * 1000 + 3, data: { turn, reason: { kind: 'completed' } } });
  }
  return { header: { id, cwd: WORKSPACE, createdAt: base, delegationDepth: 0 }, events };
}

async function setup(t) {
  const dir = await makeTempDir(t);
  await mkdir(path.join(dir, 'Demo'), { recursive: true });
  const store = new MemoryStore({
    memoryDir: path.join(dir, 'memories'),
    idFactory: sequenceIds(),
    now: fixedNow(),
  });
  await store.init();
  return { dir, store };
}

test('长期合成只喂人物候选，并隐藏正文里的记忆编号', () => {
  const environment = {
    id: 'mem-11111111',
    summary: '本机没有 pwsh，脚本要用 powershell.exe',
    content: '这是工作区运行环境说明，属于工具链细节。',
    tags: ['环境', 'PowerShell', '工具链'],
  };
  const preference = {
    id: 'mem-22222222',
    summary: '用户喜欢慢一点的钢琴曲',
    content: '用户偏好慢、留白、钢琴为主的音乐。',
    tags: ['偏好', '音乐'],
  };
  assert.equal(isProfileCandidate(environment), false);
  assert.equal(isProfileCandidate(preference), true);

  const input = buildLongTermInput({
    currentSummary: '# 长期记忆\n\n## 工作区与运行环境\n- 本机没有 pwsh\n\n## 偏好\n- 旧偏好',
    changedEntries: [environment, preference],
    allEntries: [environment, preference],
    deletedEntries: [],
    forgotten: [],
  });
  assert.equal(input.changed, 1);
  assert.equal(input.catalog, 1);
  const visible = input.text.replace(/<!--[\s\S]*?-->/g, '');
  assert.equal(visible.includes('pwsh'), false);
  assert.equal(visible.includes('mem-'), false);
  assert.match(visible, /慢一点的钢琴曲/);

  const hidden = hideLongTermCitations('- 用户喜欢钢琴曲 [mem-22222222]');
  assert.match(hidden, /<!-- \[mem-22222222\] -->/);
  assert.equal(hidden.includes('[mem-22222222] -->'), true);
  assert.equal(hideLongTermCitations(hidden), hidden);

  const multi = hideLongTermCitations('- 对方喜欢茶 [mem-11111111] [mem-22222222]');
  assert.equal((multi.match(/<!--/g) ?? []).length, 1, '多个相邻引用应合并成一个注释，不能嵌套');
  assert.equal((multi.match(/-->/g) ?? []).length, 1);
  assert.equal(multi.includes('[mem-11111111] [mem-22222222]'), true);
  assert.equal(hideLongTermCitations(multi), multi);
});

test('引用格式化只动行末引用组：锁定块、行内注释、字面编号都保持原样', () => {
  // 锁定块内容必须逐字保留，否则逐字校验会失败。
  const locked = [
    '<!-- feiyu-lock:start id="lk-12345678" -->',
    '- 用户喜欢茶。 [mem-22222222]',
    '<!-- feiyu-lock:end -->',
  ].join('\n');
  assert.equal(hideLongTermCitations(locked), locked);

  // 行内自由文本注释不能被拆成可见正文。
  const freeComment = '- 用户喜欢茶。 <!-- 这是我写的备注 --> [mem-22222222]';
  assert.equal(hideLongTermCitations(freeComment), freeComment);

  // 正文里字面引用的编号不能被当成真引用挪走。
  const quoted = '- 对方说原话是 "[mem-22222222]" 这样。';
  assert.equal(hideLongTermCitations(quoted), quoted);

  // 已经是规范写法的行保持原样（幂等）。
  const already = '- 用户喜欢茶。 <!-- [mem-22222222] -->';
  assert.equal(hideLongTermCitations(already), already);

  // 行末引用 + 已有纯引用注释：合并进同一个注释，不产生嵌套。
  const merged = hideLongTermCitations('- 用户喜欢茶。 <!-- [mem-11111111] --> [mem-22222222]');
  assert.equal(merged, '- 用户喜欢茶。 <!-- [mem-11111111] [mem-22222222] -->');
  assert.equal((merged.match(/<!--/g) ?? []).length, 1);
  assert.equal((merged.match(/-->/g) ?? []).length, 1);

  // 普通行不受影响。
  assert.equal(hideLongTermCitations('## 对方是谁'), '## 对方是谁');
});

test('长期提示词包含 11-20 版的人物档案标题与偏好分区', () => {
  assert.match(LONG_TERM_SYSTEM_PROMPT, /我记住的用户/);
  assert.match(LONG_TERM_SYSTEM_PROMPT, /长期关注的领域/);
  assert.match(LONG_TERM_SYSTEM_PROMPT, /不要写工具参数或源码细节/);
});

test('首次启用默认只建立新游标，不回填历史对话', async (t) => {
  const { dir, store } = await setup(t);
  const sessions = [1, 2, 3, 4, 5].map((index) => makeSession(`session-${index}`, 3));
  const sessionQuery = {
    async listSessions() { return sessions.map((item) => ({ header: item.header })); },
    async readSession(id) { return sessions.find((item) => item.header.id === id); },
  };
  let calls = 0;
  const curator = new CuratorService({
    store,
    sessionQuery,
    llm: { generate: async () => { calls += 1; return '{"operations":[],"needsConfirmation":[]}'; } },
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: WORKSPACE,
    config: { curatorEnabled: true, curatorBackfill: false, longTermMode: 'off' },
  });
  await curator.init();
  const first = await curator.runOnce('first-enable');
  assert.equal(first.ok, true);
  assert.equal(first.pendingTurns, 0);
  assert.equal(calls, 0);
  assert.equal(curator.state.baselineDone, true);
  assert.equal(curator.state.baselineMode, 'new-only');
  assert.equal(Object.keys(curator.state.cursors).length, 5);

  sessions.push(makeSession('session-new', 1));
  const second = await curator.runOnce('after-new-session');
  assert.equal(second.ok, true);
  assert.equal(second.pendingTurns, 1);
  assert.equal(calls, 1);
  assert.equal(curator.state.cursors['session-new'].lastTurn, 1);
  assert.equal(curator.state.cursors['session-1'].lastTurn, 3);
  assert.equal((await store.listActive()).length, 0);
});

test('首次启用不会因为已有短期记忆立刻回填长期摘要', async (t) => {
  const { store } = await setup(t);
  await store.add({ content: '启用前就存在的短期事实。', summary: '启用前事实', tags: '历史' });
  let calls = 0;
  const curator = new CuratorService({
    store,
    sessionQuery: { async listSessions() { return []; }, async readSession() { throw new Error('no sessions'); } },
    llm: { async generate() { calls += 1; return '# 长期记忆\n\n- 新事实。[mem-00000002]'; } },
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: WORKSPACE,
    config: {
      curatorEnabled: true,
      curatorBackfill: false,
      longTermMode: 'apply',
      autoSummary: true,
      scopeMaxBytes: 12000,
      scopeMaxTokens: 4000,
    },
  });
  await curator.init();
  const first = await curator.runOnce('enable');
  assert.equal(first.ok, true);
  assert.equal(calls, 0);
  assert.equal(await store.readSummary(), '');
  assert.equal(curator.state.longTerm.baseline, true);

  await store.add({ content: '启用后新增的事实。', summary: '启用后事实', tags: '新' });
  const second = await curator.runOnce('first-new-fact');
  assert.equal(second.ok, true);
  assert.equal(calls, 1);
  assert.match(await store.readSummary(), /新事实/);
});

test('Curator 第二阶段把模型 Markdown 写成长期记忆版本', async (t) => {
  const { store } = await setup(t);
  const entry = await store.add({
    content: '用户偏好茶，尤其是乌龙茶。',
    summary: '用户偏好乌龙茶',
    tags: '偏好',
  });
  assert.equal(entry.id, 'mem-00000001');
  let longTermCalls = 0;
  const curator = new CuratorService({
    store,
    sessionQuery: {
      async listSessions() { return []; },
      async readSession() { throw new Error('no sessions'); },
    },
    llm: {
      async generate({ system }) {
        if (String(system).includes('长期记忆策展人')) {
          longTermCalls += 1;
          return [
            '# 长期记忆',
            '',
            '## 偏好与边界',
            '- 用户偏好乌龙茶，日常饮茶以乌龙为主。[mem-00000001]',
          ].join('\n');
        }
        return '{"operations":[],"needsConfirmation":[]}';
      },
    },
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: WORKSPACE,
    config: {
      curatorEnabled: true,
      curatorBackfill: true,
      longTermMode: 'apply',
      autoSummary: true,
      scopeMaxBytes: 12000,
      scopeMaxTokens: 4000,
    },
  });
  await curator.init();
  const result = await curator.runOnce('synthesis-test');
  assert.equal(result.ok, true);
  assert.equal(longTermCalls, 1);
  const summary = await store.readSummary();
  assert.match(summary, /用户偏好乌龙茶/);
  assert.match(summary, /mem-00000001/);
  assert.equal(summary.includes('自动汇编'), false);
  const meta = await store.summaryMeta();
  assert.equal(meta.mode, 'auto');
  assert.ok(meta.hash.length === 64);
  assert.ok(curator.state.longTerm.sourceHash.length === 64);
  assert.equal(curator.state.longTerm.summaryHash, meta.hash);

  delete curator.state.longTerm.profileVersion;
  const migrated = await curator.runOnce('profile-migration');
  assert.equal(migrated.ok, true);
  assert.ok(longTermCalls >= 2, '人物档案版本变化应强制重写，即使短期 sourceHash 未变');
  assert.equal(curator.state.longTerm.profileVersion, 2);
});

test('长期合成拒绝缺失锁定块和已删除引用，保留旧摘要', async (t) => {
  const { store } = await setup(t);
  await store.add({ content: '用户偏好茶。', summary: '偏好茶', tags: '偏好' });
  await store.writeSummary([
    '# 长期记忆',
    '<!-- feiyu-lock:start id="lk-33333333" -->',
    '- 用户偏好茶。[mem-00000001]',
    '<!-- feiyu-lock:end -->',
  ].join('\n'), { mode: 'auto' });
  const before = await store.readSummary();
  const curator = new CuratorService({
    store,
    sessionQuery: { async listSessions() { return []; }, async readSession() { throw new Error('no sessions'); } },
    llm: { async generate() { return '# 长期记忆\n- 没有锁定块的新版本。[mem-00000001]'; } },
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: WORKSPACE,
    config: {
      curatorEnabled: true,
      curatorBackfill: true,
      longTermMode: 'apply',
      autoSummary: true,
      scopeMaxBytes: 12000,
      scopeMaxTokens: 4000,
    },
  });
  await curator.init();
  const result = await curator.runOnce('lock-reject');
  assert.equal(result.ok, true);
  assert.equal(result.longTermError.includes('锁定块'), true);
  assert.equal(await store.readSummary(), before);
});

async function setupForgottenCase(t) {
  const { store } = await setup(t);
  const deleted = await store.add({ content: '用户偏好茶。', summary: '偏好茶', tags: '偏好' });
  const active = await store.add({ content: '用户偏好乌龙茶。', summary: '偏好乌龙茶', tags: '偏好' });
  const deletedLine = `- 用户偏好茶。[${deleted.id}]`;
  await store.writeSummary(`# 长期记忆\n\n## 偏好\n${deletedLine}`, { mode: 'auto' });
  await store.forgetLongTermBlock({ text: deletedLine, reason: '测试删除长期内容' });
  await store.forget(deleted.id, '测试删除短期内容');
  await store.scrubLongTermForDeleted([deleted]);
  return { store, deleted, active, deletedLine };
}

test('长期合成提示词不携带已删除原文，清洗后能正常更新', async (t) => {
  const { store, deleted, active, deletedLine } = await setupForgottenCase(t);
  let captured = '';
  const curator = new CuratorService({
    store,
    sessionQuery: { async listSessions() { return []; }, async readSession() { throw new Error('no sessions'); } },
    llm: {
      async generate({ system, text }) {
        if (!String(system).includes('长期记忆策展人')) return '{"operations":[],"needsConfirmation":[]}';
        captured = String(text);
        return `# 长期记忆\n\n## 偏好\n- 用户偏好乌龙茶。[${active.id}]`;
      },
    },
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: WORKSPACE,
    config: {
      curatorEnabled: true,
      curatorBackfill: true,
      longTermMode: 'apply',
      autoSummary: true,
      scopeMaxBytes: 12000,
      scopeMaxTokens: 4000,
    },
  });
  await curator.init();
  const result = await curator.runOnce('forgotten-redacted');
  assert.equal(result.ok, true);
  assert.equal(captured.includes('用户偏好茶'), false, '提示词不能携带已删除原文');
  assert.equal(captured.includes(deleted.id), false, '提示词不能携带已删除条目 ID');
  assert.equal(captured.includes(deletedLine), false);
  assert.equal(result.longTermError, undefined);
  assert.match(await store.readSummary(), new RegExp(active.id));
  assert.ok(curator.state.longTerm.synthesizedAt);
  assert.equal(curator.state.longTerm.lastError, '');
});

test('删除保护仍会拒绝模型复读已删除内容，不降级为静默写入', async (t) => {
  const { store, deletedLine } = await setupForgottenCase(t);
  const before = await store.readSummary();
  const curator = new CuratorService({
    store,
    sessionQuery: { async listSessions() { return []; }, async readSession() { throw new Error('no sessions'); } },
    llm: {
      async generate({ system }) {
        if (String(system).includes('长期记忆策展人')) {
          return `# 长期记忆\n\n## 偏好\n${deletedLine}`;
        }
        return '{"operations":[],"needsConfirmation":[]}';
      },
    },
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: WORKSPACE,
    config: {
      curatorEnabled: true,
      curatorBackfill: true,
      longTermMode: 'apply',
      autoSummary: true,
      scopeMaxBytes: 12000,
      scopeMaxTokens: 4000,
    },
  });
  await curator.init();
  const result = await curator.runOnce('forgotten-malicious');
  assert.equal(result.ok, true);
  assert.match(result.longTermError, /已删除|重新引入|不存在的活动短期记忆/);
  assert.equal(await store.readSummary(), before);
  assert.equal(curator.state.longTerm.synthesizedAt, null);
});
