import test from 'node:test';
import assert from 'node:assert/strict';
import { isWorkspacePath, isWorkspaceAgent, normalizeConfig } from '../lib/config.js';

test('只匹配私人工作区根目录及其子目录', () => {
  const root = 'C:\\PrivateWorkspace';
  assert.equal(isWorkspacePath('C:\\PrivateWorkspace', root), true);
  assert.equal(isWorkspacePath('C:\\PrivateWorkspace\\', root), true);
  assert.equal(isWorkspacePath('C:\\PrivateWorkspace\\sub\\dir', root), true);
  assert.equal(isWorkspacePath('c:\\privateworkspace\\SUB', root), true);
  assert.equal(isWorkspacePath('C:\\PrivateWorkspace2', root), false);
  assert.equal(isWorkspacePath('C:\\PrivateWorkspace备份', root), false);
  assert.equal(isWorkspacePath('X:\\其他工作区', root), false);
  assert.equal(isWorkspacePath('C:\\Other', root), false);
  assert.equal(isWorkspacePath(undefined, root), false);
});

test('伪造相似路径不能绕过隔离', () => {
  const root = 'C:\\PrivateWorkspace';
  assert.equal(isWorkspacePath('C:\\PrivateWorkspace\\..\\其他', root), false);
  assert.equal(isWorkspacePath('C:\\PrivateWorkspace\\sub\\..\\..\\其他', root), false);
  assert.equal(isWorkspacePath('C:\\PrivateWorkspace\\..\\大肥鱼2', root), false);
});

test('isWorkspaceAgent 读取会话 cwd', () => {
  const agent = { session: { header: { cwd: 'C:\\PrivateWorkspace\\src' } } };
  assert.equal(isWorkspaceAgent(agent, 'C:\\PrivateWorkspace'), true);
  assert.equal(isWorkspaceAgent({ session: { header: { cwd: 'X:\\别处' } } }, 'C:\\PrivateWorkspace'), false);
  assert.equal(isWorkspaceAgent(undefined, 'C:\\PrivateWorkspace'), false);
});

test('配置校验要求绝对路径', () => {
  assert.throws(() => normalizeConfig({
    privateWorkspace: 'relative/path',
    memoryDir: 'C:/PrivateWorkspace/.dsh/memories-feiyu',
  }), /绝对路径/);
  assert.throws(() => normalizeConfig({
    privateWorkspace: 'C:/PrivateWorkspace',
    memoryDir: 'relative/path',
  }), /绝对路径/);
});
