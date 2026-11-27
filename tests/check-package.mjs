/**
 * 依赖完整性检查：确认包清单、导出、源码内部引用、第三方依赖声明都对得上。
 * 不联网，只做静态检查。
 *
 * 用法：node tests/check-package.mjs
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(import.meta.dirname, '..');
const problems = [];
const notes = [];

const exists = async (target) => {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
};

const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));

// 1. files[] 里的条目必须真实存在
for (const entry of pkg.files ?? []) {
  if (!(await exists(path.join(root, entry)))) problems.push(`package.json files[] 缺文件：${entry}`);
}

// 2. exports 目标必须存在
for (const [key, value] of Object.entries(pkg.exports ?? {})) {
  if (typeof value !== 'string' || value.includes('*')) continue;
  if (!(await exists(path.join(root, value)))) problems.push(`exports["${key}"] 指向不存在的文件：${value}`);
}

// 3. dsh.bundle.patch 必须存在
const patch = pkg.dsh?.bundle?.patch;
if (!patch) problems.push('package.json 缺少 dsh.bundle.patch');
else if (!(await exists(path.join(root, patch)))) problems.push(`bundle patch 不存在：${patch}`);

// 4. lib 里所有相对 import 必须存在；裸 import 必须在 dependencies 里声明
const bare = new Set();
const files = [];
const walk = async (dir) => {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.isFile() && entry.name.endsWith('.js')) files.push(full);
  }
};
await walk(path.join(root, 'lib'));
for (const file of files) {
  const text = await fs.readFile(file, 'utf8');
  for (const match of text.matchAll(/(?:^|\n)\s*(?:import|export)[^\n]*?from\s+['"]([^'"]+)['"]/g)) {
    const spec = match[1];
    if (spec.startsWith('.')) {
      const target = path.resolve(path.dirname(file), spec);
      if (!(await exists(target))) problems.push(`${path.relative(root, file)} 引用了不存在的相对模块：${spec}`);
    } else if (!spec.startsWith('node:')) {
      bare.add(spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/'));
    }
  }
  for (const match of text.matchAll(/import\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('node:')) bare.add(spec.split('/').slice(0, spec.startsWith('@') ? 2 : 1).join('/'));
  }
}
const declared = new Set(Object.keys(pkg.dependencies ?? {}));
for (const name of bare) {
  if (!declared.has(name)) problems.push(`源码使用了未在 dependencies 声明的包：${name}`);
  else notes.push(`ok 依赖声明：${name}`);
}
for (const name of declared) {
  if (!bare.has(name)) notes.push(`dependency 未被源码直接 import（可能是运行时/宿主提供）：${name}`);
}

// 5. 仓库里不该出现 node_modules 或记忆数据
if (await exists(path.join(root, 'node_modules'))) notes.push('本地存在 node_modules（已 gitignore，打包前应剔除）');

// 6. 许可证与文档齐全
for (const file of ['README.md', 'LICENSE', 'CHANGELOG.md', 'ARCHITECTURE.md', 'INSTALL.md', 'THIRD_PARTY_NOTICES.md']) {
  if (!(await exists(path.join(root, file)))) problems.push(`缺少发布文档：${file}`);
}

console.log(notes.join('\n'));
if (problems.length > 0) {
  console.error('\n发现问题：');
  for (const item of problems) console.error(`  - ${item}`);
  process.exit(1);
}
console.log('\n依赖完整性检查通过。');
