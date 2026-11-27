/**
 * 把 DSH 运行时自带的依赖链接进本仓库的 node_modules，让 `node --test` 可以离线跑。
 *
 * 背景：插件唯一的运行时依赖 @deepseek-ai/schemastery 由 DeepSeek Harness 安装包提供，
 * 不一定能从公共 npm 源安装。因此从一份已安装的 DSH 里借用这些包。
 *
 * 用法：
 *   node scripts/link-runtime-deps.mjs --from "C:\path\to\dsh\node_modules"
 *   node scripts/link-runtime-deps.mjs            # 自动探测常见安装位置
 *   DSH_RUNTIME="C:\path\to\dsh" node scripts/link-runtime-deps.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const WANTED = [
  '@deepseek-ai/schemastery',
  '@deepseek-ai/cosmokit',
  '@standard-schema/spec',
];

const repoRoot = path.resolve(import.meta.dirname, '..');

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : '';
}

async function exists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

/** 在候选根目录里找 node_modules 下是否真的有 schemastery。 */
async function findNodeModules(candidate) {
  const roots = [candidate, path.join(candidate, 'node_modules')];
  for (const root of roots) {
    if (await exists(path.join(root, '@deepseek-ai', 'schemastery', 'package.json'))) return root;
  }
  // pnpm 布局：node_modules/.pnpm/@deepseek-ai+schemastery@x/node_modules
  const pnpmDir = path.join(candidate, 'node_modules', '.pnpm');
  if (await exists(pnpmDir)) {
    for (const entry of await fs.readdir(pnpmDir)) {
      if (!entry.startsWith('@deepseek-ai+schemastery@')) continue;
      const root = path.join(pnpmDir, entry, 'node_modules');
      if (await exists(path.join(root, '@deepseek-ai', 'schemastery', 'package.json'))) return root;
    }
  }
  return '';
}

async function candidates() {
  const list = [];
  const fromArg = arg('--from') || process.env.DSH_RUNTIME || '';
  if (fromArg) list.push(fromArg);
  const localAppData = process.env.LOCALAPPDATA ?? '';
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  list.push(
    path.join(programFiles, 'DeepSeek Harness', 'resources', 'app.asar.unpacked', 'node_modules'),
    path.join(programFiles, 'DeepSeek Harness', 'resources', 'app', 'node_modules'),
    localAppData && path.join(localAppData, 'Programs', 'deepseek-harness', 'resources', 'app.asar.unpacked', 'node_modules'),
    path.join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'desktop', 'node_modules'),
    path.join(process.cwd(), 'node_modules'),
  );
  return list.filter(Boolean);
}

let sourceRoot = '';
for (const candidate of await candidates()) {
  sourceRoot = await findNodeModules(candidate);
  if (sourceRoot) {
    console.log(`[link-runtime-deps] 使用依赖源：${sourceRoot}`);
    break;
  }
}
if (!sourceRoot) {
  console.error('[link-runtime-deps] 没找到 DSH 的 node_modules。请用 --from 指定一个包含 @deepseek-ai/schemastery 的目录。');
  process.exit(1);
}

const targetRoot = path.join(repoRoot, 'node_modules');
await fs.mkdir(targetRoot, { recursive: true });
const force = process.argv.includes('--force');

/** 真实路径比较：Windows 大小写不敏感。 */
const realPath = async (target) => {
  try {
    return await fs.realpath(target);
  } catch {
    return path.resolve(target);
  }
};
const samePath = (a, b) => (process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b);
const inside = (child, parent) => {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
};

for (const name of WANTED) {
  const source = path.join(sourceRoot, name);
  if (!(await exists(source))) {
    console.warn(`[link-runtime-deps] 跳过（源目录没有）：${name}`);
    continue;
  }
  const target = path.join(targetRoot, name);

  // 安全闸门：绝不动到依赖源自身。
  // 场景：有人把 --from 指向本仓库的 node_modules（或 DSH 的 node_modules 正好就是本仓库），
  // 无脑 `rm -rf target` 会把刚找到的依赖删掉，后面的 symlink 也必然失败。
  const sourceReal = await realPath(source);
  const targetParentReal = await realPath(targetRoot);
  if (samePath(sourceReal, path.resolve(target)) || inside(sourceReal, targetParentReal)) {
    console.log(`[link-runtime-deps] 跳过（依赖源就是本仓库的 node_modules，无需链接）：${name}`);
    continue;
  }

  // 已有真实目录（比如用户自己 npm install 过）默认不动，避免误删别人的依赖树。
  const existing = await fs.lstat(target).catch(() => null);
  if (existing && !existing.isSymbolicLink() && !force) {
    console.log(`[link-runtime-deps] 保留已存在的真实目录（要重建请加 --force）：${name}`);
    continue;
  }

  await fs.rm(target, { recursive: true, force: true });
  await fs.mkdir(path.dirname(target), { recursive: true });
  try {
    await fs.symlink(sourceReal, target, 'junction');
  } catch {
    await fs.cp(sourceReal, target, { recursive: true, dereference: true });
  }
  console.log(`[link-runtime-deps] 链接 ${name} -> ${sourceReal}`);
}

console.log('[link-runtime-deps] 完成。现在可以运行：node --test');
