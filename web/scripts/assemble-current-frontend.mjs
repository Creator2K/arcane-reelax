import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const recovered = path.join(root, 'recovered');
const dist = path.join(root, 'dist');
let index = fs.readFileSync(path.join(recovered, 'index.html'), 'utf8');
index = index.replaceAll('https://static.reelax.cn', '');
index = index.replace(/<link rel="canonical"[^>]*>/i, '');
if (!index.includes('/site-config.js')) index = index.replace('</body>', '  <script src="/site-config.js?v=20261027-1"></script>\n</body>');
fs.writeFileSync(path.join(dist, 'index.html'), index);
fs.mkdirSync(path.join(dist, 'assets'), { recursive: true });
for (const file of fs.readdirSync(path.join(recovered, 'assets'))) {
  const source = path.join(recovered, 'assets', file);
  if (/\.(?:js|css)$/i.test(file)) {
    const content = fs.readFileSync(source, 'utf8')
      .replaceAll('https://static.reelax.cn', '')
      .replaceAll('https://main.api.reelax.cn', '')
      .replaceAll('https://sync.api.reelax.cn', '')
      .replace('onSuccess:p=>Aw(o,p)', 'onSuccess:p=>{Aw(o,p);window.setTimeout(r,350)}');
    fs.writeFileSync(path.join(dist, 'assets', file), content);
  } else {
    fs.copyFileSync(source, path.join(dist, 'assets', file));
  }
}
console.log('current player frontend assembled at dist/index.html');
