import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const [baseUrl, pathName, output, widthArg = '1440', heightArg = '900', email = process.env.TEST_USER_EMAIL, password = process.env.TEST_USER_PASSWORD] = process.argv.slice(2);
if (!baseUrl || !pathName || !output) {
  console.error('Usage: node scripts/capture-ui.mjs <baseUrl> <path> <output> [width] [height] [email] [password]');
  process.exit(1);
}
if (!email || !password) {
  console.error('Set TEST_USER_EMAIL and TEST_USER_PASSWORD, or pass email and password as arguments.');
  process.exit(1);
}
const browser = await puppeteer.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: Number(widthArg), height: Number(heightArg), deviceScaleFactor: 1 });
const events = [];
page.on('console', (msg) => { if (msg.type() === 'error' || msg.type() === 'warning') events.push({ type: 'console:' + msg.type(), text: msg.text() }); });
page.on('pageerror', (err) => events.push({ type: 'pageerror', text: err.message, stack: err.stack }));
page.on('requestfailed', (req) => events.push({ type: 'requestfailed', text: req.url() + ' ' + (req.failure()?.errorText || '') }));
page.on('response', (res) => { if (res.status() >= 400) events.push({ type: 'response', text: res.status() + ' ' + res.url() }); });
await page.goto(baseUrl + '/', { waitUntil: 'networkidle2', timeout: 45000 }).catch((e) => events.push({ type: 'goto', text: e.message }));
await new Promise((r) => setTimeout(r, 800));
const hasLogin = await page.$('input[type="email"]');
if (hasLogin) {
  await page.type('input[type="email"]', email);
  await page.type('input[type="password"]', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 15000 }).catch(() => {}),
    page.click('button[type="submit"]'),
  ]);
  await new Promise((r) => setTimeout(r, 1600));
}
await page.goto(baseUrl + pathName, { waitUntil: 'networkidle2', timeout: 45000 }).catch((e) => events.push({ type: 'goto', text: e.message }));
await new Promise((r) => setTimeout(r, 1800));
const closeButton = await page.$('.dialog-backdrop button[aria-label^="关闭"], .dialog-backdrop .icon-button');
if (closeButton) { await closeButton.click().catch(() => {}); await new Promise((r) => setTimeout(r, 450)); }
await page.screenshot({ path: output, fullPage: false });
const summary = await page.evaluate(() => ({
  title: document.title,
  url: location.href,
  body: document.body.innerText.slice(0, 700),
  rootChildren: document.getElementById('root')?.children.length,
  appShell: !!document.querySelector('.app-shell'),
  topbar: document.querySelector('.topbar')?.getBoundingClientRect().toJSON(),
  main: document.querySelector('.main-content')?.getBoundingClientRect().toJSON(),
}));
fs.writeFileSync(output.replace(/\.png$/i, '.json'), JSON.stringify({ summary, events }, null, 2));
console.log(JSON.stringify({ output, summary, eventCount: events.length, events: events.slice(0, 20) }, null, 2));
await browser.close();
