import fs from 'node:fs';
import path from 'node:path';

const [cssPath, jsPath] = process.argv.slice(2);
if (!cssPath || !jsPath) {
  console.error('Usage: node scripts/sync-current-build-assets.mjs <index.css> <index.js>');
  process.exit(1);
}
const text = fs.readFileSync(cssPath, 'utf8') + '\n' + fs.readFileSync(jsPath, 'utf8');
const found = new Set();
const extension = /\.(?:webp|png|jpe?g|svg|gif|avif|woff2?|ttf|otf|mp3|ogg)(?:[?#][^\s"'\\)]*)?$/i;
for (const match of text.matchAll(/(?:https:\/\/static\.reelax\.cn)?(\/(?:[A-Za-z0-9._-]+\/)+[A-Za-z0-9._-]+\.(?:webp|png|jpe?g|svg|gif|avif|woff2?|ttf|otf|mp3|ogg))/g)) {
  let value = match[1];
  if (!extension.test(value) || value.includes('${') || value.includes('/api/')) continue;
  value = value.split(/[?#]/)[0];
  found.add(value);
}
const urls = [...found];
console.log(`asset paths discovered: ${urls.length}`);
let cursor = 0;
let downloaded = 0;
let existing = 0;
const failures = [];
const jobs = urls.map((url) => ({
  url,
  web: path.join('web/public', url.slice(1)),
  server: path.join('server/static', url.slice(1)),
}));
async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= jobs.length) return;
    const job = jobs[index];
    if (fs.existsSync(job.web)) {
      existing++;
      if (!fs.existsSync(job.server)) {
        fs.mkdirSync(path.dirname(job.server), { recursive: true });
        fs.copyFileSync(job.web, job.server);
      }
      continue;
    }
    try {
      const res = await fetch('https://reelax.cn' + job.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.mkdirSync(path.dirname(job.web), { recursive: true });
      fs.mkdirSync(path.dirname(job.server), { recursive: true });
      fs.writeFileSync(job.web, buffer);
      fs.writeFileSync(job.server, buffer);
      downloaded++;
      if (downloaded % 20 === 0) console.log(`downloaded ${downloaded}`);
    } catch (error) {
      failures.push({ url: job.url, error: String(error) });
    }
  }
}
await Promise.all(Array.from({ length: 10 }, () => worker()));
console.log({ downloaded, existing, failed: failures.length });
if (failures.length) console.log(failures.slice(0, 30));
