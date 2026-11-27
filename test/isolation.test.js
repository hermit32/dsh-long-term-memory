import test from 'node:test';
import assert from 'node:assert/strict';
import { isWorkspacePath, isWorkspaceAgent, normalizeConfig } from '../lib/config.js';

test('只匹配私人工作区根目录及其子目录', () => {
  const root = 'C:\\demo\\workspace';
  assert.equal(isWorkspacePath('C:\\demo\\workspace', root), true);
  assert.equal(isWorkspacePath('C:\\demo\\workspace\\', root), true);
  assert.equal(isWorkspacePath('C:\\demo\\workspace\\sub\\dir', root), true);
  assert.equal(isWorkspacePath('c:\\DEMO\\WORKSPACE\\SUB', root), true);
  assert.equal(isWorkspacePath('C:\\demo\\workspace2', root), false);
  assert.equal(isWorkspacePath('C:\\demo\\workspace备份', root), false);
  assert.equal(isWorkspacePath('X:\\其他工作区', root), false);
  assert.equal(isWorkspacePath('C:\\demo\\other', root), false);
  assert.equal(isWorkspacePath(undefined, root), false);
});

test('伪造相似路径不能绕过隔离', () => {
  const root = 'C:\\demo\\workspace';
  assert.equal(isWorkspacePath('C:\\demo\\workspace\\..\\其他', root), false);
  assert.equal(isWorkspacePath('C:\\demo\\workspace\\sub\\..\\..\\其他', root), false);
  assert.equal(isWorkspacePath('C:\\demo\\workspace\\..\\Demo2', root), false);
});

test('isWorkspaceAgent 读取会话 cwd', () => {
  const agent = { session: { header: { cwd: 'C:\\demo\\workspace\\src' } } };
  assert.equal(isWorkspaceAgent(agent, 'C:\\demo\\workspace'), true);
  assert.equal(isWorkspaceAgent({ session: { header: { cwd: 'X:\\别处' } } }, 'C:\\demo\\workspace'), false);
  assert.equal(isWorkspaceAgent(undefined, 'C:\\demo\\workspace'), false);
});

test('配置校验要求绝对路径', () => {
  assert.throws(() => normalizeConfig({
    privateWorkspace: 'relative/path',
    memoryDir: 'C:/demo/workspace/.dsh/memories-feiyu',
  }), /绝对路径/);
  assert.throws(() => normalizeConfig({
    privateWorkspace: 'C:/demo/workspace',
    memoryDir: 'relative/path',
  }), /绝对路径/);
});
