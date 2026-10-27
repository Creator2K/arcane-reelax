import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';
const base = process.argv[2] || 'http://localhost:3000';
const label = process.argv[3] || (base.includes('reelax.cn') ? 'online' : 'local');
const email = process.env.TEST_USER_EMAIL || '';
const password = process.env.TEST_USER_PASSWORD || '';
if (!email || !password) {
  console.error('Set TEST_USER_EMAIL and TEST_USER_PASSWORD before running this script.');
  process.exit(1);
}
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
const pending = [];
let current = 'auth';
page.on('response', (res) => {
  const url = res.url();
  if (!url.includes('/api/') || res.request().method() === 'OPTIONS') return;
  pending.push((async () => {
    try {
      const body = await res.json();
      const routeDir = current.replace(/[^a-zA-Z0-9._-]+/g, '_') || 'root';
      const clean = url.replace(/^https?:\/\/[^/]+/, '').replace(/[?&](?:cursor|limit|q|_)=[^&]*/g, '').replace(/[^a-zA-Z0-9._/-]+/g, '_').replace(/^\/api\//, '') || 'root';
      const out = path.join('artifacts', `${label}-api-interactions`, routeDir);
      fs.mkdirSync(out, { recursive: true });
      fs.writeFileSync(path.join(out, `${res.status()}_${res.request().method()}_${clean.slice(0, 160)}.json`), JSON.stringify(body, null, 2));
    } catch {}
  })());
});
async function closeCheckin() {
  await new Promise(r => setTimeout(r, 350));
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find(b => /关闭每日签到/.test(b.getAttribute('aria-label') || ''));
    if (btn) btn.click();
  });
  await new Promise(r => setTimeout(r, 250));
}
await page.goto(base + '/', { waitUntil: 'networkidle2', timeout: 60000 });
await new Promise(r => setTimeout(r, 600));
if (await page.$('input[type=email]')) {
  await page.type('input[type=email]', email);
  await page.type('input[type=password]', password);
  await page.click('button[type=submit]');
  await new Promise(r => setTimeout(r, 1800));
}
await closeCheckin();
const actions = [
  { route: '/gear', tab: '配装' },
  { route: '/stats', tab: '属性与转生' },
  { route: '/tournaments', tab: '周赛' },
  { route: '/tournaments', tab: '奖牌收藏' },
  { route: '/market' },
  { route: '/party-boats', tab: '公开船只' },
  { route: '/party-boats', tab: '合建' },
  { route: '/party-boats', tab: '邀请' },
  { route: '/events', tab: '渊潮围猎' },
  { route: '/events', tab: '历史榜' },
  { route: '/shop', tab: '兑换' },
  { route: '/settings', tab: '账户' },
];
for (const action of actions) {
  current = action.route + (action.tab ? ':' + action.tab : '');
  await page.goto(base + action.route, { waitUntil: 'networkidle2', timeout: 60000 }).catch(() => {});
  await new Promise(r => setTimeout(r, 1500));
  await closeCheckin();
  if (action.tab) {
    const clicked = await page.evaluate((tab) => {
      const btn = [...document.querySelectorAll('button')].find(b => b.innerText.trim().includes(tab));
      if (btn) btn.click();
      return !!btn;
    }, action.tab);
    console.log('click', current, clicked);
  }
  await new Promise(r => setTimeout(r, 2200));
  await Promise.allSettled(pending.splice(0));
}
await browser.close();
console.log('captured interactions to', `artifacts/${label}-api-interactions`);
