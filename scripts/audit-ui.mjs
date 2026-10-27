import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import path from 'node:path';

const base = process.argv[2] || 'http://localhost:3000';
const email = process.argv[3] || process.env.TEST_USER_EMAIL || '';
const password = process.argv[4] || process.env.TEST_USER_PASSWORD || '';
if (!email || !password) {
  console.error('Set TEST_USER_EMAIL and TEST_USER_PASSWORD, or pass email and password as arguments.');
  process.exit(1);
}
const routes = ['/','/fishing','/biomes','/quests','/inventory','/loadout','/gear','/reincarnation','/stats','/statistics','/mastery','/fishpedia','/achievements','/lighthouse','/shop','/market','/tournaments','/party-boats','/guilds','/events','/leaderboards','/information','/settings','/players/10001'];
const actions = [
  ['/gear', ['配装']], ['/inventory', ['道具']], ['/reincarnation', ['永久天赋']],
  ['/tournaments', ['周赛', '商店']], ['/party-boats', []], ['/shop', ['兑换']],
  ['/market', ['道具市场']], ['/market', ['以物易物']], ['/market', ['我的订单']],
  ['/events', ['渊潮围猎', '收藏册']], ['/settings', ['账户']],
];

const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
let current = 'startup';
const issues = [];
page.on('pageerror', (error) => issues.push({ step: current, type: 'pageerror', text: error.message }));
page.on('response', (response) => {
  if (response.status() >= 400 && response.url().includes('/api/') && !(response.status() === 401 && response.url().endsWith('/api/me'))) {
    issues.push({ step: current, type: 'http', status: response.status(), url: response.url() });
  }
});
async function closeDaily() {
  await new Promise((resolve) => setTimeout(resolve, 400));
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => /关闭每日签到/.test(item.getAttribute('aria-label') || ''));
    if (button) button.click();
  });
  await new Promise((resolve) => setTimeout(resolve, 200));
}
await page.goto(base + '/', { waitUntil: 'networkidle2', timeout: 60000 });
if (await page.$('input[type=email]')) {
  await page.type('input[type=email]', email);
  await page.type('input[type=password]', password);
  await Promise.all([
    page.waitForResponse((response) => response.url().endsWith('/api/auth/login'), { timeout: 20000 }),
    page.click('button[type=submit]'),
  ]);
  await page.waitForFunction(() => !!document.querySelector('.app-shell'), { timeout: 20000 });
}
const results = [];
for (const route of routes) {
  current = route;
  issues.length = 0;
  await page.goto(base + route, { waitUntil: 'networkidle2', timeout: 60000 }).catch((error) => issues.push({ step: route, type: 'goto', text: error.message }));
  await closeDaily();
  await new Promise((resolve) => setTimeout(resolve, 700));
  const state = await page.evaluate(() => ({
    root: document.getElementById('root')?.children.length ?? 0,
    shell: !!document.querySelector('.app-shell'),
    title: document.title,
    text: document.body.innerText.slice(0, 240),
  }));
  results.push({ route, state, issues: issues.splice(0) });
  const directory = path.resolve('artifacts/audit');
  fs.mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: path.join(directory, `${route === '/' ? 'home' : route.slice(1).replace(/[^a-z0-9-]+/gi, '_')}.png`) });
}
for (const [route, labels] of actions) {
  current = `${route} ${labels.join(' > ')}`;
  issues.length = 0;
  await page.goto(base + route, { waitUntil: 'networkidle2', timeout: 60000 }).catch((error) => issues.push({ step: current, type: 'goto', text: error.message }));
  await closeDaily();
  for (const label of labels) {
    await page.evaluate((text) => {
      const button = [...document.querySelectorAll('button')].find((item) => (item.innerText || '').trim().includes(text) && item.getBoundingClientRect().width > 0);
      if (button) button.click();
    }, label);
    await new Promise((resolve) => setTimeout(resolve, 700));
  }
  await new Promise((resolve) => setTimeout(resolve, 900));
  results.push({ current, issues: issues.splice(0) });
}
fs.writeFileSync('artifacts/audit.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
await browser.close();
