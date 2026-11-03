import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative, join, sep } from 'node:path';

const root = resolve(process.env.DOCS_DIR || './docs');
const base = (process.env.WORKER_URL || '').replace(/\/$/, '');
const token = process.env.API_KEY;
const githubBase = (process.env.GITHUB_BLOB_BASE || '').replace(/\/$/, '');
const sync = process.argv.includes('--sync');
if (!base || !token || !githubBase) {
  console.error('WORKER_URL, API_KEY, GITHUB_BLOB_BASE を指定してください');
  process.exit(1);
}

async function* markdownFiles(dir) {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const fullPath = join(dir, item.name);
    if (item.isDirectory()) yield* markdownFiles(fullPath);
    else if (item.isFile() && item.name.endsWith('.md')) yield fullPath;
  }
}

async function post(path, body) {
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const responseText = await res.text();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${responseText}`);
  return responseText;
}

const currentPaths = new Set();
for await (const file of markdownFiles(root)) {
  const rel = relative(root, file).split(sep).join('/');
  const path = `docs/${rel}`;
  const content = await readFile(file, 'utf8');
  const source_url = `${githubBase}/${rel.split('/').map(encodeURIComponent).join('/')}`;
  const response = await post('/admin/ingest', { path, content, source_url });
  currentPaths.add(path);
  console.log(`登録 ${path} ${response}`);
}

if (sync) {
  const res = await fetch(`${base}/admin/paths`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!res.ok) throw new Error(`既存パスの取得に失敗: ${res.status}`);
  const data = await res.json();
  for (const path of data.paths) {
    if (!currentPaths.has(path)) {
      console.log(`削除 ${path} ${await post('/admin/delete', { path })}`);
    }
  }
}
console.log('取り込み完了');
