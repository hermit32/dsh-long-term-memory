import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { MemoryStore } from '../lib/store.js';
import { CuratorService } from '../lib/curator.js';
import { makeTempDir } from './helpers.js';

function makeSession(id, turns) {
  const events = [];
  let seq = 1;
  for (let turn = 1; turn <= turns; turn += 1) {
    events.push({ type: 'turn/start', seq: seq++, data: { turn } });
    events.push({ type: 'user/message', seq: seq++, data: { turn, content: [{ type: 'text', text: `turn ${turn}` }] } });
    events.push({ type: 'assistant/message', seq: seq++, data: { turn, message: { content: [{ type: 'text', text: 'ok' }] } } });
    events.push({ type: 'turn/end', seq: seq++, data: { turn, reason: { kind: 'completed' } } });
  }
  return { header: { id, cwd: 'C:\\acceptance', createdAt: 1, delegationDepth: 0 }, events };
}

test('early event 不能绕过 20 轮累计阈值', async (t) => {
  const dir = await makeTempDir(t);
  const store = new MemoryStore({ memoryDir: path.join(dir, 'memories') });
  await store.init();
  const sessions = [];
  const sessionQuery = {
    async listSessions() { return sessions.map((item) => ({ header: item.header })); },
    async readSession(id) { return sessions.find((item) => item.header.id === id); },
  };
  const curator = new CuratorService({
    store,
    sessionQuery,
    llm: { generate: async () => '{"operations":[],"needsConfirmation":[]}' },
    route: { provider: 'fake', model: 'fake' },
    privateWorkspace: 'C:\\acceptance',
    config: {
      curatorEnabled: true,
      curatorBackfill: false,
      longTermMode: 'off',
      curatorThresholdTurns: 20,
      curatorCooldownMs: 0,
    },
  });
  await curator.init();
  await curator.runOnce('baseline');
  let scheduled = 0;
  curator.schedule = () => { scheduled += 1; };

  sessions.push(makeSession('session-19', 19));
  const below = await curator.onEarlyEvent('new-root-session');
  assert.equal(below.triggered, false);
  assert.equal(below.pendingTurns, 19);
  assert.equal(scheduled, 0);

  sessions.splice(0, 1, makeSession('session-20', 20));
  const atThreshold = await curator.onEarlyEvent('new-root-session');
  assert.equal(atThreshold.triggered, true);
  assert.equal(atThreshold.pendingTurns, 20);
  assert.equal(scheduled, 1);
});
