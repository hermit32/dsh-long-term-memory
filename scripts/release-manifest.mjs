#!/usr/bin/env node
// release-manifest.mjs — 生成 / 校验 RELEASE_MANIFEST.json。
//
// 用法（在仓库根目录）：
//   node scripts/release-manifest.mjs            # 重新生成清单
//   node scripts/release-manifest.mjs --verify   # 只校验，不一致时 exit 1
//
// 清单覆盖"发布相关"的文本文件：根目录文档、docs/、plugins/feiyu-memory/、
// plugins/persona/、tests/。二进制资源、node_modules、真实记忆库目录一律跳过。
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = path.join(ROOT, 'RELEASE_MANIFEST.json');

const INCLUDED = [
  'README.md',
  'INSTALL.md',
  'INSTALL_FOR_DSH.md',
  'ARCHITECTURE.md',
  'STATUS.md',
  'LICENSING_1_3.md',
  'THIRD_PARTY_NOTICES.md',
  'LICENSE.md',
  'docs',
  'plugins/feiyu-memory',
  'plugins/persona',
  'tests',
  'scripts/release-manifest.mjs',
];

const SKIP_DIRS = new Set(['node_modules', '.git', '.dsh', 'summary_history', 'archive', 'corrupt']);
const SKIP_FILES = new Set(['RELEASE_MANIFEST.json', '.DS_Store', 'Thumbs.db']);
const SKIP_EXT = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp',
  '.zip', '.7z', '.gz', '.tgz', '.tar', '.woff', '.woff2', '.ttf', '.otf',
]);

async function walk(target, out) {
  let stat;
  try {
    stat = await fs.stat(target);
  } catch {
    return; // 可选路径缺失时静默跳过
  }
  if (stat.isFile()) {
    const name = path.basename(target);
    if (SKIP_FILES.has(name)) return;
    if (SKIP_EXT.has(path.extname(target).toLowerCase())) return;
    out.push(target);
    return;
  }
  if (!stat.isDirectory()) return;
  if (SKIP_DIRS.has(path.basename(target))) return;
  const entries = await fs.readdir(target, { withFileTypes: true });
  entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const entry of entries) await walk(path.join(target, entry.name), out);
}

// 哈希按"统一 LF"的内容计算：Windows 上 core.autocrlf=true 的检出、
// 以及 GitHub 上的 LF 内容，得到同一份摘要，避免因换行符误报不一致。
function normalizeLineEndings(buffer) {
  const text = buffer.toString('utf8');
  return Buffer.from(text.replace(/\r\n/g, '\n'), 'utf8');
}

async function buildEntries() {
  const files = [];
  for (const item of INCLUDED) await walk(path.join(ROOT, item), files);
  const unique = [...new Set(files)].sort((a, b) =>
    a.localeCompare(b, 'en', { sensitivity: 'case' }),
  );
  const entries = [];
  for (const file of unique) {
    const bytes = normalizeLineEndings(await fs.readFile(file));
    entries.push({
      path: path.relative(ROOT, file).split(path.sep).join('/'),
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
  }
  return entries;
}

function manifestFor(entries) {
  return {
    name: 'Feiyu Memory 1.3.0 public release',
    source: 'repository tree',
    generatedBy: 'scripts/release-manifest.mjs',
    note: '清单覆盖发布相关文本文件；改动这些文件后请重新生成，并用 --verify 校验。',
    files: entries,
  };
}

async function main() {
  const verifyOnly = process.argv.includes('--verify');
  const entries = await buildEntries();

  if (verifyOnly) {
    let current;
    try {
      current = JSON.parse(await fs.readFile(MANIFEST, 'utf8'));
    } catch (error) {
      console.error(`[manifest] cannot read ${path.relative(ROOT, MANIFEST)}: ${error.message}`);
      process.exit(1);
    }
    const expected = new Map((current.files ?? []).map((item) => [item.path, item]));
    const problems = [];
    for (const entry of entries) {
      const known = expected.get(entry.path);
      if (!known) problems.push(`missing  ${entry.path}`);
      else if (known.bytes !== entry.bytes || known.sha256 !== entry.sha256) {
        problems.push(`changed  ${entry.path}`);
      }
      expected.delete(entry.path);
    }
    for (const gone of expected.keys()) problems.push(`extra    ${gone}`);
    if (problems.length > 0) {
      console.error(`[manifest] FAILED: ${problems.length} mismatch(es)`);
      for (const line of problems.slice(0, 40)) console.error(`  ${line}`);
      process.exit(1);
    }
    console.log(`[manifest] OK: ${entries.length} files match`);
    return;
  }

  const manifest = manifestFor(entries);
  await fs.writeFile(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  console.log(`[manifest] wrote ${entries.length} entries to ${path.relative(ROOT, MANIFEST)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
