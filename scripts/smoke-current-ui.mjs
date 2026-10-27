import puppeteer from 'puppeteer-core';
import fs from 'node:fs';

const baseUrl = process.argv[2] || 'http://localhost:3000';
const email = process.argv[3] || process.env.TEST_USER_EMAIL || '';
const password = process.argv[4] || process.env.TEST_USER_PASSWORD || '';
if (!email || !password) {
  console.error('Set TEST_USER_EMAIL and TEST_USER_PASSWORD, or pass email and password as arguments.');
  process.exit(1);
}
const routes = ['/fishing','/biomes','/quests','/inventory','/loadout','/gear','/reincarnation','/stats','/statistics','/mastery','/fishpedia','/achievements','/lighthouse','/shop','/market','/tournaments','/party-boats','/guilds','/events','/leaderboards','/players/10001','/information','/settings'];
const browser = await puppeteer.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true, args: ['--no-sandbox','--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({width:1440,height:900,deviceScaleFactor:1});
let currentPath = '';
const events = [];
page.on('console', msg => { if (msg.type()==='error' || msg.type()==='warning') events.push({path:currentPath,type:'console:'+msg.type(),text:msg.text()}); });
page.on('pageerror', err => events.push({path:currentPath,type:'pageerror',text:err.message,stack:err.stack?.split('\n').slice(0,5).join('\n')}));
page.on('response', res => { if(res.status()>=400) events.push({path:currentPath,type:'response',text:res.status()+' '+res.url()}); });
await page.goto(baseUrl+'/',{waitUntil:'networkidle2',timeout:45000});
await new Promise(r=>setTimeout(r,600));
if(await page.$('input[type="email"]')){
  await page.type('input[type="email"]',email); await page.type('input[type="password"]',password);
  await Promise.all([page.waitForNavigation({waitUntil:'networkidle2',timeout:15000}).catch(()=>{}), page.click('button[type="submit"]')]);
  await new Promise(r=>setTimeout(r,1600));
}
const results=[];
for(const route of routes){
  currentPath=route;
  events.length=0;
  await page.goto(baseUrl+route,{waitUntil:'networkidle2',timeout:45000}).catch(e=>events.push({path:route,type:'goto',text:e.message}));
  await new Promise(r=>setTimeout(r,1200));
  const closeClicked = await page.evaluate(() => {
    const btn=[...document.querySelectorAll('.dialog-backdrop button')].find(b=>/关闭/.test(b.getAttribute('aria-label')||b.textContent||''));
    if(btn){btn.click();return true;} return false;
  });
  if(closeClicked) await new Promise(r=>setTimeout(r,350));
  const state=await page.evaluate(()=>({body:document.body.innerText.slice(0,320),root:document.getElementById('root')?.children.length,title:document.title,shell:!!document.querySelector('.app-shell')}));
  results.push({route,state,events:events.slice()});
}
fs.writeFileSync('artifacts/ui-smoke.json',JSON.stringify(results,null,2));
console.log(JSON.stringify(results.map(r=>({route:r.route,root:r.state.root,shell:r.state.shell,errors:r.events.filter(e=>e.type==='pageerror').length,responses:r.events.filter(e=>e.type==='response').map(e=>e.text),body:r.state.body.slice(0,100)})),null,2));
await browser.close();
