import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const content = JSON.parse(fs.readFileSync(path.join(root, 'server/src/seed/content.json'), 'utf8'));
const shopAvatars = JSON.parse(fs.readFileSync(path.join(root, 'server/src/seed/shopAvatars.json'), 'utf8'));
const checks = [
  ...content.fish.map((fish) => ({ label: `fish ${fish.id}`, path: path.join(root, 'web/public', fish.imagePath) })),
  ...content.avatars.map((avatar) => ({ label: `avatar ${avatar.id}`, path: path.join(root, 'web/public', avatar.imagePath) })),
  ...content.biomes.map((biome) => ({ label: `biome ${biome.id}`, path: path.join(root, 'web/public/illustrations/biomes', `${biome.id}.webp`) })),
  ...shopAvatars.map((avatar) => ({ label: `shop avatar ${avatar.id}`, path: path.join(root, 'web/public/avatars', `${avatar.id}.webp`) })),
  ...Array.from({ length: 9 }, (_, index) => `14000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`).map((id) => ({ label: `weekly avatar ${id}`, path: path.join(root, 'web/public/avatars', `${id}.webp`) })),
  ...['furnace-carbon', 'legendary-gear-crystal', 'mythic-gear-crystal', 'exotic-gear-crystal', 'relic-fragment-gift-box'].map((id) => ({ label: `item ${id}`, path: path.join(root, 'web/public/items', `${id}.webp`) })),
  ...['sereia','junhai','miguang','wumo'].map((id) => ({ label: `world boss ${id}`, path: path.join(root, 'web/public/world-boss/bosses', `${id}.webp`) })),
];
const missing = checks.filter((item) => !fs.existsSync(item.path));
console.log(`content=${content.contentVersion} fish=${content.fish.length} biomes=${content.biomes.length} shopAvatars=${shopAvatars.length} assetsChecked=${checks.length} missing=${missing.length}`);
if (missing.length) {
  for (const item of missing.slice(0, 30)) console.log(`MISSING ${item.label}: ${item.path}`);
  process.exit(1);
}
