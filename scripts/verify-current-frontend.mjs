import fs from 'node:fs';
import path from 'node:path';
const root=process.cwd();
const required=[
  'web/recovered/index.html',
  'web/recovered/assets/index-Cn9pyXL5.js',
  'web/recovered/assets/index-Ck9Srn7m.css',
  'web/public/assets/ibm-plex-mono-latin-400-normal-DMJ8VG8y.woff2',
  'web/public/branding/arcane-reelax-lockup.webp',
  'web/public/branding/arcane-reelax-lockup-dark.webp',
  'web/public/world-boss/bosses/sereia.webp',
  'web/public/world-boss/bosses/junhai.webp',
  'web/public/world-boss/bosses/miguang.webp',
  'web/public/world-boss/bosses/wumo.webp',
];
const missing=required.filter(p=>!fs.existsSync(path.join(root,p)));
console.log({currentFrontendFiles:required.length,missing});
if(missing.length) process.exit(1);
