/** v2.0 测试共用的假 Host 上下文（工具 + 路由 + 事件 + 会话）。 */
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { apply } from '../lib/index.js';
import { makeTempDir, fixedNow } from './helpers.js';

export function fakeContext(options = {}) {
  const tools = new Map();
  const routes = new Map();
  const handlers = new Map();
  const liveAgents = [];
  const connection = Object.prototype.hasOwnProperty.call(options, 'connection')
    ? options.connection
    : { admit: () => ({ peer: { principal: { kind: 'owner' } } }) };
  const ctx = {
    logger: { warn: () => {} },
    tools: {
      register(definition, toolOptions = {}) {
        tools.set(definition.name, { definition, options: toolOptions });
        return () => tools.delete(definition.name);
      },
    },
    on(event, handler) {
      handlers.set(event, handler);
      return () => handlers.delete(event);
    },
    effect(factory) {
      return factory();
    },
    get(name) {
      if (name === 'llm') return undefined;
      if (name === 'agents') {
        return {
          list: () => liveAgents,
          roots: () => liveAgents,
          get: (id) => liveAgents.find((agent) => agent.session?.id === id),
        };
      }
      if (name === 'connection') return connection;
      return undefined;
    },
    inject(deps, callback) {
      if (deps.includes('tools')) callback(ctx);
      if (deps.includes('webServer')) {
        callback({
          webServer: {
            register(route) {
              routes.set(route.path, route);
              return () => routes.delete(route.path);
            },
          },
          effect(factory) { return factory(); },
        });
      }
      if (deps.includes('settings')) callback({ effect: (factory) => factory(), settings: { configure: () => {} } });
    },
  };
  return { ctx, tools, routes, handlers, liveAgents };
}

export function fakeAgent({ cwd, id = 'session-1', events = [] }) {
  const injected = [];
  const messages = [];
  const agent = {
    session: {
      id,
      header: { cwd },
      deriveMessages: () => messages,
      snapshotEvents: () => events,
    },
    model: { current: () => undefined },
    inbox: null,
    inject(message) {
      injected.push(message);
      messages.push(message);
    },
  };
  return { agent, injected, messages, events };
}

export async function setupPlugin(t, overrides = {}) {
  const dir = await makeTempDir(t);
  const workspace = path.join(dir, 'Demo');
  await mkdir(workspace, { recursive: true });
  const fake = fakeContext(overrides.context);
  await apply(fake.ctx, {
    privateWorkspace: workspace,
    memoryDir: path.join(dir, 'memories'),
    globalMemoryDir: path.join(dir, 'global'),
    autoSummary: true,
    curatorEnabled: false,
    dreamingEnabled: false,
    ...(overrides.config ?? {}),
  });
  return { dir, workspace, ...fake };
}

export async function callTool(tools, name, args, agent) {
  const tool = tools.get(name);
  if (!tool) throw new Error(`没有工具 ${name}`);
  return tool.definition.execute(args ?? {}, { agent });
}

export function fakeRequest(body, options = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body ?? {});
  const buffer = Buffer.from(text, 'utf8');
  return {
    method: options.method ?? 'POST',
    socket: { remoteAddress: options.ip ?? '127.0.0.1' },
    headers: {
      'x-dsh-memory-client': 'dsh-memory-feiyu/1',
      'content-type': 'application/json',
      ...(options.headers ?? {}),
    },
    async *[Symbol.asyncIterator]() {
      yield buffer;
    },
  };
}

export function fakeResponse() {
  const state = { status: 0, body: '' };
  return {
    state,
    destroyed: false,
    writableEnded: false,
    writeHead(status) { state.status = status; },
    end(body) { state.body = body ?? ''; this.writableEnded = true; },
  };
}

export async function hitRoute(routes, name, body, options) {
  const route = routes.get(`/api/dsh-memory-feiyu/${name}`);
  if (!route) throw new Error(`缺少路由 ${name}`);
  const response = fakeResponse();
  await route.handler(fakeRequest(body, options), response);
  return { status: response.state.status, body: response.state.body ? JSON.parse(response.state.body) : null };
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitFor(fn, timeout = 4000, interval = 25) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const value = await fn();
    if (value) return value;
    await sleep(interval);
  }
  return null;
}

export { fixedNow };
