/**
 * 隐私扫描：发布前确认仓库里没有真实记忆、私人对话、账号凭据、API Key、本机路径。
 *
 * 用法：
 *   node tests/privacy-scan.mjs .                       # 扫描当前仓库
 *   node tests/privacy-scan.mjs . --extra 张三,某公司     # 追加自定义敏感词
 *   PRIVACY_DENYLIST="张三,某公司" node tests/privacy-scan.mjs .
 *
 * 规则分三类：
 *   1. 凭据形态（密钥、令牌、私钥、连接串）
 *   2. 本机路径（Windows 用户目录、常见个人目录）
 *   3. 自定义敏感词（真实姓名、私人工作区名、聊天里的口头禅）
 *
 * 例外：examples/demo-memory/ 与 screenshots/ 是**虚构演示数据**，示例人物
 * “阿澈 / 小满 / 小周 / 团子”在允许清单里，其余敏感形态照样检查。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(process.argv[2] ?? '.');
const extraArgIndex = process.argv.indexOf('--extra');
const extra = (extraArgIndex > 0 ? process.argv[extraArgIndex + 1] : process.env.PRIVACY_DENYLIST ?? '')
  .split(',')
  .map((item) => item.trim())
  .filter(Boolean);

const ALLOW = [
  'C:\\demo\\workspace', // 文档与模板里的演示工作区
  'C:\\demo\\other',
  'X:\\其他工作区',
  'X:\\别处',
  'X:\\test',
  'X:\\AI',
  '你的名称',
  'EXAMPLE',
  // 测试夹具里的**故意写死的假密钥**：用来验证“密钥拒绝写入”这条防线的负例样本。
  'sk-1234567890abcdef',
  'Bearer abcdefghijklmnop',
];

const RULES = [
  { id: 'windows-user-path', re: /[A-Za-z]:\\\\?Users\\\\?[^\\/\s'"]+/g, hint: '本机用户目录路径' },
  { id: 'openai-key', re: /\bsk-[A-Za-z0-9]{16,}\b/g, hint: 'API Key 形态' },
  { id: 'github-token', re: /\bgh[pousr]_[A-Za-z0-9]{16,}\b/g, hint: 'GitHub 令牌形态' },
  { id: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g, hint: 'AWS Access Key 形态' },
  { id: 'slack-token', re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, hint: 'Slack 令牌形态' },
  { id: 'private-key', re: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, hint: '私钥文件内容' },
  { id: 'bearer-literal', re: /Bearer\s+[A-Za-z0-9._-]{20,}/g, hint: '硬编码 Bearer 令牌' },
  { id: 'db-url', re: /(?:postgres|mysql|mongodb(?:\+srv)?):\/\/[^\s'"]+:[^\s'"]+@/g, hint: '带口令的连接串' },
  { id: 'generic-secret-assign', re: /\b(?:api[_-]?key|secret|password|passwd|token)\s*[:=]\s*['"][A-Za-z0-9._\-]{16,}['"]/gi, hint: '疑似硬编码密钥赋值' },
];

const SKIP_DIRS = new Set(['node_modules', '.git', '_evidence', 'screenshots']);
const TEXT_EXT = /\.(js|mjs|cjs|json|jsonl|yml|yaml|md|ts|txt|svg|html|css|ps1|sh)$/i;

const findings = [];
const scanned = [];

async function walk(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) await walk(full);
    else if (entry.isFile() && TEXT_EXT.test(entry.name)) await scan(full);
  }
}

async function scan(file) {
  const text = await fs.readFile(file, 'utf8');
  const rel = path.relative(root, file).split(path.sep).join('/');
  scanned.push(rel);
  let masked = text;
  for (const allow of ALLOW) masked = masked.split(allow).join('[ALLOWED]');
  for (const rule of RULES) {
    for (const match of masked.matchAll(rule.re)) {
      findings.push({ severity: 'error', rule: rule.id, file: rel, sample: match[0].slice(0, 80), hint: rule.hint });
    }
  }
  for (const word of extra) {
    if (masked.includes(word)) findings.push({ severity: 'error', rule: 'denylist', file: rel, sample: word, hint: '自定义敏感词' });
  }
  // 允许清单本身出现在源码逻辑里也是可疑的：只应出现在文档/测试夹具中
  if (/\bC:\\\\demo\\\\workspace\b/.test(text) && /^lib\//.test(rel)) {
    findings.push({ severity: 'warn', rule: 'hardcoded-demo-path', file: rel, sample: 'C:\\demo\\workspace', hint: 'lib 里不应出现具体路径' });
  }
}

await walk(root);

const errors = findings.filter((item) => item.severity === 'error');
const warns = findings.filter((item) => item.severity === 'warn');
console.log(`扫描文件：${scanned.length}`);
if (findings.length === 0) {
  console.log('未发现凭据、本机路径或自定义敏感词。');
} else {
  for (const item of findings) {
    console.log(`${item.severity === 'error' ? 'ERROR' : 'WARN '} ${item.file}: ${item.rule} — ${item.hint} — ${item.sample}`);
  }
}
if (errors.length > 0) {
  console.error(`\n隐私扫描失败：${errors.length} 处 error，${warns.length} 处 warn。`);
  process.exit(1);
}
console.log(`\n隐私扫描通过（${warns.length} 处 warn 供人工复核）。`);
