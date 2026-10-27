import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const contentPath = path.join(root, 'server/src/seed/content.json');
const onlinePath = process.argv[2];
if (!onlinePath || !fs.existsSync(onlinePath)) {
  console.error('Usage: node scripts/sync-online-assets.mjs <online-bootstrap.json>');
  process.exit(1);
}

const online = JSON.parse(fs.readFileSync(onlinePath, 'utf8'));
const content = {
  contentVersion: online.contentVersion,
  statResetCostGold: online.statResetCost?.amount ?? 10000,
  biomes: online.biomes.map((b, index) => ({
    ...b,
    orderIndex: index,
    directGoldMin: b.directGoldMin ?? 50,
    directGoldMax: b.directGoldMax ?? 100,
  })),
  fish: online.fish,
  avatars: online.avatars,
  baits: online.baits,
  rods: online.rods,
  weather: online.weather,
  gearSlots: online.gearSlots,
};
fs.writeFileSync(contentPath, JSON.stringify(content), 'utf8');
console.log(`content synced: biomes=${content.biomes.length} fish=${content.fish.length} version=${content.contentVersion}`);

const urls = new Map();
for (const fish of content.fish) urls.set(fish.imagePath, fish.imagePath);
for (const avatar of content.avatars ?? []) urls.set(avatar.imagePath, avatar.imagePath);
for (const biome of content.biomes) urls.set(`/illustrations/biomes/${biome.id}.webp`, `/illustrations/biomes/${biome.id}.webp`);

const jobs = [...urls.keys()].filter(Boolean).map((url) => ({ url, file: path.join(root, 'web/public', url.replace(/^\//, '')), serverFile: path.join(root, 'server/static', url.replace(/^\//, '')) }));
let downloaded = 0;
let skipped = 0;
const failures = [];
const CONCURRENCY = 8;
let cursor = 0;

async function worker() {
  while (true) {
    const index = cursor++;
    if (index >= jobs.length) return;
    const { url, file, serverFile } = jobs[index];
    if (fs.existsSync(file)) {
      if (!fs.existsSync(serverFile)) {
        fs.mkdirSync(path.dirname(serverFile), { recursive: true });
        fs.copyFileSync(file, serverFile);
        downloaded++;
      }
      skipped++;
      continue;
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    try {
      const res = await fetch(`https://reelax.cn${url}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buffer = Buffer.from(await res.arrayBuffer());
      fs.writeFileSync(file, buffer);
      fs.mkdirSync(path.dirname(serverFile), { recursive: true });
      fs.writeFileSync(serverFile, buffer);
      downloaded++;
      if (downloaded % 20 === 0) console.log(`downloaded ${downloaded}`);
    } catch (error) {
      failures.push({ url, error: String(error) });
    }
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
console.log(`assets complete: downloaded=${downloaded} existing=${skipped} failed=${failures.length}`);
if (failures.length) {
  console.log(JSON.stringify(failures.slice(0, 20), null, 2));
  process.exitCode = 1;
}
