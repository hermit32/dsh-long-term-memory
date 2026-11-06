import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const FIXED_DATE = new Date('2026-11-05T15:10:00.000Z');

/** 创建独立临时目录，测试结束后删除。 */
export async function makeTempDir(t, prefix = 'feiyu-test-') {
  const dir = await mkdtemp(path.join(os.tmpdir(), prefix));
  t.after(async () => {
    await rm(dir, { recursive: true, force: true, maxRetries: 3 });
  });
  return dir;
}

/** 生成从 mem-00000001 开始的稳定 ID。 */
export function sequenceIds() {
  let next = 0;
  return () => {
    next += 1;
    return `mem-${String(next).padStart(8, '0')}`;
  };
}

/** 测试用固定时钟，每次返回同一时间（可加分钟偏移）。 */
export function fixedNow(minutes = 0) {
  return () => new Date(FIXED_DATE.getTime() + minutes * 60_000);
}

export function sampleEntry(index, overrides = {}) {
  return {
    content: `第 ${index} 条测试记忆：主人在 2026-11-05 讨论了记忆系统的第 ${index} 个细节。`,
    tags: ['测试', `批次${index}`],
    summary: `第 ${index} 条测试记忆概述`,
    source: 'test',
    context: `case=${index}`,
    importance: index % 4,
    ...overrides,
  };
}
