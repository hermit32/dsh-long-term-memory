import { MemoryStore } from '../lib/store.js';
import { buildSnapshot } from '../lib/injection.js';

const memoryDir = process.env.FEIYU_MEMORY_DIR;
const globalMemoryDir = process.env.FEIYU_GLOBAL_DIR;
const privateWorkspace = process.env.FEIYU_WORKSPACE;
if (!memoryDir || !privateWorkspace) throw new Error('missing FEIYU_MEMORY_DIR / FEIYU_WORKSPACE');

const store = new MemoryStore({ memoryDir, globalMemoryDir });
await store.init();
const snapshot = buildSnapshot({
  globalSummary: await store.readGlobalSummary(),
  workspaceSummary: await store.readSummary(),
  entries: await store.listActive(),
  contextWindow: 128000,
  config: { privateWorkspace },
});
process.stdout.write(JSON.stringify({ hash: snapshot.hash, text: snapshot.text }));
